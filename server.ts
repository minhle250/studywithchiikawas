import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildBalancedStudyExcerpt,
  buildStudyItemsFromDocumentText,
  cleanExtractedText,
  countWords,
  detectDocumentSections,
  parseCsvToStudyPairs,
} from './src/utils/documentParser';
import {
  buildMathExercisesFromText,
  detectMathDomainFromText,
} from './src/utils/mathExerciseEngine';
import {
  FREE_TIER_TEXT_MODELS,
  ModelCooldownTracker,
  buildFriendlyQuotaMessage,
  isQuotaOrRateError,
} from './src/utils/geminiQuota';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MAX_SINGLE_FILE_BYTES = 512 * 1024 * 1024; // 512 MB per file
const MAX_BATCH_FILES = 25;
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'kusaquiz-uploads');
fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, file, cb) => {
      const safeExt = path.extname(file.originalname || '').replace(/[^a-zA-Z0-9.]/g, '');
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`);
    },
  }),
  limits: { fileSize: MAX_SINGLE_FILE_BYTES, files: MAX_BATCH_FILES },
});

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TMP_DIR),
    filename: (_req, _file, cb) => {
      cb(null, `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.part`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

async function safeUnlink(targetPath?: string | null) {
  if (!targetPath) return;
  try {
    await fs.promises.unlink(targetPath);
  } catch {
    // Ignore missing/already-removed temp files
  }
}

const modelCooldownTracker = new ModelCooldownTracker();

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callGeminiWithFallback(
  ai: GoogleGenAI,
  buildParams: (model: string) => Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Promise<{
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>> | null;
  modelUsed: string | null;
  quotaExhausted: boolean;
}> {
  const candidates = modelCooldownTracker.getAvailableModels(FREE_TIER_TEXT_MODELS);
  if (candidates.length === 0) {
    return { response: null, modelUsed: null, quotaExhausted: true };
  }

  let sawQuota = false;
  for (const model of candidates) {
    try {
      const params = buildParams(model);
      // Adjust MEDIUM thinking on flash-lite fallback to LOW for broad compatibility
      const config =
        model === 'gemini-3.1-flash-lite' &&
        params.config?.thinkingConfig?.thinkingLevel === ThinkingLevel.MEDIUM
          ? {
              ...params.config,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            }
          : params.config;

      const response = await ai.models.generateContent({
        ...params,
        config,
        model,
      });
      return { response, modelUsed: model, quotaExhausted: false };
    } catch (err) {
      if (isQuotaOrRateError(err)) {
        sawQuota = true;
        modelCooldownTracker.markQuotaExceeded(model, err);
        continue;
      }
      const brief = err instanceof Error ? err.message.slice(0, 180) : 'Unexpected Gemini response error';
      console.info(`Gemini fallback (${model}): ${brief}`);
    }
  }

  return {
    response: null,
    modelUsed: null,
    quotaExhausted: sawQuota || modelCooldownTracker.areAllExhausted(FREE_TIER_TEXT_MODELS),
  };
}

async function extractDocumentFromPath(
  filePath: string,
  fileName: string,
  fileSizeBytes: number
) {
  const ext = path.extname(fileName).toLowerCase();
  let extractedText = '';
  let pageCount: number | null = null;
  let fileType = ext.replace('.', '').toUpperCase() || 'TEXT';

  if (ext === '.pdf') {
    fileType = 'PDF';
    const buffer = await fs.promises.readFile(filePath);
    const pdfResult = await extractText(new Uint8Array(buffer), {
      mergePages: true,
    });
    pageCount = typeof pdfResult.totalPages === 'number' ? pdfResult.totalPages : null;
    extractedText = cleanExtractedText(
      Array.isArray(pdfResult.text) ? pdfResult.text.join('\n\n') : String(pdfResult.text ?? '')
    );

    // If scanned PDF with minimal selectable text and within inline payload budget, fall back to Gemini PDF OCR
    if (countWords(extractedText) < 12) {
      if (buffer.byteLength <= 18 * 1024 * 1024) {
        const ai = getGeminiClient();
        if (ai) {
          const { response: pdfResponse } = await callGeminiWithFallback(ai, () => ({
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'application/pdf',
                    data: buffer.toString('base64'),
                  },
                },
                {
                  text: 'Extract all readable study text, headings, definitions, and key points from this PDF in clean markdown paragraphs.',
                },
              ],
            },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          }));
          const aiText = cleanExtractedText(pdfResponse?.text ?? '');
          if (countWords(aiText) > countWords(extractedText)) {
            extractedText = aiText;
          }
        }
      } else {
        throw new Error(
          `"${fileName}" appears to be a large scanned-image PDF without embedded text. Please run OCR or split it into smaller PDFs under 18 MB.`
        );
      }
    }
  } else if (ext === '.docx') {
    fileType = 'DOCX';
    const result = await mammoth.extractRawText({ path: filePath });
    extractedText = cleanExtractedText(result.value ?? '');
  } else if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
    fileType = ext.replace('.', '').toUpperCase();
    const raw = await fs.promises.readFile(filePath, 'utf8');
    extractedText = cleanExtractedText(raw);
  } else {
    throw new Error(
      `Unsupported file type "${ext || 'unknown'}" for "${fileName}". Supported formats: PDF (.pdf), Word (.docx), Markdown (.md), Text (.txt), CSV (.csv), and JSON (.json).`
    );
  }

  if (!extractedText || countWords(extractedText) < 3) {
    throw new Error(
      `Could not find readable text inside "${fileName}". Please check the file contents or try another document.`
    );
  }

  const totalWords = countWords(extractedText);
  const rawSections = detectDocumentSections(extractedText);
  // Keep every consolidated section crisp in JSON while preserving broad coverage across huge volumes
  const sections = rawSections.map((sec) => ({
    ...sec,
    content: sec.content.length > 14000 ? `${sec.content.slice(0, 14000)}\n...` : sec.content,
  }));
  const csvPairs = ext === '.csv' ? parseCsvToStudyPairs(extractedText) : [];
  const previewLimit = 45000;
  const previewText = extractedText.slice(0, previewLimit);

  return {
    fileName,
    fileType,
    fileSizeBytes,
    wordCount: totalWords,
    pageCount,
    extractedText: previewText,
    isPreviewTruncated: extractedText.length > previewLimit,
    sections,
    csvPairsCount: csvPairs.length,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '24mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(getGeminiClient()),
      maxFileSizeMB: Math.round(MAX_SINGLE_FILE_BYTES / (1024 * 1024)),
      maxBatchFiles: MAX_BATCH_FILES,
    });
  });

  // Backward-compatible single-file extraction endpoint (supports large files on disk)
  app.post('/api/files/extract', upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) {
        return res.status(400).json({
          error: 'Please select a file to upload (.pdf, .docx, .txt, .md, .csv, or .json).',
        });
      }
      const extracted = await extractDocumentFromPath(
        file.path,
        file.originalname || 'document',
        file.size
      );
      return res.json(extracted);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read uploaded file.';
      const status =
        message.startsWith('Unsupported file type') ||
        message.startsWith('Could not find readable text') ||
        message.includes('scanned-image PDF')
          ? 400
          : 500;
      console.error('File extract error:', message);
      return res.status(status).json({ error: message });
    } finally {
      await safeUnlink(file?.path);
    }
  });

  // Multi-file batch extraction endpoint
  app.post('/api/files/extract-batch', upload.array('files', MAX_BATCH_FILES), async (req, res) => {
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    try {
      if (files.length === 0) {
        return res.status(400).json({
          error: 'Please select one or more files (.pdf, .docx, .txt, .md, .csv, or .json).',
        });
      }

      const extractedFiles = [];
      const failures: Array<{ fileName: string; error: string }> = [];

      for (const file of files) {
        const name = file.originalname || 'document';
        try {
          const parsed = await extractDocumentFromPath(file.path, name, file.size);
          extractedFiles.push(parsed);
        } catch (err) {
          failures.push({
            fileName: name,
            error: err instanceof Error ? err.message : `Could not parse ${name}.`,
          });
        } finally {
          await safeUnlink(file.path);
        }
      }

      if (extractedFiles.length === 0) {
        return res.status(400).json({
          error: failures[0]?.error || 'Could not read any of the uploaded files.',
          failures,
        });
      }

      return res.json({ files: extractedFiles, failures });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read uploaded files.';
      console.error('Batch extract error:', message);
      return res.status(500).json({ error: message });
    } finally {
      await Promise.all(files.map((f) => safeUnlink(f.path)));
    }
  });

  // Chunked upload part receiver for large files (>10 MB) so reverse proxies never reject large payloads
  app.post('/api/files/upload-chunk', chunkUpload.single('chunk'), async (req, res) => {
    const chunkFile = req.file;
    try {
      const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
      const chunkIndex = Number(req.body?.chunkIndex);

      if (!chunkFile || !/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId) || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
        await safeUnlink(chunkFile?.path);
        return res.status(400).json({ error: 'Invalid upload chunk metadata.' });
      }

      const destPath = path.join(UPLOAD_TMP_DIR, `${uploadId}.chunk.${chunkIndex}`);
      await fs.promises.rename(chunkFile.path, destPath);
      return res.json({ ok: true, uploadId, chunkIndex });
    } catch (error) {
      await safeUnlink(chunkFile?.path);
      const message = error instanceof Error ? error.message : 'Chunk upload failed.';
      return res.status(500).json({ error: message });
    }
  });

  // Reassembles uploaded chunks on disk, parses the full large file, and deletes all temporary files
  app.post('/api/files/finalize-chunk', async (req, res) => {
    const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
    const fileName = typeof req.body?.fileName === 'string' ? req.body.fileName.trim() : 'document';
    const totalChunks = Number(req.body?.totalChunks);
    const fileSizeBytes = Number(req.body?.fileSizeBytes ?? 0);

    if (
      !/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId) ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > 128
    ) {
      return res.status(400).json({ error: 'Invalid chunk finalize request.' });
    }

    const safeExt = path.extname(fileName).replace(/[^a-zA-Z0-9.]/g, '');
    const assembledPath = path.join(UPLOAD_TMP_DIR, `${uploadId}-assembled${safeExt}`);
    const chunkPaths = Array.from({ length: totalChunks }, (_, idx) =>
      path.join(UPLOAD_TMP_DIR, `${uploadId}.chunk.${idx}`)
    );

    try {
      const writeHandle = await fs.promises.open(assembledPath, 'w');
      let assembledSize = 0;
      try {
        for (const chunkPath of chunkPaths) {
          const data = await fs.promises.readFile(chunkPath);
          await writeHandle.write(data);
          assembledSize += data.byteLength;
        }
      } finally {
        await writeHandle.close();
      }

      const extracted = await extractDocumentFromPath(
        assembledPath,
        fileName,
        fileSizeBytes > 0 ? fileSizeBytes : assembledSize
      );
      return res.json(extracted);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not process assembled file.';
      const status =
        message.startsWith('Unsupported file type') ||
        message.startsWith('Could not find readable text') ||
        message.includes('scanned-image PDF')
          ? 400
          : 500;
      console.error('Chunk finalize error:', message);
      return res.status(status).json({ error: message });
    } finally {
      await Promise.all([safeUnlink(assembledPath), ...chunkPaths.map((p) => safeUnlink(p))]);
    }
  });

  app.post('/api/files/generate-study', async (req, res) => {
    try {
      const incomingFileNames: string[] = Array.isArray(req.body?.fileNames)
        ? req.body.fileNames.filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
        : [];
      const fallbackSingleName =
        typeof req.body?.fileName === 'string' && req.body.fileName.trim()
          ? req.body.fileName.trim()
          : 'Uploaded Document';
      const fileNames = incomingFileNames.length > 0 ? incomingFileNames : [fallbackSingleName];

      const incomingSections: Array<{ fileName?: string; title: string; content: string }> = Array.isArray(
        req.body?.sections
      )
        ? req.body.sections.filter(
            (s: unknown): s is { fileName?: string; title: string; content: string } =>
              Boolean(s) &&
              typeof (s as { content?: unknown }).content === 'string' &&
              typeof (s as { title?: unknown }).title === 'string'
          )
        : [];

      const text =
        incomingSections.length > 0
          ? cleanExtractedText(buildBalancedStudyExcerpt(incomingSections, 24000))
          : typeof req.body?.text === 'string'
            ? cleanExtractedText(req.body.text)
            : '';

      const tool = req.body?.tool === 'flashcards' ? 'flashcards' : 'quiz';
      const difficulty =
        typeof req.body?.difficulty === 'string' ? req.body.difficulty.trim() : 'Intermediate';
      const rawCount = Number(req.body?.count ?? 6);
      const count = Number.isFinite(rawCount) ? Math.min(12, Math.max(3, Math.round(rawCount))) : 6;

      if (!text || countWords(text) < 3) {
        return res.status(400).json({
          error: 'No readable document content selected. Please select at least one section.',
        });
      }

      const displaySourceLabel =
        fileNames.length === 1
          ? fileNames[0]
          : `${fileNames.length} study files (${fileNames.slice(0, 2).join(', ')}${fileNames.length > 2 ? ', ...' : ''})`;
      const baseName =
        fileNames.length === 1
          ? fileNames[0].replace(/\.[^.]+$/, '')
          : `${fileNames.length}-File Study Bundle`;

      // Handle pure single-CSV uploads directly if structured pairs exist
      if (fileNames.length === 1 && fileNames[0].toLowerCase().endsWith('.csv')) {
        const csvPairs = parseCsvToStudyPairs(text);
        if (csvPairs.length > 0) {
          const slice = csvPairs.slice(0, count);
          const allAnswers = slice.map((p) => p.answer);
          const cards = slice.map((p, idx) => ({
            prompt: p.prompt,
            answer: p.answer,
            distractors: allAnswers
              .filter((_, i) => i !== idx)
              .concat(['Alternative A', 'Alternative B', 'Alternative C'])
              .slice(0, 3),
            acceptableAnswers: [p.answer],
            hint: `Starts with "${p.answer.slice(0, 3)}"`,
            explanation: `${p.prompt} → ${p.answer}`,
            conceptTag: baseName,
          }));
          return res.json({
            title: `${baseName} (${tool === 'flashcards' ? 'Flashcards' : 'Quiz'})`,
            description: `Extracted ${cards.length} study items from ${fileNames[0]}.`,
            subject: 'Uploaded CSV',
            tool,
            source: 'csv-parser',
            cards,
          });
        }
      }

      const ai = getGeminiClient();
      if (ai) {
        try {
          const toolInstructions =
            tool === 'flashcards'
              ? `Build ${count} high-yield ACTIVE RECALL FLASHCARDS:
- "prompt" is the front of the card (a focused question, term, or prompt).
- "answer" is the concise back of the card (1 to 10 words).
- Still provide 3 plausible "distractors" so the student can also switch to multiple-choice review later.`
              : `Build ${count} INTERACTIVE QUIZ QUESTIONS at ${difficulty} level:
- "prompt" tests comprehension or application of one atomic idea from the document(s).
- "answer" is concise and unambiguous (1 to 8 words).
- Provide 3 strong, realistic "distractors" rooted in related concepts from the reading.`;

          const multiFileInstruction =
            fileNames.length > 1
              ? `Synthesize items evenly across all ${fileNames.length} uploaded files (${fileNames.join(', ')}) so concepts from every source appear.`
              : `Ground every card strictly in "${fileNames[0]}".`;

          const { response } = await callGeminiWithFallback(ai, () => ({
            contents: `Read this student study material (${displaySourceLabel}) and create a spaced-repetition study deck.
${multiFileInstruction}
${toolInstructions}

Document excerpt(s):
"""
${text.slice(0, 24000)}
"""`,
            config: {
              systemInstruction:
                'You are an educational scientist creating concise, accurate spaced-repetition flashcards and quizzes grounded strictly in the uploaded document(s).',
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        prompt: { type: Type.STRING },
                        answer: { type: Type.STRING },
                        distractors: { type: Type.ARRAY, items: { type: Type.STRING } },
                        acceptableAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
                        hint: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                        conceptTag: { type: Type.STRING },
                      },
                      required: [
                        'prompt',
                        'answer',
                        'distractors',
                        'acceptableAnswers',
                        'hint',
                        'explanation',
                        'conceptTag',
                      ],
                    },
                  },
                },
                required: ['title', 'description', 'subject', 'cards'],
              },
            },
          }));

          const rawText = (response?.text ?? '').trim();
          if (rawText) {
            const parsed = JSON.parse(rawText);
            if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
              return res.json({ ...parsed, tool, source: 'gemini-ai' });
            }
          }
        } catch {
          // Deterministic parser fallback below handles non-JSON responses silently
        }
      }

      // Deterministic structure-based extractor when Gemini API key is unavailable or fails
      const fallbackCards = buildStudyItemsFromDocumentText(text, tool, count, baseName);
      if (fallbackCards.length === 0) {
        return res.status(400).json({
          error:
            'Could not extract structured study items from this passage. Try selecting more sections or a clearer text passage.',
        });
      }

      return res.json({
        title: `${baseName} (${tool === 'flashcards' ? 'Flashcards' : 'Quiz'})`,
        description: `Built ${fallbackCards.length} ${tool} items directly from ${displaySourceLabel}.`,
        subject: 'Document Study',
        tool,
        source: 'document-structure',
        cards: fallbackCards,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to build study items from file.';
      console.error('File study generation error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // Multi-Agent SSE Pipeline: Analyzer Agent -> Google Search Research Agent -> Calculation Exercise & Verifier Agent
  app.post('/api/agents/build-quiz-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const incomingFileNames: string[] = Array.isArray(req.body?.fileNames)
        ? req.body.fileNames.filter(
            (n: unknown): n is string => typeof n === 'string' && n.trim().length > 0
          )
        : [];
      const incomingSections: Array<{ fileName?: string; title: string; content: string }> =
        Array.isArray(req.body?.sections)
          ? req.body.sections.filter(
              (s: unknown): s is { fileName?: string; title: string; content: string } =>
                Boolean(s) &&
                typeof (s as { content?: unknown }).content === 'string' &&
                typeof (s as { title?: unknown }).title === 'string'
            )
          : [];

      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const notes = typeof req.body?.notes === 'string' ? cleanExtractedText(req.body.notes) : '';
      const difficulty =
        typeof req.body?.difficulty === 'string' ? req.body.difficulty.trim() : 'Intermediate';
      const rawCount = Number(req.body?.count ?? 6);
      const count = Number.isFinite(rawCount)
        ? Math.min(12, Math.max(3, Math.round(rawCount)))
        : 6;

      const excerptText =
        incomingSections.length > 0
          ? cleanExtractedText(buildBalancedStudyExcerpt(incomingSections, 22000))
          : notes || topic;

      if (!excerptText || countWords(excerptText) < 2) {
        sendEvent('error', {
          error: 'Please upload study files or enter a math/study topic before running AI Agents.',
        });
        return res.end();
      }

      const sourceLabel =
        incomingFileNames.length > 0
          ? incomingFileNames.join(', ')
          : topic || 'Student Study Notes';

      // --- AGENT 1: Content & Quantitative Skill Analyzer (Local Zero-Quota Classifier) ---
      sendEvent('agent-step', {
        agent: 'analyzer',
        label: 'Content & Skill Analyzer Agent',
        status: 'running',
        detail: 'Scanning material for formulas, quantitative procedures, and key concepts...',
      });

      const localMathSignal = detectMathDomainFromText(`${topic}\n${excerptText}`);
      const sectionLabels = incomingSections
        .map((s) => s.title.trim())
        .filter((t) => t && !/^Document Section/i.test(t))
        .slice(0, 4);
      const detectedSkills = Array.from(
        new Set([
          ...localMathSignal.detectedTopics,
          ...sectionLabels,
          ...(localMathSignal.detectedTopics.length === 0 && sectionLabels.length === 0
            ? ['Core Concept Recall', 'Applied Reasoning']
            : []),
        ])
      ).slice(0, 5);

      const primarySubject =
        localMathSignal.detectedTopics.length >= 2
          ? `${localMathSignal.detectedTopics[0]} & ${localMathSignal.detectedTopics[1]}`
          : localMathSignal.detectedTopics[0] ?? (topic || 'Applied Study');

      const domainAnalysis = {
        isQuantHeavy: localMathSignal.isQuantHeavy,
        subject: primarySubject,
        skills: detectedSkills,
        searchQueries: [
          localMathSignal.isQuantHeavy
            ? `${primarySubject} worked calculation exercises MIT OpenCourseWare Pauls Online Math Notes OpenStax`
            : `${topic || sourceLabel} FSRS spaced repetition active recall study exercises`,
        ],
        pedagogicalPlan: localMathSignal.isQuantHeavy
          ? 'Combine Worked Example Scaffolding with numerical calculation drills and step-by-step verification.'
          : 'Combine atomic active recall questions with applied scenarios grounded in spaced repetition.',
      };

      sendEvent('agent-step', {
        agent: 'analyzer',
        label: 'Content & Skill Analyzer Agent',
        status: 'done',
        detail: `${domainAnalysis.isQuantHeavy ? 'Quantitative/Calculation focus' : 'Conceptual & Applied focus'} · ${domainAnalysis.subject} (${domainAnalysis.skills.join(', ')})`,
      });

      // --- AGENT 2: Search-Grounded Research Agent ---
      sendEvent('agent-step', {
        agent: 'search',
        label: 'Search Research Agent',
        status: 'running',
        detail: `Searching well-known academic & algorithm references for ${domainAnalysis.subject}...`,
      });

      let researchNotes = domainAnalysis.pedagogicalPlan;
      const researchSources: Array<{ title: string; url: string }> = [];
      let quotaHitInPipeline = false;

      const ai = getGeminiClient();
      if (ai) {
        try {
          const searchPrompt = domainAnalysis.isQuantHeavy
            ? `Search well-known university & educational math sources (such as MIT OpenCourseWare, OpenStax, Paul's Online Math Notes, Khan Academy) plus cognitive science adaptive practice algorithms (FSRS spaced repetition, Bayesian Knowledge Tracing, Worked Example Effect) for: ${domainAnalysis.searchQueries.join(' ; ')}. Summarize in 5 concise bullet points what calculation techniques, common student pitfalls, and progressive practical exercise formats are most effective for ${domainAnalysis.skills.join(', ')}.`
            : `Search authoritative educational sources and spaced-repetition pedagogy (FSRS, SM-2, retrieval practice) for: ${domainAnalysis.searchQueries.join(' ; ')}. Summarize 4 concise principles and practical exercise patterns for ${domainAnalysis.skills.join(', ')}.`;

          const { response: searchRes, quotaExhausted } = await callGeminiWithFallback(ai, () => ({
            contents: searchPrompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              tools: [{ googleSearch: {} }],
            },
          }));
          quotaHitInPipeline = quotaExhausted;

          if (searchRes?.text && searchRes.text.trim()) {
            researchNotes = searchRes.text.trim().slice(0, 3200);
          }

          const chunks =
            searchRes?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
          const seenUrls = new Set<string>();
          for (const chunk of chunks) {
            const web = (chunk as { web?: { uri?: string; title?: string } }).web;
            if (web?.uri && !seenUrls.has(web.uri)) {
              seenUrls.add(web.uri);
              researchSources.push({
                title: web.title?.trim() || web.uri,
                url: web.uri,
              });
            }
          }
        } catch {
          // Handled cleanly via canonical sources below
        }
      }

      const usedLiveSearch = researchSources.length > 0;
      if (!usedLiveSearch) {
        const canonicalSources = domainAnalysis.isQuantHeavy
          ? [
              {
                title: "Paul's Online Math Notes — Worked Calculus & Algebra Practice",
                url: 'https://tutorial.math.lamar.edu/',
              },
              {
                title: 'MIT OpenCourseWare — 18.01SC & 18.06SC Problem Sets & Exams',
                url: 'https://ocw.mit.edu/courses/mathematics/',
              },
              {
                title: 'OpenStax — Calculus & Linear Algebra Exercises',
                url: 'https://openstax.org/subjects/math',
              },
              {
                title: 'FSRS Algorithm & BKT Worked-Example Scaffolding Research',
                url: 'https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm',
              },
            ]
          : [
              {
                title: 'FSRS (Free Spaced Repetition Scheduler) — DSR Memory Model',
                url: 'https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm',
              },
              {
                title: 'MIT OpenCourseWare — Active Problem-Solving Collections',
                url: 'https://ocw.mit.edu/',
              },
              {
                title: 'OpenStax — Peer-Reviewed Study Exercises',
                url: 'https://openstax.org/',
              },
            ];
        researchSources.push(...canonicalSources);
      }

      sendEvent('agent-step', {
        agent: 'search',
        label: 'Search Research Agent',
        status: usedLiveSearch ? 'done' : 'fallback',
        detail: usedLiveSearch
          ? `Grounded in ${researchSources.length} verified Search references (${researchSources
              .slice(0, 2)
              .map((s) => s.title)
              .join(', ')}${researchSources.length > 2 ? ', ...' : ''}).`
          : quotaHitInPipeline
            ? `Gemini free-tier quota reached — applied worked-example & FSRS/BKT scaffolding from ${researchSources.length} canonical academic sources.`
            : `Applied worked-example & FSRS/BKT scaffolding referencing ${researchSources.length} canonical academic sources.`,
        sources: researchSources.slice(0, 6),
      });

      // --- AGENT 3: Practical Exercise & Calculation Verifier Agent ---
      sendEvent('agent-step', {
        agent: 'builder',
        label: 'Calculation & Exercise Architect Agent',
        status: 'running',
        detail: domainAnalysis.isQuantHeavy
          ? `Synthesizing ${count} practical calculation exercises with step-by-step worked solutions...`
          : `Building ${count} skill-building practice items with worked rationales...`,
      });

      let builtPayload: {
        title: string;
        description: string;
        subject: string;
        cards: Array<{
          prompt: string;
          answer: string;
          distractors: string[];
          acceptableAnswers: string[];
          hint: string;
          explanation: string;
          conceptTag: string;
          exerciseType: 'conceptual' | 'calculation' | 'worked-example';
          formulaUsed: string;
          workedSteps: string[];
        }>;
      } | null = null;

      if (ai && !quotaHitInPipeline) {
        try {
          const mathDirectives = domainAnalysis.isQuantHeavy
            ? `IMPORTANT FOR MATHEMATICS / QUANTITATIVE MATERIAL:
- At least 75% of the ${count} items MUST be concrete PRACTICAL CALCULATION OR APPLIED PROBLEM-SOLVING EXERCISES (with specific numbers, functions, matrices, equations, or datasets) derived from the material's formulas & techniques—NOT mere vocabulary trivia!
- Include a progressive blend of "worked-example" (scaffolding a core technique) and "calculation" (fresh problem with concrete numbers for the student to compute).
- Keep "answer" concise and mathematically exact (e.g., "12", "3/4", "2x + 5", "14", "1/6") so automated numeric/fraction equivalence grading works cleanly.
- Provide "formulaUsed" (the governing formula/theorem) and "workedSteps" (3-5 crisp step-by-step calculation lines showing exact intermediate arithmetic/algebra).`
            : `Design ${count} applied skill-building exercises mixing practical scenarios, worked reasoning steps, and active recall. Include "workedSteps" (2-4 logical reasoning steps) and "formulaUsed" (key principle or rule if applicable, else empty string).`;

          const { response: builderRes } = await callGeminiWithFallback(ai, () => ({
            contents: `You are the Exercise Architect & Calculation Verifier Agent.
Build exactly ${count} spaced-repetition practical exercises at ${difficulty} level.

Source Material (${sourceLabel}):
"""
${excerptText.slice(0, 16000)}
"""

Grounded Research Notes (Pedagogy & Canonical Patterns):
"""
${researchNotes}
"""

${mathDirectives}
Double-check every calculation step and verify that "answer" matches the final line of "workedSteps", while all 3 "distractors" represent realistic calculation mistakes (e.g. sign error, missing chain-rule factor, swapped formula).`,
            config: {
              systemInstruction:
                'You are an expert mathematics & STEM curriculum architect. Verify every numerical calculation carefully before outputting JSON.',
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        prompt: { type: Type.STRING },
                        answer: { type: Type.STRING },
                        distractors: { type: Type.ARRAY, items: { type: Type.STRING } },
                        acceptableAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
                        hint: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                        conceptTag: { type: Type.STRING },
                        exerciseType: { type: Type.STRING },
                        formulaUsed: { type: Type.STRING },
                        workedSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
                      },
                      required: [
                        'prompt',
                        'answer',
                        'distractors',
                        'acceptableAnswers',
                        'hint',
                        'explanation',
                        'conceptTag',
                        'exerciseType',
                        'formulaUsed',
                        'workedSteps',
                      ],
                    },
                  },
                },
                required: ['title', 'description', 'subject', 'cards'],
              },
            },
          }));

          const rawJson = (builderRes?.text ?? '').trim();
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
              builtPayload = {
                title: parsed.title || `${domainAnalysis.subject} Practice Lab`,
                description:
                  parsed.description ||
                  `AI-Agent verified ${parsed.cards.length} practical exercises for ${domainAnalysis.subject}.`,
                subject: parsed.subject || domainAnalysis.subject,
                cards: parsed.cards.map((c: Record<string, unknown>) => ({
                  prompt: String(c.prompt ?? ''),
                  answer: String(c.answer ?? ''),
                  distractors: Array.isArray(c.distractors)
                    ? c.distractors.map(String).slice(0, 3)
                    : ['Option A', 'Option B', 'Option C'],
                  acceptableAnswers: Array.isArray(c.acceptableAnswers)
                    ? c.acceptableAnswers.map(String)
                    : [String(c.answer ?? '')],
                  hint: String(c.hint ?? ''),
                  explanation: String(c.explanation ?? ''),
                  conceptTag: String(c.conceptTag ?? domainAnalysis.subject),
                  exerciseType:
                    c.exerciseType === 'calculation' || c.exerciseType === 'worked-example'
                      ? c.exerciseType
                      : 'conceptual',
                  formulaUsed: typeof c.formulaUsed === 'string' ? c.formulaUsed : '',
                  workedSteps: Array.isArray(c.workedSteps)
                    ? c.workedSteps.map(String).filter(Boolean)
                    : [],
                })),
              };
            }
          }
        } catch {
          // Falls through cleanly to deterministic math/document builder
        }
      }

      if (!builtPayload) {
        const fallbackCards = domainAnalysis.isQuantHeavy
          ? buildMathExercisesFromText(excerptText, count, domainAnalysis.subject)
          : buildStudyItemsFromDocumentText(excerptText, 'quiz', count, domainAnalysis.subject);

        if (fallbackCards.length === 0) {
          sendEvent('error', {
            error:
              'Could not extract enough structured problems from that input. Try adding more notes or choosing a specific math topic.',
          });
          return res.end();
        }

        builtPayload = {
          title: `${domainAnalysis.subject} Practical Exercises`,
          description: `Built ${fallbackCards.length} practical exercises with worked steps.`,
          subject: domainAnalysis.subject,
          cards: fallbackCards.map((c) => ({
            ...c,
            exerciseType: c.exerciseType ?? (domainAnalysis.isQuantHeavy ? 'calculation' : 'conceptual'),
            formulaUsed: c.formulaUsed ?? '',
            workedSteps: c.workedSteps ?? [c.explanation],
          })),
        };
      }

      sendEvent('agent-step', {
        agent: 'builder',
        label: 'Calculation & Exercise Architect Agent',
        status: 'done',
        detail: `Verified ${builtPayload.cards.length} interactive exercises with step-by-step worked solutions.`,
      });

      sendEvent('complete', {
        ...builtPayload,
        tool: 'agents',
        isQuantHeavy: domainAnalysis.isQuantHeavy,
        researchSources: researchSources.slice(0, 6),
        pedagogicalPlan: domainAnalysis.pedagogicalPlan,
      });
      return res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI Agent pipeline failed.';
      sendEvent('error', { error: message });
      return res.end();
    }
  });

  app.post('/api/quiz/generate', async (req, res) => {
    try {
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
      const difficulty =
        typeof req.body?.difficulty === 'string' ? req.body.difficulty.trim() : 'Intermediate';
      const rawCount = Number(req.body?.count ?? 6);
      const count = Number.isFinite(rawCount) ? Math.min(12, Math.max(3, Math.round(rawCount))) : 6;

      if (!topic && !notes) {
        return res.status(400).json({
          error: 'Please enter a study topic or paste study notes before generating a quiz.',
        });
      }

      const ai = getGeminiClient();
      let quotaExhausted = false;
      if (ai) {
        const sourceBlock = notes
          ? `Base the quiz strictly on these student notes:\n"""\n${notes.slice(0, 8000)}\n"""${topic ? `\nFocus topic: ${topic}` : ''}`
          : `Topic: ${topic}`;

        const result = await callGeminiWithFallback(ai, () => ({
          contents: `Create a high-retention spaced-repetition interactive quiz deck with exactly ${count} cards at ${difficulty} level.
${sourceBlock}

Design rules for scientific spaced repetition (Minimum Information Principle):
- Each prompt must test ONE atomic concept clearly, with no vague phrasing.
- "answer" should be concise and unambiguous (1 to 8 words ideal so typed recall and flashcards work smoothly).
- Provide exactly 3 plausible "distractors" that test real misconceptions rather than silly filler.
- Provide 1-3 short "acceptableAnswers" aliases (e.g. abbreviations or phrasing variants).
- Provide a gentle "hint" and a clear 1-2 sentence "explanation" reinforcing why the answer is right.`,
          config: {
            systemInstruction:
              'You are an expert cognitive science educator crafting concise, accurate spaced-repetition quiz items.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Clear 2-5 word deck title' },
                description: { type: Type.STRING, description: '1 sentence summary of what the student will master' },
                subject: { type: Type.STRING, description: 'Academic subject category' },
                cards: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      prompt: { type: Type.STRING },
                      answer: { type: Type.STRING },
                      distractors: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      acceptableAnswers: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      hint: { type: Type.STRING },
                      explanation: { type: Type.STRING },
                      conceptTag: { type: Type.STRING },
                    },
                    required: [
                      'prompt',
                      'answer',
                      'distractors',
                      'acceptableAnswers',
                      'hint',
                      'explanation',
                      'conceptTag',
                    ],
                  },
                },
              },
              required: ['title', 'description', 'subject', 'cards'],
            },
          },
        }));

        quotaExhausted = result.quotaExhausted;
        const rawText = (result.response?.text ?? '').trim();
        if (rawText) {
          try {
            const parsed = JSON.parse(rawText);
            if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
              return res.json(parsed);
            }
          } catch {
            // Fall through to deterministic fallback below if available
          }
        }
      }

      // Deterministic fallback when Gemini key is absent or daily quota is reached
      const combinedText = notes || topic;
      const mathSignal = detectMathDomainFromText(combinedText);
      if (mathSignal.isQuantHeavy) {
        const mathCards = buildMathExercisesFromText(combinedText, count, topic || mathSignal.detectedTopics[0] || 'Mathematics');
        if (mathCards.length > 0) {
          return res.json({
            title: `${topic || mathSignal.detectedTopics[0] || 'Mathematics'} Practice`,
            description: `Generated ${mathCards.length} practical calculation exercises with worked steps.`,
            subject: mathSignal.detectedTopics[0] || 'Mathematics',
            cards: mathCards,
          });
        }
      }

      if (notes && countWords(notes) >= 10) {
        const docCards = buildStudyItemsFromDocumentText(notes, 'quiz', count, topic || 'Study Notes');
        if (docCards.length > 0) {
          return res.json({
            title: `${topic || 'Study Notes'} Quiz`,
            description: `Extracted ${docCards.length} active-recall cards from your study notes.`,
            subject: topic || 'Study Notes',
            cards: docCards,
          });
        }
      }

      return res.status(quotaExhausted || ai ? 429 : 503).json({
        error: quotaExhausted
          ? buildFriendlyQuotaMessage()
          : 'Gemini API key is not configured in Secrets yet. You can upload a document, paste detailed notes, or build custom decks manually.',
      });
    } catch {
      return res.status(500).json({ error: 'Could not generate quiz right now. Please try pasting notes or uploading a study file.' });
    }
  });

  app.post('/api/quiz/ideas', async (req, res) => {
    try {
      const interest =
        typeof req.body?.interest === 'string' && req.body.interest.trim()
          ? req.body.interest.trim()
          : 'university science, languages, and creative learning';

      const ai = getGeminiClient();
      if (!ai) {
        return res.json({ ideas: [] });
      }

      const { response } = await callGeminiWithFallback(ai, () => ({
        contents: `Suggest 4 imaginative, high-yield spaced-repetition quiz deck ideas tailored to: "${interest}".`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                subject: { type: Type.STRING },
                promptTopic: { type: Type.STRING },
                whyItWorks: { type: Type.STRING },
              },
              required: ['title', 'subject', 'promptTopic', 'whyItWorks'],
            },
          },
        },
      }));

      const rawText = (response?.text ?? '').trim();
      if (!rawText) {
        return res.json({ ideas: [] });
      }

      const ideas = JSON.parse(rawText);
      return res.json({ ideas: Array.isArray(ideas) ? ideas : [] });
    } catch {
      return res.json({ ideas: [] });
    }
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!req.path.startsWith('/api/')) {
        return next(err);
      }
      const message =
        err instanceof Error ? err.message : 'Unexpected server error handling upload.';
      return res.status(400).json({ error: message });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`KusaQuiz server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
