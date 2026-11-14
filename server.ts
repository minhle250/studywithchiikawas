import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import type { ExerciseKind, StudyDomain } from './src/types/quiz';
import {
  buildBalancedStudyExcerpt,
  buildStudyItemsFromDocumentText,
  cleanExtractedText,
  countWords,
  detectDocumentLanguage,
  detectDocumentSections,
  extractTextFromPptxXmlSlides,
  parseCsvToStudyPairs,
} from './src/utils/documentParser';
import {
  buildMathExercisesFromText,
  detectMathDomainFromText,
} from './src/utils/mathExerciseEngine';
import {
  ModelRouter,
  buildFriendlyRateLimitMessage,
} from './src/utils/modelRouter';

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

const modelRouter = new ModelRouter();

const DOMAIN_LABELS: Record<StudyDomain, string> = {
  quantitative_stem: 'Quantitative STEM & Calculations',
  social_humanities: 'Social Sciences & Humanities',
  applied_professional: 'Applied Law, Medicine & Case Protocols',
  language_terminology: 'Languages & Specialized Terminology',
};

const VALID_DOMAINS = new Set<StudyDomain>([
  'quantitative_stem',
  'social_humanities',
  'applied_professional',
  'language_terminology',
]);

function classifyStudyDomainHeuristically(
  text: string,
  sectionTitles: string[],
  topicHint: string
): {
  domain: StudyDomain;
  language: string;
  subject: string;
  keyThemes: string[];
  pedagogicalStrategy: string;
} {
  const combined = `${topicHint}\n${text}`;
  const language = detectDocumentLanguage(combined);
  const isVi = language === 'Vietnamese';
  const mathSignal = detectMathDomainFromText(combined);

  let domain: StudyDomain = 'social_humanities';

  if (mathSignal.isQuantHeavy) {
    domain = 'quantitative_stem';
  } else {
    const appliedMatches =
      combined.match(
        /\b(statute|plaintiff|defendant|contract law|case law|clause|constitution|clinical|diagnosis|patient|dosage|protocol|symptom|triage|audit|compliance|bộ luật|pháp luật|luật pháp|luật sư|điều luật|hiến pháp|điều khoản|hợp đồng|nghị định|lâm sàng|chẩn đoán|phác đồ|bệnh nhân|nghiệp vụ)\b/gi
      )?.length ?? 0;

    const languageMatches =
      combined.match(
        /\b(vocabulary|grammar|conjugation|collocation|idiom|pronunciation|phonology|syntax|glossary|jlpt|ielts|hsk|từ vựng|ngữ pháp|thành ngữ|phiên âm|từ loại|ngữ nghĩa học)\b/gi
      )?.length ?? 0;

    const humanitiesMatches =
      combined.match(
        /\b(philosophy|history|sociology|literature|ideology|dialectic|epistemology|ontology|political economy|triết học|lịch sử|xã hội học|kinh tế chính trị|văn học|tư tưởng|duy vật|biện chứng|nhận thức luận|chân lý|quy luật lượng)\b/gi
      )?.length ?? 0;

    if (appliedMatches > humanitiesMatches && appliedMatches > languageMatches) {
      domain = 'applied_professional';
    } else if (languageMatches > humanitiesMatches && languageMatches >= 1) {
      domain = 'language_terminology';
    } else {
      domain = 'social_humanities';
    }
  }

  const cleanThemes = sectionTitles
    .map((t) => t.trim())
    .filter((t) => t && !/^(Overview|Section \d+)$/i.test(t))
    .slice(0, 4);

  const keyThemes = Array.from(
    new Set([
      ...mathSignal.detectedTopics,
      ...cleanThemes,
      ...(cleanThemes.length === 0 && mathSignal.detectedTopics.length === 0
        ? isVi
          ? ['Khái niệm trọng tâm', 'Phân tích bản chất']
          : ['Core Concepts', 'Applied Reasoning']
        : []),
    ])
  ).slice(0, 5);

  const subject =
    topicHint ||
    mathSignal.detectedTopics[0] ||
    cleanThemes[0] ||
    (isVi ? 'Tổng hợp kiến thức' : 'Academic Study');

  const strategies: Record<StudyDomain, { en: string; vi: string }> = {
    quantitative_stem: {
      en: 'Combine worked-example scaffolding with step-by-step calculation drills and formula checks.',
      vi: 'Kết hợp bài mẫu từng bước với bài tập tính toán thực hành và kiểm tra công thức.',
    },
    social_humanities: {
      en: 'Probe causal chains, compare schools of thought, and expose subtle conceptual distinctions.',
      vi: 'Phân tích chuỗi nhân quả, so sánh các trường phái tư tưởng và nhận diện bẫy khái niệm.',
    },
    applied_professional: {
      en: 'Test practical rule, legal article, or clinical protocol application through realistic mini-cases.',
      vi: 'Rèn luyện vận dụng điều luật, quy tắc hoặc phác đồ qua các tình huống thực tế ngắn.',
    },
    language_terminology: {
      en: 'Reinforce contextual usage, collocations, cloze recall, and precise term-definition mapping.',
      vi: 'Củng cố cách dùng theo ngữ cảnh, kết hợp từ, điền khuyết và đối chiếu thuật ngữ chính xác.',
    },
  };

  return {
    domain,
    language,
    subject,
    keyThemes,
    pedagogicalStrategy: isVi ? strategies[domain].vi : strategies[domain].en,
  };
}

