import React, { useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Bot,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Files,
  Globe,
  Layers,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AgentTraceStep,
  GeneratedCardDraft,
  QuizDeck,
  QuizMode,
  ResearchSource,
  StudyDomain,
} from '../types/quiz';
import { runAgentQuizStream } from '../utils/agentStreamClient';
import { formatFileSize, type DocumentSection } from '../utils/documentParser';
import { createNewCard } from '../utils/spacedRepetition';
import { soundEngine } from '../utils/soundEngine';

const CHUNK_THRESHOLD_BYTES = 10 * 1024 * 1024; // Stream files >10 MB in chunks
const CHUNK_SIZE_BYTES = 6 * 1024 * 1024; // 6 MB per chunk

interface ExtractedFileResponse {
  fileName: string;
  fileType: string;
  fileSizeBytes?: number;
  wordCount: number;
  pageCount: number | null;
  detectedLanguage?: string;
  extractedText: string;
  isPreviewTruncated?: boolean;
  sections: DocumentSection[];
  csvPairsCount: number;
}

interface ExtractedDocument extends ExtractedFileResponse {
  docId: string;
  fileSizeBytes: number;
}

interface GeneratedStudyPayload {
  title: string;
  description: string;
  subject: string;
  tool: 'flashcards' | 'quiz' | 'agents';
  domain?: StudyDomain;
  language?: string;
  source?: string;
  pedagogicalPlan?: string;
  researchSources?: ResearchSource[];
  cards: GeneratedCardDraft[];
}

interface FileStudyStudioProps {
  onSaveDeck: (deck: QuizDeck, startImmediately?: boolean, initialMode?: QuizMode) => void;
}

const SAMPLE_LECTURE_NOTES = `# Synaptic Plasticity & Memory
Long-Term Potentiation (LTP): Persistent strengthening of synapses based on recent patterns of activity.
NMDA Receptor: Coincidence-detector glutamate receptor that opens when both glutamate binds and the postsynaptic membrane depolarizes.
AMPA Receptor: Fast sodium ion channel inserted into the postsynaptic membrane during LTP to amplify future signals.

# Sleep & Consolidation
Slow-Wave Sleep: Deep sleep stage when the hippocampus replays newly encoded memories to the neocortex.
REM Sleep: Rapid eye movement stage supporting emotional memory integration and creative schema linking.

# Spaced Retrieval Practice
Spacing Effect: Distributing review sessions over days yields far stronger recall than massed cramming.`;

const SAMPLE_COMPANION_CSV = `Term,Definition
Myelin Sheath,Lipid-rich insulating layer around axons that accelerates electrical conduction
Hippocampus,Medial temporal lobe structure critical for consolidating new declarative memories
Dopamine,Catecholamine neurotransmitter involved in reward prediction error and motivation
Astrocyte,Star-shaped glial cell that regulates extracellular ions and supports the blood-brain barrier`;

const SAMPLE_MATH_NOTES = `# Calculus: Derivatives & Integration Techniques
Power Rule: d/dx [x^n] = n * x^(n - 1) for differentiable polynomial terms.
Chain Rule: d/dx [f(g(x))] = f'(g(x)) * g'(x) for composite functions.
Definite Integral (Fundamental Theorem of Calculus): ∫_a^b f(x) dx = F(b) - F(a), where F'(x) = f(x).
Integration by Parts: ∫ u dv = u*v - ∫ v du.

# Linear Algebra: Matrices & Eigenvalues
2x2 Matrix Determinant: det([[a, b], [c, d]]) = ad - bc.
Eigenvalue Equation: det(A - λI) = 0 solves for scalar eigenvalues λ of square matrix A.
Dot Product: u · v = u1*v1 + u2*v2 + ... + un*vn measures projection alignment.`;