function getDomainSynthesisDirectives(domain: StudyDomain, count: number, language: string): string {
  const langRule = `CRITICAL LANGUAGE MIRRORING RULE: The source material is written in "${language}". Every single field in your JSON ("title", "description", "subject", "prompt", "answer", all 3 "distractors", "acceptableAnswers", "hint", "explanation", "conceptTag", "formulaUsed", and every item in "workedSteps") MUST be written strictly in ${language}. Do NOT translate concepts into English unless the source itself is in English.`;

  switch (domain) {
    case 'quantitative_stem':
      return `${langRule}

DOMAIN DIRECTIVES (quantitative_stem):
- At least 75% of the ${count} items MUST be concrete practical calculations or quantitative problem-solving drills (with numbers, equations, matrices, or datasets) directly reflecting the uploaded formulas/methods.
- Use "exerciseType": "calculation" or "worked-example".
- Keep "answer" concise and exact (e.g. "12", "3/4", "2x + 5") so numeric/algebraic grading works cleanly.
- Provide "formulaUsed" (the governing formula/theorem) and "workedSteps" (3-5 exact intermediate calculation steps ending at "answer").
- All 3 "distractors" must represent realistic calculation errors (sign error, missing factor, wrong substitution).`;

    case 'social_humanities':
      return `${langRule}

DOMAIN DIRECTIVES (social_humanities):
- Focus on causal-chain analysis, comparisons across schools of thought or historical periods, ideological/contextual nuances, and subtle conceptual traps — NEVER invent unrelated math or rote trivial fill-in-the-blanks.
- Use "exerciseType": "conceptual" or "worked-example".
- Keep "answer" concise and clear (1 to 10 words).
- Set "formulaUsed" to "" (or the name of an explicit theoretical framework mentioned in the text).
- Provide "workedSteps" (2-4 clear analytical reasoning steps connecting premises/context in the source to the conclusion).
- All 3 "distractors" must be plausible theoretical misconceptions or swapped historical/philosophical positions.`;

    case 'applied_professional':
      return `${langRule}

DOMAIN DIRECTIVES (applied_professional):
- Build short, realistic scenario or case-study questions that require applying a rule, legal article, clinical criterion, or management/engineering protocol from the source text.
- Use "exerciseType": "case-study" or "worked-example".
- Keep "answer" concise and unambiguous (1 to 10 words).
- Set "formulaUsed" to the specific rule, article, or protocol name if stated in the source (otherwise "").
- Provide "workedSteps" (2-4 step-by-step decision reasoning steps showing how the rule applies to the scenario).
- All 3 "distractors" must represent realistic procedural/legal/clinical misapplications.`;

    case 'language_terminology':
      return `${langRule}

DOMAIN DIRECTIVES (language_terminology):
- Focus on contextual usage, collocations, register distinctions, cloze-deletion sentences, and precise term-to-meaning mapping directly from the uploaded material.
- Use "exerciseType": "language-usage" or "conceptual".
- Keep "answer" concise and exact.
- Set "formulaUsed" to the grammatical pattern or root structure if relevant (otherwise "").
- Provide "workedSteps" (2-3 linguistic or contextual clues explaining why this choice fits).
- All 3 "distractors" must be plausible semantic or grammatical near-misses.`;
  }
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

    if (countWords(extractedText) < 10) {
      throw new Error(
        `"${fileName}" appears to be a scanned-image PDF without embedded selectable text. Please run OCR or export a text-searchable PDF before uploading.`
      );
    }
  } else if (ext === '.docx') {
    fileType = 'DOCX';
    const result = await mammoth.extractRawText({ path: filePath });
    extractedText = cleanExtractedText(result.value ?? '');
  } else if (ext === '.pptx') {
    fileType = 'PPTX';
    const buffer = await fs.promises.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(name)
    );
    if (slideNames.length === 0) {
      throw new Error(`No presentation slides were found inside "${fileName}".`);
    }
    const slidePayloads = await Promise.all(
      slideNames.map(async (name) => ({
        name,
        xml: await zip.files[name].async('string'),
      }))
    );
    const pptxResult = extractTextFromPptxXmlSlides(slidePayloads);
    extractedText = pptxResult.text;
    pageCount = pptxResult.slideCount > 0 ? pptxResult.slideCount : null;
  } else if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
    fileType = ext.replace('.', '').toUpperCase();
    const raw = await fs.promises.readFile(filePath, 'utf8');
    extractedText = cleanExtractedText(raw);
  } else {
    throw new Error(
      `Unsupported file type "${ext || 'unknown'}" for "${fileName}". Supported formats: PDF (.pdf), Word (.docx), PowerPoint (.pptx), Markdown (.md), Text (.txt), CSV (.csv), and JSON (.json).`
    );
  }

  if (!extractedText || countWords(extractedText) < 3) {
    throw new Error(
      `Could not find readable text inside "${fileName}". Please check the file contents or try another document.`
    );
  }

  const totalWords = countWords(extractedText);
  const detectedLanguage = detectDocumentLanguage(extractedText);
  const rawSections = detectDocumentSections(extractedText);
  const chapterOutline = rawSections.map((s) => ({
    id: s.id,
    title: s.title,
    wordCount: s.wordCount,
  }));
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
    detectedLanguage,
    extractedText: previewText,
    isPreviewTruncated: extractedText.length > previewLimit,
    sections,
    chapterOutline,
    csvPairsCount: csvPairs.length,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '24mb' }));

  app.get('/api/health', (_req, res) => {
    const routerStatus = modelRouter.getStatusSummary();
    res.json({
      ok: true,
      provider: 'github-models',
      ...routerStatus,
      maxFileSizeMB: Math.round(MAX_SINGLE_FILE_BYTES / (1024 * 1024)),
      maxBatchFiles: MAX_BATCH_FILES,
    });
  });

  app.post('/api/files/extract', upload.single('file'), async (req, res) => {
    const file = req.file;
    try {
      if (!file) {
        return res.status(400).json({
          error: 'Please select a file to upload (.pdf, .docx, .pptx, .txt, .md, .csv, or .json).',
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
        message.startsWith('No presentation slides') ||
        message.includes('scanned-image PDF')
          ? 400
          : 500;
      console.error('File extract error:', message);
      return res.status(status).json({ error: message });
    } finally {
      await safeUnlink(file?.path);
    }
  });

  app.post('/api/files/extract-batch', upload.array('files', MAX_BATCH_FILES), async (req, res) => {
    const files = (Array.isArray(req.files) ? req.files : []) as Express.Multer.File[];
    try {
      if (files.length === 0) {
        return res.status(400).json({
          error: 'Please select one or more files (.pdf, .docx, .pptx, .txt, .md, .csv, or .json).',
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

  app.post('/api/files/upload-chunk', chunkUpload.single('chunk'), async (req, res) => {
    const chunkFile = req.file;
    try {
      const uploadId = typeof req.body?.uploadId === 'string' ? req.body.uploadId.trim() : '';
      const chunkIndex = Number(req.body?.chunkIndex);

      if (
        !chunkFile ||
        !/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId) ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0
      ) {
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
        message.startsWith('No presentation slides') ||
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
        ? req.body.fileNames.filter(
            (n: unknown): n is string => typeof n === 'string' && n.trim().length > 0
          )
        : [];
      const fallbackSingleName =
        typeof req.body?.fileName === 'string' && req.body.fileName.trim()
          ? req.body.fileName.trim()
          : 'Uploaded Document';
      const fileNames = incomingFileNames.length > 0 ? incomingFileNames : [fallbackSingleName];

      const incomingSections: Array<{ fileName?: string; title: string; content: string }> =
        Array.isArray(req.body?.sections)
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
      const count = Number.isFinite(rawCount)
        ? Math.min(12, Math.max(3, Math.round(rawCount)))
        : 6;

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

      const detectedLanguage = detectDocumentLanguage(text);

      if (modelRouter.hasConfiguredProvider()) {
        const toolInstructions =
          tool === 'flashcards'
            ? `Build ${count} high-yield ACTIVE RECALL FLASHCARDS:
- "prompt" is the front of the card (a focused question, term, or prompt).
- "answer" is the concise back of the card (1 to 10 words).
- Provide 3 plausible "distractors" so the student can also switch to multiple-choice review later.`
            : `Build ${count} INTERACTIVE QUIZ QUESTIONS at ${difficulty} level:
- "prompt" tests comprehension or application of one atomic idea from the document(s).
- "answer" is concise and unambiguous (1 to 8 words).
- Provide 3 strong, realistic "distractors" rooted in related concepts from the reading.`;

        const multiFileInstruction =
          fileNames.length > 1
            ? `Synthesize items evenly across all ${fileNames.length} uploaded files (${fileNames.join(', ')}) so concepts from every source appear.`
            : `Ground every card strictly in "${fileNames[0]}".`;

        const { data, modelUsed } = await modelRouter.generateJson<{
          title?: string;
          description?: string;
          subject?: string;
          cards?: Array<Record<string, unknown>>;
        }>({
          tier: 'fast',
          systemPrompt:
            'You are a universal educational architect creating concise, accurate spaced-repetition flashcards and quizzes grounded strictly in the uploaded document(s). Never invent external facts or inject unrelated math. Output valid JSON only.',
          userPrompt: `Read this student study material (${displaySourceLabel}) and create a spaced-repetition study deck.
${multiFileInstruction}
${toolInstructions}

LANGUAGE MIRRORING RULE: The material is primarily in "${detectedLanguage}". Write ALL fields ("title", "description", "subject", "prompt", "answer", "distractors", "acceptableAnswers", "hint", "explanation", "conceptTag") strictly in ${detectedLanguage}.

Return JSON matching:
{
  "title": "string",
  "description": "string",
  "subject": "string",
  "cards": [
    {
      "prompt": "string",
      "answer": "string",
      "distractors": ["string", "string", "string"],
      "acceptableAnswers": ["string"],
      "hint": "string",
      "explanation": "string",
      "conceptTag": "string"
    }
  ]
}

Document excerpt(s):
"""
${text.slice(0, 24000)}
"""`,
        });

        if (data && Array.isArray(data.cards) && data.cards.length > 0) {
          return res.json({
            ...data,
            tool,
            language: detectedLanguage,
            source: modelUsed ?? 'github-models',
          });
        }
      }

      // Multilingual deterministic parser fallback when API key is unavailable or rate-limited
      const fallbackCards = buildStudyItemsFromDocumentText(text, tool, count, baseName);
      if (fallbackCards.length === 0) {
        return res.status(400).json({
          error:
            'Could not extract structured study items from this passage. Try selecting more sections or a clearer text passage.',
        });
      }

      return res.json({
        title: `${baseName} (${tool === 'flashcards' ? 'Flashcards' : 'Quiz'})`,
        description:
          detectedLanguage === 'Vietnamese'
            ? `Tạo ${fallbackCards.length} thẻ ôn tập trực tiếp từ ${displaySourceLabel}.`
            : `Built ${fallbackCards.length} ${tool} items directly from ${displaySourceLabel}.`,
        subject: detectedLanguage === 'Vietnamese' ? 'Tài liệu học tập' : 'Document Study',
        tool,
        language: detectedLanguage,
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

  // Zero-Search Universal 4-Domain Multi-Agent Pipeline:
  // Agent 1: Domain & Language Classifier (fast tier) -> Agent 2: Deep Synthesis & Verification (deep tier)
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
          error: 'Please upload study files or enter a study topic/notes before running AI Agents.',
        });
        return res.end();
      }

      const sourceLabel =
        incomingFileNames.length > 0
          ? incomingFileNames.join(', ')
          : topic || 'Student Study Notes';

      // --- AGENT 1: 4-Domain & Language Classifier Agent ---
      sendEvent('agent-step', {
        agent: 'classifier',
        label: 'Domain & Language Classifier Agent',
        status: 'running',
        detail:
          'Detecting academic domain (STEM, Humanities, Applied Case, Language) and document language...',
      });

      const sectionTitles = incomingSections.map((s) => s.title);
      const heuristic = classifyStudyDomainHeuristically(excerptText, sectionTitles, topic);
      let classification = { ...heuristic };
      let classifierModelUsed: string | null = null;

      if (modelRouter.hasConfiguredProvider()) {
        const classifierRes = await modelRouter.generateJson<{
          domain?: string;
          language?: string;
          subject?: string;
          keyThemes?: string[];
          pedagogicalStrategy?: string;
        }>({
          tier: 'fast',
          temperature: 0.15,
          maxTokens: 500,
          systemPrompt:
            'You are a universal academic curriculum classifier. Classify any study text into exactly one of 4 domains: "quantitative_stem", "social_humanities", "applied_professional", or "language_terminology", and detect its primary language accurately. Output JSON only.',
          userPrompt: `Classify this study source strictly based on its own text (do NOT search external sources).

Source label: ${sourceLabel}
Sample excerpt:
"""
${excerptText.slice(0, 4500)}
"""

Return JSON:
{
  "domain": "quantitative_stem" | "social_humanities" | "applied_professional" | "language_terminology",
  "language": "Primary language name, e.g. Vietnamese, English, Japanese, French",
  "subject": "Concise subject title in the detected language",
  "keyThemes": ["3 to 5 key themes in the detected language"],
  "pedagogicalStrategy": "1 sentence explaining how to test mastery for this domain, written in the detected language"
}`,
        });

        if (classifierRes.data) {
          classifierModelUsed = classifierRes.modelUsed;
          const rawDomain = classifierRes.data.domain as StudyDomain | undefined;
          const validDomain =
            rawDomain && VALID_DOMAINS.has(rawDomain) ? rawDomain : heuristic.domain;
          // Preserve deterministic Vietnamese detection if heuristic detected Vietnamese unambiguously
          const detectedLanguage =
            heuristic.language === 'Vietnamese'
              ? 'Vietnamese'
              : typeof classifierRes.data.language === 'string' && classifierRes.data.language.trim()
                ? classifierRes.data.language.trim()
                : heuristic.language;

          classification = {
            domain: validDomain,
            language: detectedLanguage,
            subject:
              typeof classifierRes.data.subject === 'string' && classifierRes.data.subject.trim()
                ? classifierRes.data.subject.trim()
                : heuristic.subject,
            keyThemes:
              Array.isArray(classifierRes.data.keyThemes) && classifierRes.data.keyThemes.length > 0
                ? classifierRes.data.keyThemes.map(String).slice(0, 5)
                : heuristic.keyThemes,
            pedagogicalStrategy:
              typeof classifierRes.data.pedagogicalStrategy === 'string' &&
              classifierRes.data.pedagogicalStrategy.trim()
                ? classifierRes.data.pedagogicalStrategy.trim()
                : heuristic.pedagogicalStrategy,
          };
        }
      }

      sendEvent('agent-step', {
        agent: 'classifier',
        label: 'Domain & Language Classifier Agent',
        status: classifierModelUsed ? 'done' : 'fallback',
        detail: `${DOMAIN_LABELS[classification.domain]} · Language: ${classification.language} · ${classification.subject} (${classification.keyThemes.join(', ')})`,
      });

      // --- AGENT 2: Deep Synthesis & Verification Agent (Zero Web Search) ---
      sendEvent('agent-step', {
        agent: 'builder',
        label: 'Deep Synthesis & Verification Agent',
        status: 'running',
        detail: `Synthesizing ${count} ${classification.language} study items tailored for ${DOMAIN_LABELS[classification.domain]}...`,
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
          exerciseType: ExerciseKind;
          formulaUsed: string;
          workedSteps: string[];
        }>;
      } | null = null;
      let builderModelUsed: string | null = null;
      let rateLimitedFallback = false;

      if (modelRouter.hasConfiguredProvider()) {
        const directives = getDomainSynthesisDirectives(
          classification.domain,
          count,
          classification.language
        );

        const synthesisRes = await modelRouter.generateJson<{
          title?: string;
          description?: string;
          subject?: string;
          cards?: Array<Record<string, unknown>>;
        }>({
          tier: 'deep',
          temperature: 0.35,
          maxTokens: 3600,
          systemPrompt: `You are a universal academic synthesis and verification architect covering Natural Sciences, Social Sciences, Humanities, Law, Medicine, and Languages. Ground 100% of every question, answer, distractor, and reasoning step strictly in the user's source material (${sourceLabel}) without external web search. Output strictly valid JSON.`,
          userPrompt: `Build exactly ${count} spaced-repetition study items at ${difficulty} depth.

Detected Domain: ${classification.domain} (${DOMAIN_LABELS[classification.domain]})
Detected Language: ${classification.language}
Pedagogical Strategy: ${classification.pedagogicalStrategy}

Source Material (${sourceLabel}):
"""
${excerptText.slice(0, 18000)}
"""

${directives}

Self-verify before outputting JSON:
1. Confirm every answer is strictly supported by the source material and matches the final line of "workedSteps".
2. Confirm all 3 "distractors" are realistic and clearly distinct from "answer".
3. Confirm ALL fields are written in ${classification.language}.

Return JSON matching:
{
  "title": "string",
  "description": "string",
  "subject": "string",
  "cards": [
    {
      "prompt": "string",
      "answer": "string",
      "distractors": ["string", "string", "string"],
      "acceptableAnswers": ["string"],
      "hint": "string",
      "explanation": "string",
      "conceptTag": "string",
      "exerciseType": "conceptual" | "calculation" | "worked-example" | "case-study" | "language-usage",
      "formulaUsed": "string",
      "workedSteps": ["string"]
    }
  ]
}`,
        });

        rateLimitedFallback = synthesisRes.rateLimited;
        builderModelUsed = synthesisRes.modelUsed;
        const parsed = synthesisRes.data;

        if (parsed && Array.isArray(parsed.cards) && parsed.cards.length > 0) {
          const validKinds = new Set<ExerciseKind>([
            'conceptual',
            'calculation',
            'worked-example',
            'case-study',
            'language-usage',
          ]);
          const defaultKind: ExerciseKind =
            classification.domain === 'quantitative_stem'
              ? 'calculation'
              : classification.domain === 'applied_professional'
                ? 'case-study'
                : classification.domain === 'language_terminology'
                  ? 'language-usage'
                  : 'conceptual';

          builtPayload = {
            title: parsed.title || `${classification.subject} Practice`,
            description:
              parsed.description ||
              `Verified ${parsed.cards.length} ${classification.language} study items (${DOMAIN_LABELS[classification.domain]}).`,
            subject: parsed.subject || classification.subject,
            cards: parsed.cards.map((c: Record<string, unknown>) => {
              const rawKind = String(c.exerciseType ?? '');
              const exerciseType = validKinds.has(rawKind as ExerciseKind)
                ? (rawKind as ExerciseKind)
                : defaultKind;
              return {
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
                conceptTag: String(c.conceptTag ?? classification.subject),
                exerciseType,
                formulaUsed: typeof c.formulaUsed === 'string' ? c.formulaUsed : '',
                workedSteps: Array.isArray(c.workedSteps)
                  ? c.workedSteps.map(String).filter(Boolean)
                  : [],
              };
            }),
          };
        }
      }

      if (!builtPayload) {
        const quantCards =
          classification.domain === 'quantitative_stem'
            ? buildMathExercisesFromText(excerptText, count, classification.subject)
            : [];
        const fallbackCards =
          quantCards.length > 0
            ? quantCards
            : buildStudyItemsFromDocumentText(excerptText, 'quiz', count, classification.subject);

        if (fallbackCards.length === 0) {
          sendEvent('error', {
            error: rateLimitedFallback
              ? buildFriendlyRateLimitMessage()
              : 'Could not extract enough structured items from that input. Try uploading a clearer document or adding more detailed notes.',
          });
          return res.end();
        }

        const isVi = classification.language === 'Vietnamese';
        builtPayload = {
          title: isVi
            ? `${classification.subject} · Luyện tập chuyên sâu`
            : `${classification.subject} · Adaptive Practice`,
          description: isVi
            ? `Đã tổng hợp ${fallbackCards.length} câu hỏi có hướng dẫn từng bước từ tài liệu.`
            : `Synthesized ${fallbackCards.length} study items with reasoning steps from your material.`,
          subject: classification.subject,
          cards: fallbackCards.map((c) => ({
            prompt: c.prompt,
            answer: c.answer,
            distractors: c.distractors,
            acceptableAnswers: c.acceptableAnswers,
            hint: c.hint,
            explanation: c.explanation,
            conceptTag: c.conceptTag,
            exerciseType:
              c.exerciseType ??
              (classification.domain === 'quantitative_stem' ? 'calculation' : 'conceptual'),
            formulaUsed: c.formulaUsed ?? '',
            workedSteps: c.workedSteps ?? [c.explanation],
          })),
        };
      }

      sendEvent('agent-step', {
        agent: 'builder',
        label: 'Deep Synthesis & Verification Agent',
        status: builderModelUsed ? 'done' : 'fallback',
        detail: builderModelUsed
          ? `Verified ${builtPayload.cards.length} ${classification.language} items via ${builderModelUsed} (strictly grounded in uploaded source).`
          : rateLimitedFallback
            ? `Rate limit encountered — built ${builtPayload.cards.length} ${classification.language} items using built-in multilingual document engine.`
            : `Built ${builtPayload.cards.length} ${classification.language} items directly from document structure.`,
      });

      sendEvent('complete', {
        ...builtPayload,
        tool: 'agents',
        domain: classification.domain,
        language: classification.language,
        modelUsed: builderModelUsed ?? 'local-parser',
        isQuantHeavy: classification.domain === 'quantitative_stem',
        pedagogicalPlan: classification.pedagogicalStrategy,
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
      const count = Number.isFinite(rawCount)
        ? Math.min(12, Math.max(3, Math.round(rawCount)))
        : 6;

      if (!topic && !notes) {
        return res.status(400).json({
          error: 'Please enter a study topic or paste study notes before generating a quiz.',
        });
      }

      const detectedLanguage = detectDocumentLanguage(`${topic}\n${notes}`);
      let rateLimited = false;

      if (modelRouter.hasConfiguredProvider()) {
        const sourceBlock = notes
          ? `Base the quiz strictly on these student notes:\n"""\n${notes.slice(0, 12000)}\n"""${topic ? `\nFocus topic: ${topic}` : ''}`
          : `Topic: ${topic}`;

        const result = await modelRouter.generateJson<{
          title?: string;
          description?: string;
          subject?: string;
          cards?: Array<Record<string, unknown>>;
        }>({
          tier: 'fast',
          systemPrompt:
            'You are a universal cognitive science educator crafting concise, accurate spaced-repetition quiz items across STEM, Humanities, Law, Medicine, and Languages. Output valid JSON only.',
          userPrompt: `Create a high-retention spaced-repetition interactive quiz deck with exactly ${count} cards at ${difficulty} level.
${sourceBlock}

Design rules for scientific spaced repetition (Minimum Information Principle):
- Each prompt must test ONE atomic concept clearly, with no vague phrasing.
- "answer" should be concise and unambiguous (1 to 8 words ideal so typed recall and flashcards work smoothly).
- Provide exactly 3 plausible "distractors" that test real misconceptions rather than filler.
- Provide 1-3 short "acceptableAnswers" aliases.
- Provide a gentle "hint" and a clear 1-2 sentence "explanation".
- LANGUAGE MIRRORING: Write ALL fields strictly in ${detectedLanguage}.

Return JSON matching:
{
  "title": "string",
  "description": "string",
  "subject": "string",
  "cards": [
    {
      "prompt": "string",
      "answer": "string",
      "distractors": ["string", "string", "string"],
      "acceptableAnswers": ["string"],
      "hint": "string",
      "explanation": "string",
      "conceptTag": "string"
    }
  ]
}`,
        });

        rateLimited = result.rateLimited;
        if (result.data && Array.isArray(result.data.cards) && result.data.cards.length > 0) {
          return res.json({
            ...result.data,
            language: detectedLanguage,
            modelUsed: result.modelUsed,
          });
        }
      }

      // Deterministic fallback when GitHub Token is absent or rate-limited
      const combinedText = notes || topic;
      const mathSignal = detectMathDomainFromText(combinedText);
      if (mathSignal.isQuantHeavy) {
        const mathCards = buildMathExercisesFromText(
          combinedText,
          count,
          topic || mathSignal.detectedTopics[0] || 'Mathematics'
        );
        if (mathCards.length > 0) {
          return res.json({
            title: `${topic || mathSignal.detectedTopics[0] || 'Mathematics'} Practice`,
            description: `Generated ${mathCards.length} practical calculation exercises with worked steps.`,
            subject: mathSignal.detectedTopics[0] || 'Mathematics',
            language: detectedLanguage,
            cards: mathCards,
          });
        }
      }

      if (notes && countWords(notes) >= 10) {
        const docCards = buildStudyItemsFromDocumentText(
          notes,
          'quiz',
          count,
          topic || (detectedLanguage === 'Vietnamese' ? 'Ghi chú học tập' : 'Study Notes')
        );
        if (docCards.length > 0) {
          return res.json({
            title:
              detectedLanguage === 'Vietnamese'
                ? `${topic || 'Ghi chú học tập'} · Ôn tập`
                : `${topic || 'Study Notes'} Quiz`,
            description:
              detectedLanguage === 'Vietnamese'
                ? `Đã trích xuất ${docCards.length} câu hỏi ghi nhớ chủ động từ ghi chú.`
                : `Extracted ${docCards.length} active-recall cards from your study notes.`,
            subject: topic || (detectedLanguage === 'Vietnamese' ? 'Ghi chú' : 'Study Notes'),
            language: detectedLanguage,
            cards: docCards,
          });
        }
      }

      return res.status(rateLimited ? 429 : 503).json({
        error: rateLimited
          ? buildFriendlyRateLimitMessage()
          : 'GitHub Models token (GITHUB_TOKEN) is not configured yet. You can upload a document, paste detailed notes, or build custom decks manually.',
      });
    } catch {
      return res.status(500).json({
        error: 'Could not generate quiz right now. Please try pasting notes or uploading a study file.',
      });
    }
  });

  app.post('/api/quiz/ideas', async (req, res) => {
    try {
      const interest =
        typeof req.body?.interest === 'string' && req.body.interest.trim()
          ? req.body.interest.trim()
          : 'sciences, humanities, law, languages, and creative learning';

      if (!modelRouter.hasConfiguredProvider()) {
        return res.json({ ideas: [] });
      }

      const detectedLanguage = detectDocumentLanguage(interest);
      const { data } = await modelRouter.generateJson<{
        ideas?: unknown[];
      }>({
        tier: 'fast',
        maxTokens: 700,
        systemPrompt:
          'You suggest high-yield spaced-repetition quiz deck ideas across all academic domains. Output valid JSON object {"ideas": [...]} only.',
        userPrompt: `Suggest 4 imaginative, high-yield spaced-repetition quiz deck ideas tailored to: "${interest}". Write in ${detectedLanguage}.
Return JSON:
{
  "ideas": [
    {
      "title": "string",
      "subject": "string",
      "promptTopic": "string",
      "whyItWorks": "string"
    }
  ]
}`,
      });

      const ideas = Array.isArray(data)
        ? data
        : data && Array.isArray(data.ideas)
          ? data.ideas
          : [];
      return res.json({ ideas });
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