const SAMPLE_VIETNAMESE_HUMANITIES = `# Chương 1: Chủ nghĩa duy vật biện chứng và Nhận thức luận
Chủ nghĩa duy vật biện chứng: Học thuyết khẳng định vật chất là tính thứ nhất, tồn tại khách quan độc lập với ý thức và quyết định ý thức con người.
Thực tiễn: Toàn bộ hoạt động vật chất cảm tính có mục đích, mang tính lịch sử - xã hội của con người nhằm cải tạo tự nhiên và xã hội.
Vai trò của thực tiễn: Thực tiễn là cơ sở, động lực, mục đích của nhận thức và là tiêu chuẩn duy nhất để kiểm tra chân lý khách quan.

# Chương 2: Các quy luật cơ bản của Phép biện chứng
Quy luật lượng - chất: Sự tích lũy dần về lượng khi vượt quá điểm nút sẽ dẫn đến bước nhảy vọt làm thay đổi căn bản về chất của sự vật.
Quy luật mâu thuẫn: Sự đấu tranh và thống nhất giữa các mặt đối lập là nguồn gốc, động lực bên trong của mọi sự vận động và phát triển.
Phủ định biện chứng: Sự phủ định tạo tiền đề cho cái mới ra đời trên cơ sở kế thừa có chọn lọc những hạt nhân hợp lý của cái cũ.`;

export const FileStudyStudio: React.FC<FileStudyStudioProps> = ({ onSaveDeck }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [partialWarnings, setPartialWarnings] = useState<string[]>([]);

  const [documents, setDocuments] = useState<ExtractedDocument[]>([]);
  const [selectedSectionKeys, setSelectedSectionKeys] = useState<string[]>([]);
  const [expandedDocIds, setExpandedDocIds] = useState<string[]>([]);

  // Stage 2: Tool Selection (Gradually revealed after reading file(s))
  const [selectedTool, setSelectedTool] = useState<'flashcards' | 'quiz' | 'agents'>('agents');
  const [difficulty, setDifficulty] = useState('Intermediate');
  const [cardCount, setCardCount] = useState(5);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  // Live Multi-Agent Trace State
  const [agentSteps, setAgentSteps] = useState<AgentTraceStep[]>([]);
  const [agentSources, setAgentSources] = useState<ResearchSource[]>([]);

  // Stage 3: Generated Preview
  const [generated, setGenerated] = useState<GeneratedStudyPayload | null>(null);

  const sectionKey = (docId: string, secId: string) => `${docId}::${secId}`;

  const allSectionItems = useMemo(() => {
    return documents.flatMap((doc) =>
      doc.sections.map((sec) => ({
        key: sectionKey(doc.docId, sec.id),
        docId: doc.docId,
        fileName: doc.fileName,
        section: sec,
      }))
    );
  }, [documents]);

  const totalStats = useMemo(() => {
    return documents.reduce(
      (acc, d) => ({
        bytes: acc.bytes + (d.fileSizeBytes || 0),
        words: acc.words + (d.wordCount || 0),
        sections: acc.sections + d.sections.length,
      }),
      { bytes: 0, words: 0, sections: 0 }
    );
  }, [documents]);

  const appendExtractedDocuments = (
    incoming: ExtractedFileResponse[],
    fallbackSizes: Map<string, number>
  ) => {
    if (incoming.length === 0) return;

    const now = Date.now();
    const mapped: ExtractedDocument[] = incoming.map((item, idx) => ({
      ...item,
      docId: `doc-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      fileSizeBytes: item.fileSizeBytes ?? fallbackSizes.get(item.fileName) ?? 0,
    }));

    setDocuments((prev) => [...prev, ...mapped]);
    setSelectedSectionKeys((prev) => [
      ...prev,
      ...mapped.flatMap((d) => d.sections.map((s) => sectionKey(d.docId, s.id))),
    ]);
  };

  const uploadLargeFileInChunks = async (file: File): Promise<ExtractedFileResponse> => {
    const uploadId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE_BYTES));

    for (let idx = 0; idx < totalChunks; idx++) {
      const start = idx * CHUNK_SIZE_BYTES;
      const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
      const blob = file.slice(start, end);

      const percent = Math.round(((idx + 1) / totalChunks) * 100);
      setUploadStatus(
        `Streaming "${file.name}" (${formatFileSize(file.size)}) · Chunk ${idx + 1}/${totalChunks} (${percent}%)`
      );

      const form = new FormData();
      form.append('uploadId', uploadId);
      form.append('chunkIndex', String(idx));
      form.append('chunk', blob, `${file.name}.part`);

      const res = await fetch('/api/files/upload-chunk', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Chunk ${idx + 1} failed for "${file.name}".`);
      }
    }

    setUploadStatus(`Parsing full volume of "${file.name}"...`);
    const finalizeRes = await fetch('/api/files/finalize-chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        fileName: file.name,
        totalChunks,
        fileSizeBytes: file.size,
      }),
    });
    const finalData = await finalizeRes.json();
    if (!finalizeRes.ok) {
      throw new Error(finalData.error || `Could not extract "${file.name}".`);
    }
    return finalData;
  };

  const processIncomingFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setExtractError(null);
    setBuildError(null);
    setPartialWarnings([]);
    setGenerated(null);
    setAgentSteps([]);
    setAgentSources([]);
    setIsExtracting(true);

    const sizeLookup = new Map<string, number>();
    for (const f of files) {
      sizeLookup.set(f.name, f.size);
    }

    const standardFiles = files.filter((f) => f.size <= CHUNK_THRESHOLD_BYTES);
    const largeFiles = files.filter((f) => f.size > CHUNK_THRESHOLD_BYTES);

    const newlyExtracted: ExtractedFileResponse[] = [];
    const warnings: string[] = [];

    try {
      if (standardFiles.length > 0) {
        setUploadStatus(
          standardFiles.length === 1
            ? `Reading "${standardFiles[0].name}"...`
            : `Reading ${standardFiles.length} files together...`
        );
        const formData = new FormData();
        for (const f of standardFiles) {
          formData.append('files', f);
        }

        const res = await fetch('/api/files/extract-batch', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          warnings.push(data.error || 'Could not read batch files.');
        } else {
          if (Array.isArray(data.files)) {
            newlyExtracted.push(...data.files);
          }
          if (Array.isArray(data.failures)) {
            for (const fail of data.failures) {
              warnings.push(`${fail.fileName}: ${fail.error}`);
            }
          }
        }
      }

      for (const largeFile of largeFiles) {
        try {
          const parsedLarge = await uploadLargeFileInChunks(largeFile);
          newlyExtracted.push(parsedLarge);
        } catch (err) {
          warnings.push(
            err instanceof Error ? err.message : `Failed to process "${largeFile.name}".`
          );
        }
      }

      if (newlyExtracted.length > 0) {
        appendExtractedDocuments(newlyExtracted, sizeLookup);
        soundEngine.playMilestone('card_flip');
      }

      if (newlyExtracted.length === 0 && warnings.length > 0) {
        setExtractError(warnings[0]);
      } else if (warnings.length > 0) {
        setPartialWarnings(warnings);
      }
    } catch {
      setExtractError('Network error while reading files. Please try again.');
    } finally {
      setIsExtracting(false);
      setUploadStatus(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processIncomingFiles(e.target.files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void processIncomingFiles(e.dataTransfer.files);
    }
  };

  const handleTrySampleFile = () => {
    const sampleFile = new File([SAMPLE_LECTURE_NOTES], 'neurobiology_lecture_notes.md', {
      type: 'text/markdown',
    });
    void processIncomingFiles([sampleFile]);
  };

  const handleTrySampleMath = () => {
    const mathFile = new File([SAMPLE_MATH_NOTES], 'calculus_and_linear_algebra.md', {
      type: 'text/markdown',
    });
    setSelectedTool('agents');
    void processIncomingFiles([mathFile]);
  };

  const handleTrySampleVietnamese = () => {
    const viFile = new File(
      [SAMPLE_VIETNAMESE_HUMANITIES],
      'triet_hoc_duy_vat_bien_chung.md',
      { type: 'text/markdown' }
    );
    setSelectedTool('agents');
    void processIncomingFiles([viFile]);
  };

  const handleTrySampleBundle = () => {
    const notesFile = new File([SAMPLE_LECTURE_NOTES], 'neurobiology_lecture_notes.md', {
      type: 'text/markdown',
    });
    const csvFile = new File([SAMPLE_COMPANION_CSV], 'cell_biology_glossary.csv', {
      type: 'text/csv',
    });
    void processIncomingFiles([notesFile, csvFile]);
  };

  const handleRemoveDocument = (docId: string) => {
    setDocuments((prev) => prev.filter((d) => d.docId !== docId));
    setSelectedSectionKeys((prev) => prev.filter((k) => !k.startsWith(`${docId}::`)));
    setExpandedDocIds((prev) => prev.filter((id) => id !== docId));
    setGenerated(null);
  };

  const handleClearAllDocuments = () => {
    setDocuments([]);
    setSelectedSectionKeys([]);
    setExpandedDocIds([]);
    setGenerated(null);
    setAgentSteps([]);
    setAgentSources([]);
    setPartialWarnings([]);
    setExtractError(null);
    setBuildError(null);
  };

  const toggleSection = (key: string) => {
    setSelectedSectionKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const toggleDocPreview = (docId: string) => {
    setExpandedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleBuildStudyDeck = async () => {
    if (documents.length === 0) return;
    setBuildError(null);
    setAgentSteps([]);
    setAgentSources([]);

    const activeSections = allSectionItems.filter((item) =>
      selectedSectionKeys.includes(item.key)
    );

    if (allSectionItems.length > 0 && activeSections.length === 0) {
      setBuildError('Please select at least one document section to turn into study cards.');
      return;
    }

    const activeDocIds = new Set(activeSections.map((a) => a.docId));
    const activeFileNames = documents
      .filter((d) => activeDocIds.size === 0 || activeDocIds.has(d.docId))
      .map((d) => d.fileName);

    const sectionsPayload =
      activeSections.length > 0
        ? activeSections.map((item) => ({
            fileName: item.fileName,
            title: item.section.title,
            content: item.section.content,
          }))
        : documents.map((d) => ({
            fileName: d.fileName,
            title: d.fileName,
            content: d.extractedText,
          }));

    setIsBuilding(true);
    try {
      if (selectedTool === 'agents') {
        const result = await runAgentQuizStream(
          {
            fileNames: activeFileNames,
            sections: sectionsPayload,
            difficulty,
            count: cardCount,
          },
          (step, sources) => {
            setAgentSteps((prev) => {
              const without = prev.filter((s) => s.agent !== step.agent);
              return [...without, step];
            });
            if (sources && sources.length > 0) {
              setAgentSources(sources);
            }
          }
        );

        setGenerated({
          ...result,
          tool: 'agents',
          source: 'ai-agents',
        });
        soundEngine.playMilestone('quiz_generated');
        return;
      }

      const res = await fetch('/api/files/generate-study', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileNames: activeFileNames,
          sections: sectionsPayload,
          tool: selectedTool,
          difficulty,
          count: cardCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBuildError(data.error || 'Could not generate study items from these documents.');
        return;
      }
      setGenerated(data);
      soundEngine.playMilestone('quiz_generated');
    } catch (err) {
      setBuildError(
        err instanceof Error
          ? err.message
          : 'Network error while generating study tools. Please retry.'
      );
    } finally {
      setIsBuilding(false);
    }
  };

  const handleSaveResult = (startNow: boolean) => {
    if (!generated) return;
    const now = new Date();
    const deckId = `deck-file-${Date.now()}`;
    const deck: QuizDeck = {
      id: deckId,
      title: generated.title,
      description: generated.description,
      subject: generated.subject,
      domain: generated.domain,
      language: generated.language,
      createdAt: now.toISOString(),
      cards: generated.cards.map((d, idx) =>
        createNewCard(
          {
            id: `${deckId}-c-${idx + 1}`,
            prompt: d.prompt,
            answer: d.answer,
            distractors:
              Array.isArray(d.distractors) && d.distractors.length >= 3
                ? d.distractors.slice(0, 3)
                : ['Alternative A', 'Alternative B', 'Alternative C'],
            acceptableAnswers: d.acceptableAnswers ?? [d.answer],
            hint: d.hint || '',
            explanation: d.explanation || `Answer: ${d.answer}`,
            conceptTag: d.conceptTag || generated.subject,
            exerciseType: d.exerciseType,
            formulaUsed: d.formulaUsed,
            workedSteps: d.workedSteps,
          },
          now
        )
      ),
    };

    const targetMode: QuizMode = generated.tool === 'flashcards' ? 'flashcard' : 'mixed';
    onSaveDeck(deck, startNow, targetMode);
    handleClearAllDocuments();
  };

  const currentStep = generated ? 3 : documents.length > 0 ? 2 : 1;

  return (
    <div className="space-y-6">
      {/* Unboxed Gradual Progress Trail */}
      <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-[#5A6B57]">
        <span className={currentStep >= 1 ? 'font-semibold text-[#2F855A]' : ''}>
          1. Upload & Read Files
        </span>
        <span aria-hidden="true">→</span>
        <span className={currentStep >= 2 ? 'font-semibold text-[#2F855A]' : ''}>
          2. Choose Flashcards, Quiz, or AI Agents
        </span>
        <span aria-hidden="true">→</span>
        <span className={currentStep >= 3 ? 'font-semibold text-[#2F855A]' : ''}>
          3. Study & Practice Skills
        </span>
      </div>

      {/* Stage 1: Multi-File & High-Volume Upload */}
      <div className="rounded-3xl border border-[#E6D5DC] bg-white/95 p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-[#1F2A1E]">
              Step 1 · Read One or Multiple Study Files
            </h2>
            <p className="mt-0.5 text-sm text-[#4E5E4B]">
              Upload several PDF, Word (.docx), PowerPoint (.pptx), Markdown (.md), Text (.txt), CSV,
              or JSON files at once — large multilingual volumes stream in chunks with no 12 MB ceiling.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTrySampleVietnamese}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#E6D5DC] bg-[#FFF8FA] px-3.5 py-2 text-xs font-semibold text-[#9D3E63] transition-colors hover:bg-[#FCEFF4] whitespace-nowrap shrink-0"
            >
              <Globe className="h-3.5 w-3.5" />
              Load Sample Humanities (VI)
            </button>
            <button
              type="button"
              onClick={handleTrySampleMath}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#C7DEC6] bg-[#EFFAF2] px-3.5 py-2 text-xs font-semibold text-[#1D593A] transition-colors hover:bg-[#DCFCE7] whitespace-nowrap shrink-0"
            >
              <Calculator className="h-3.5 w-3.5" />
              Load Sample Math (.md)
            </button>
            <button
              type="button"
              onClick={handleTrySampleFile}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4DFC7] bg-[#FAFDF7] px-3.5 py-2 text-xs font-semibold text-[#2C3A2B] transition-colors hover:bg-[#EFF5E7] whitespace-nowrap shrink-0"
            >
              <FileText className="h-3.5 w-3.5" />
              Load Sample Notes (.md)
            </button>
            <button
              type="button"
              onClick={handleTrySampleBundle}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4DFC7] bg-[#F7FAF2] px-3.5 py-2 text-xs font-semibold text-[#2F855A] transition-colors hover:bg-[#ECF5E2] whitespace-nowrap shrink-0"
            >
              <Files className="h-3.5 w-3.5" />
              Load 2-File Bundle (.md + .csv)
            </button>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
            isDragging
              ? 'border-[#2F855A] bg-[#ECF8F0]'
              : 'border-[#D8E3CE] bg-[#FAFDF7]'
          }`}
        >
          <Upload className="h-7 w-7 text-[#2F855A]" />
          <label
            htmlFor="study-file-upload"
            className="mt-3 cursor-pointer text-sm font-semibold text-[#1F2A1E]"
          >
            Drop one or multiple PDF, DOCX, PPTX, TXT, MD, CSV, or JSON files here, or{' '}
            <span className="text-[#2F855A] underline">browse from device</span>
          </label>
          <input
            ref={fileInputRef}
            id="study-file-upload"
            type="file"
            multiple
            accept=".pdf,.docx,.pptx,.txt,.md,.csv,.json"
            onChange={handleFileChange}
            className="sr-only"
          />
          <p className="mt-1 text-xs text-[#5A6B57]">
            Up to 512 MB per file · Up to 25 files per batch · Add more files anytime
          </p>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isExtracting}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#276749] disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {uploadStatus || 'Reading Documents...'}
              </>
            ) : documents.length > 0 ? (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add More Files
              </>
            ) : (
              'Select Files to Read'
            )}
          </button>
        </div>

        {extractError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
          >
            {extractError}
          </div>
        )}

        {partialWarnings.length > 0 && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-[#FCD34D] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]"
          >
            <p className="font-semibold">Some files were skipped:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {partialWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Stage 2: Gradually Revealed Multi-File Inventory + Sections + Tool Picker */}
      {documents.length > 0 && (
        <div
          data-testid="file-stage-2"
          className="space-y-6 rounded-3xl border border-[#D8E3CE] bg-white/95 p-6 shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E6EEDF] pb-4">
            <div>
              <p className="text-xs font-medium text-[#2F855A] tabular-nums">
                {documents.length} {documents.length === 1 ? 'File' : 'Files'} Read ·{' '}
                {formatFileSize(totalStats.bytes)} total · {totalStats.words.toLocaleString()} words
              </p>
              <h3 className="mt-1 font-display text-xl font-bold text-[#1F2A1E]">
                {documents.length === 1
                  ? documents[0].fileName
                  : `${documents.length} Study Sources Loaded`}
              </h3>
            </div>

            <button
              type="button"
              onClick={handleClearAllDocuments}
              className="rounded-xl border border-[#E2ECD7] bg-[#FAFDF7] px-3 py-1.5 text-xs font-medium text-[#6B4A57] hover:bg-[#FEF2F2] hover:text-[#991B1B] whitespace-nowrap shrink-0"
            >
              Clear All Files
            </button>
          </div>

          {/* Loaded Files Inventory */}
          <div className="space-y-2.5">
            {documents.map((doc) => {
              const isExpanded = expandedDocIds.includes(doc.docId);
              return (
                <div
                  key={doc.docId}
                  className="rounded-2xl border border-[#E2ECD7] bg-[#FAFDF7] p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#1F2A1E]">
                        {doc.fileName}
                      </p>
                      <p className="text-xs text-[#5A6B57] tabular-nums">
                        {doc.fileType} · {formatFileSize(doc.fileSizeBytes)} ·{' '}
                        {doc.wordCount.toLocaleString()} words
                        {doc.pageCount
                          ? ` · ${doc.pageCount} ${doc.fileType === 'PPTX' ? 'slides' : 'pages'}`
                          : ''}{' '}
                        · {doc.sections.length}{' '}
                        {doc.sections.length === 1 ? 'section' : 'sections'}
                        {doc.detectedLanguage ? ` · ${doc.detectedLanguage}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleDocPreview(doc.docId)}
                        className="inline-flex items-center gap-1 rounded-xl border border-[#D8E3CE] bg-white px-2.5 py-1.5 text-xs font-medium text-[#2C3A2B] hover:bg-[#EFF5E7] whitespace-nowrap"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            Hide Text
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            Inspect Text
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        aria-label={`Remove ${doc.fileName}`}
                        onClick={() => handleRemoveDocument(doc.docId)}
                        className="rounded-xl p-1.5 text-[#7A8A77] transition-colors hover:bg-[#FEE2E2] hover:text-[#991B1B]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 space-y-1.5">
                      <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#E6EEDF] bg-white p-3.5 font-sans text-xs leading-relaxed text-[#2A3729]">
                        {doc.extractedText}
                      </pre>
                      {doc.isPreviewTruncated && (
                        <p className="text-[11px] text-[#5A6B57]">
                          Preview shows the opening 45,000 characters; all {doc.sections.length}{' '}
                          sections across the full volume remain indexed below.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detected Sections Checklist Across All Files */}
          {allSectionItems.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#4E5E4B] tabular-nums">
                  Detected Sections Across Files ({selectedSectionKeys.length} of{' '}
                  {allSectionItems.length} selected)
                </p>
                <div className="flex items-center gap-3 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setSelectedSectionKeys(allSectionItems.map((i) => i.key))}
                    className="text-[#2F855A] hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSectionKeys([])}
                    className="text-[#5A6B57] hover:underline"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="mt-2.5 grid max-h-72 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {allSectionItems.map(({ key, fileName, section }) => {
                  const checked = selectedSectionKeys.includes(key);
                  return (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 text-left transition-colors ${
                        checked
                          ? 'border-[#2F855A] bg-[#ECF8F0]'
                          : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSection(key)}
                        className="mt-0.5 h-4 w-4 accent-[#2F855A]"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#1F2A1E]">
                          {section.title}
                        </p>
                        <p className="truncate text-xs text-[#5A6B57] tabular-nums">
                          {documents.length > 1 ? `${fileName} · ` : ''}
                          {section.wordCount.toLocaleString()} words
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tool Selector: AI Agents (Search + Math Exercises) vs Flashcards vs Quiz */}
          <div className="space-y-3 pt-1">
            <h3 className="font-display text-lg font-semibold text-[#1F2A1E]">
              Step 2 · Choose Your Interactive Study Tool
            </h3>
            <div className="grid gap-4 lg:grid-cols-3">
              <button
                type="button"
                aria-pressed={selectedTool === 'agents'}
                onClick={() => setSelectedTool('agents')}
                className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-colors ${
                  selectedTool === 'agents'
                    ? 'border-[#2F855A] bg-[#ECF8F0]'
                    : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                }`}
              >
                <div className="rounded-xl bg-white p-2.5 text-[#2F855A] shadow-2xs">
                  <Bot className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-base font-semibold text-[#1F2A1E]">
                      AI Agents · Deep Synthesis & Practice
                    </span>
                    {selectedTool === 'agents' && (
                      <Check className="h-4 w-4 text-[#2F855A] shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#4E5E4B]">
                    Classifies STEM, Humanities, Applied Case, or Language material, mirrors your
                    document language, and builds verified drills with reasoning steps.
                  </p>
                </div>
              </button>

              <button
                type="button"
                aria-pressed={selectedTool === 'flashcards'}
                onClick={() => setSelectedTool('flashcards')}
                className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-colors ${
                  selectedTool === 'flashcards'
                    ? 'border-[#2F855A] bg-[#ECF8F0]'
                    : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                }`}
              >
                <div className="rounded-xl bg-white p-2.5 text-[#2F855A] shadow-2xs">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-base font-semibold text-[#1F2A1E]">
                      Interactive Flashcards
                    </span>
                    {selectedTool === 'flashcards' && (
                      <Check className="h-4 w-4 text-[#2F855A] shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#4E5E4B]">
                    Creates active-recall Front/Back flashcards with hints and SM-2 flip ratings
                    synthesized across your selected files.
                  </p>
                </div>
              </button>

              <button
                type="button"
                aria-pressed={selectedTool === 'quiz'}
                onClick={() => setSelectedTool('quiz')}
                className={`flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-colors ${
                  selectedTool === 'quiz'
                    ? 'border-[#2F855A] bg-[#ECF8F0]'
                    : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                }`}
              >
                <div className="rounded-xl bg-white p-2.5 text-[#A2496B] shadow-2xs">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-base font-semibold text-[#1F2A1E]">
                      Interactive Quiz Generator
                    </span>
                    {selectedTool === 'quiz' && (
                      <Check className="h-4 w-4 text-[#2F855A] shrink-0" />
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#4E5E4B]">
                    Builds comprehension questions with 4-option multiple choice, plausible
                    distractors, and typed recall checks.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Parameters & Generate Button */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-[#E6EEDF] pt-4">
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label
                  htmlFor="file-study-count"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Items to Create
                </label>
                <select
                  id="file-study-count"
                  value={cardCount}
                  onChange={(e) => setCardCount(Number(e.target.value))}
                  className="mt-1 rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3 py-2 text-xs font-medium text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                >
                  <option value={5}>5 items</option>
                  <option value={8}>8 items</option>
                  <option value={12}>12 items</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="file-study-difficulty"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Depth
                </label>
                <select
                  id="file-study-difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="mt-1 rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3 py-2 text-xs font-medium text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                >
                  <option value="Foundational">Foundational</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Exam Prep">Exam Prep</option>
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={handleBuildStudyDeck}
              disabled={isBuilding}
              className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#276749] disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {isBuilding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {selectedTool === 'agents'
                    ? 'Running AI Agents...'
                    : `Building ${selectedTool === 'flashcards' ? 'Flashcards' : 'Quiz'}...`}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {selectedTool === 'agents'
                    ? 'Run AI Agents & Build Exercises'
                    : selectedTool === 'flashcards'
                    ? 'Build Flashcards Deck'
                    : 'Generate Interactive Quiz'}
                </>
              )}
            </button>
          </div>

          {/* Live AI Agent Proof-of-Work Trace */}
          {agentSteps.length > 0 && (
            <div
              data-testid="agent-trace-panel"
              className="space-y-3 rounded-2xl border border-[#C7DEC6] bg-[#F6FBF3] p-4"
            >
              <p className="text-xs font-semibold text-[#1D593A]">
                AI Agent Pipeline Trace
              </p>
              <div className="space-y-2">
                {agentSteps.map((step) => (
                  <div
                    key={step.agent}
                    className="flex items-start gap-2.5 text-xs text-[#2A3729]"
                  >
                    {step.status === 'running' ? (
                      <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-[#2F855A] shrink-0" />
                    ) : (
                      <Check className="mt-0.5 h-3.5 w-3.5 text-[#2F855A] shrink-0" />
                    )}
                    <div>
                      <span className="font-semibold text-[#1F2A1E]">{step.label}: </span>
                      <span>{step.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {buildError && (
            <div
              role="alert"
              className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
            >
              {buildError}
            </div>
          )}
        </div>
      )}

      {/* Stage 3: Generated Study Set Preview & Instant Launch */}
      {generated && (
        <div
          data-testid="file-stage-3"
          className="rounded-3xl border border-[#9FD0A8] bg-white/95 p-6 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EEDF] pb-4">
            <div>
              <p className="text-xs font-medium text-[#2F855A]">
                Step 3 ·{' '}
                {generated.tool === 'flashcards'
                  ? 'Flashcard Deck'
                  : generated.tool === 'agents'
                  ? 'AI-Agent Adaptive Study Set'
                  : 'Interactive Quiz'}{' '}
                · {generated.cards.length} items ready
                {generated.language ? ` · ${generated.language}` : ''}
              </p>
              <h3 className="mt-1 font-display text-2xl font-bold text-[#1F2A1E]">
                {generated.title}
              </h3>
              <p className="mt-0.5 text-sm text-[#4E5E4B]">{generated.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleSaveResult(false)}
                className="rounded-xl border border-[#D4DFC7] bg-[#F7FAF2] px-4 py-2.5 text-sm font-semibold text-[#1F2A1E] hover:bg-[#ECF3E2] whitespace-nowrap shrink-0"
              >
                Save to Meadow
              </button>
              <button
                type="button"
                onClick={() => handleSaveResult(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#276749] whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4" />
                {generated.tool === 'flashcards'
                  ? 'Study Flashcards Now'
                  : generated.tool === 'agents'
                  ? 'Launch Adaptive Practice'
                  : 'Start Interactive Quiz'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {generated.cards.map((card, i) => (
              <div
                key={i}
                className="rounded-2xl border border-[#E6EEDF] bg-[#FAFDF7] p-4"
              >
                <p className="text-xs text-[#5A6B57]">
                  {i + 1}. {card.conceptTag}
                  {card.exerciseType ? ` · ${card.exerciseType}` : ''}
                </p>
                <p className="mt-1 text-sm font-semibold text-[#1F2A1E]">{card.prompt}</p>
                {card.formulaUsed && (
                  <p className="mt-1 font-mono text-xs text-[#425540]">
                    Formula: {card.formulaUsed}
                  </p>
                )}
                <p className="mt-1.5 text-sm font-medium text-[#2F855A]">
                  Answer: {card.answer}
                </p>
                {card.workedSteps && card.workedSteps.length > 0 && (
                  <p className="mt-1 text-xs text-[#5A6B57]">
                    {card.workedSteps.length} worked steps included for StudySession scaffolding
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
