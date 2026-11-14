import type { GeneratedCardDraft } from '../types/quiz';

export interface DocumentSection {
  id: string;
  title: string;
  content: string;
  wordCount: number;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Lightweight deterministic language detector supporting Vietnamese, Japanese,
 * Korean, French, Spanish, German, and English so prompts and offline builders
 * mirror the document's language faithfully.
 */
export function detectDocumentLanguage(rawText: string): string {
  const sample = rawText.slice(0, 6000);
  if (!sample.trim()) return 'English';

  const viDistinctChars = (sample.match(/[ăâđêôơưĂÂĐÊÔƠƯ]/g) ?? []).length;
  const viTonedVowels = (
    sample.match(
      /[àáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi
    ) ?? []
  ).length;
  const viWords = (
    sample.match(/\b(là|của|và|trong|những|các|được|cho|với|từ|này|không|khi|theo)\b/gi) ??
    []
  ).length;

  if (viDistinctChars >= 2 || viTonedVowels >= 4 || (viDistinctChars >= 1 && viWords >= 2)) {
    return 'Vietnamese';
  }

  const jpCount = (sample.match(/[\u3040-\u30ff]/g) ?? []).length;
  if (jpCount >= 4) return 'Japanese';

  const koCount = (sample.match(/[\uac00-\ud7af]/g) ?? []).length;
  if (koCount >= 4) return 'Korean';

  const zhCount = (sample.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (zhCount >= 6) return 'Chinese';

  const frWords = (
    sample.match(/\b(les|des|est|une|dans|pour|avec|sont|cette|qui)\b/gi) ?? []
  ).length;
  if (frWords >= 4 && /[éèêàçù]/i.test(sample)) return 'French';

  const esWords = (
    sample.match(/\b(los|las|una|para|con|por|como|entre|sobre|son)\b/gi) ?? []
  ).length;
  if (esWords >= 4 && /[áéíóúñ¿¡]/i.test(sample)) return 'Spanish';

  const deWords = (
    sample.match(/\b(der|die|das|und|mit|für|von|sind|eine|nicht)\b/gi) ?? []
  ).length;
  if (deWords >= 4) return 'German';

  return 'English';
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Extracts ordered slide text from PPTX slide XML entries (`ppt/slides/slideN.xml`).
 */
export function extractTextFromPptxXmlSlides(
  slides: Array<{ name: string; xml: string }>
): { text: string; slideCount: number } {
  const ordered = [...slides].sort((a, b) => {
    const numA = Number(/slide(\d+)\.xml$/i.exec(a.name)?.[1] ?? 0);
    const numB = Number(/slide(\d+)\.xml$/i.exec(b.name)?.[1] ?? 0);
    return numA - numB;
  });

  const slideBlocks: string[] = [];

  for (let idx = 0; idx < ordered.length; idx++) {
    const xml = ordered[idx].xml;
    const paragraphs: string[] = [];
    const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(xml)) !== null) {
      const pContent = pMatch[1];
      const runs: string[] = [];
      const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(pContent)) !== null) {
        const piece = decodeXmlEntities(tMatch[1]);
        if (piece) runs.push(piece);
      }
      const line = runs.join('').replace(/\s+/g, ' ').trim();
      if (line) paragraphs.push(line);
    }

    if (paragraphs.length === 0) {
      // Fallback if slide uses <a:t> without standard <a:p> wrappers
      const runs: string[] = [];
      const tRegex = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRegex.exec(xml)) !== null) {
        const piece = decodeXmlEntities(tMatch[1]).trim();
        if (piece) runs.push(piece);
      }
      if (runs.length > 0) {
        paragraphs.push(runs.join(' '));
      }
    }

    if (paragraphs.length > 0) {
      const slideNum = /slide(\d+)\.xml$/i.exec(ordered[idx].name)?.[1] ?? String(idx + 1);
      const firstLine = paragraphs[0];
      const bodyLines = paragraphs.slice(1).join('\n');
      const heading = firstLine.length <= 72 ? `Slide ${slideNum}: ${firstLine}` : `Slide ${slideNum}`;
      const body = firstLine.length <= 72 ? bodyLines : paragraphs.join('\n');
      slideBlocks.push(body ? `# ${heading}\n${body}` : `# ${heading}`);
    }
  }

  return {
    text: cleanExtractedText(slideBlocks.join('\n\n')),
    slideCount: ordered.length,
  };
}

export function detectDocumentSections(rawText: string): DocumentSection[] {
  const text = cleanExtractedText(rawText);
  if (!text) return [];

  const lines = text.split('\n');
  const sections: DocumentSection[] = [];
  let currentTitle = 'Overview';
  let buffer: string[] = [];

  const isHeading = (line: string): string | null => {
    const t = line.trim();
    if (!t) return null;

    // Markdown headings: # Title
    const md = /^#{1,4}\s+(.+)$/.exec(t);
    if (md) return md[1].trim();

    // Explicit Chapter / Phần / Chương / Mục / Slide / Unit headings (Unicode-aware)
    const explicitChapter =
      /^(?:chương|phần|mục|bài|chủ đề|chapter|part|section|unit|module|slide)\s+(?:[IVXLCDM]+|\d+(?:\.\d+)*)(?:\s*[:.\-–—]\s*.+)?$/iu.exec(
        t
      );
    if (explicitChapter && t.length <= 90) return t;

    // Unicode numbered headings: 1. Title or 1.2 Title (short, no trailing period)
    const num = /^(\d+(?:\.\d+)*[.)]\s+\p{L}[\p{L}\p{N}\s,&/()'’"“”–—-]{2,70})$/u.exec(t);
    if (num && !t.endsWith('.')) return num[1].trim();

    // Short standalone Unicode title line starting with uppercase letter
    if (
      t.length >= 4 &&
      t.length <= 64 &&
      /^\p{Lu}/u.test(t) &&
      !/[.!?;,:]$/.test(t) &&
      !t.includes(': ') &&
      t.split(/\s+/).length <= 10
    ) {
      return t;
    }
    return null;
  };

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) {
      sections.push({
        id: `sec-${sections.length + 1}`,
        title: currentTitle,
        content: body,
        wordCount: countWords(body),
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = isHeading(line);
    const nextLine = lines[i + 1] ?? '';
    const isMarkdown = /^#{1,4}\s+/.test(line.trim());
    if (heading && (isMarkdown || buffer.length > 0 || nextLine.trim().length > 0)) {
      if (buffer.length > 0) {
        flush();
      }
      currentTitle = heading;
    } else {
      buffer.push(line);
    }
  }
  flush();

  // If document had no headings and is long, chunk into readable sections
  if (sections.length === 1 && sections[0].wordCount > 240) {
    const paragraphs = sections[0].content.split(/\n\n+/);
    const targetWordsPerChunk =
      sections[0].wordCount > 10000 ? Math.ceil(sections[0].wordCount / 16) : 200;
    const chunked: DocumentSection[] = [];
    let acc: string[] = [];
    let accWords = 0;

    for (const p of paragraphs) {
      const w = countWords(p);
      if (accWords > 0 && accWords + w > targetWordsPerChunk) {
        const joined = acc.join('\n\n').trim();
        chunked.push({
          id: `sec-${chunked.length + 1}`,
          title: `Section ${chunked.length + 1}`,
          content: joined,
          wordCount: countWords(joined),
        });
        acc = [p];
        accWords = w;
      } else {
        acc.push(p);
        accWords += w;
      }
    }
    if (acc.length > 0) {
      const joined = acc.join('\n\n').trim();
      chunked.push({
        id: `sec-${chunked.length + 1}`,
        title: `Section ${chunked.length + 1}`,
        content: joined,
        wordCount: countWords(joined),
      });
    }
    return consolidateHighVolumeSections(chunked, 20);
  }

  return consolidateHighVolumeSections(sections, 24);
}

/**
 * For very large textbooks or multi-hundred-page PDFs with dozens of headings,
 * consolidates neighboring headings into manageable study chapters so the UI stays fast
 * while retaining full coverage across the whole volume.
 */
function consolidateHighVolumeSections(
  sections: DocumentSection[],
  maxSections: number
): DocumentSection[] {
  if (sections.length <= maxSections) return sections;

  const groupSize = Math.ceil(sections.length / maxSections);
  const consolidated: DocumentSection[] = [];
  for (let i = 0; i < sections.length; i += groupSize) {
    const slice = sections.slice(i, i + groupSize);
    const firstTitle = slice[0]?.title ?? `Part ${consolidated.length + 1}`;
    const title =
      slice.length > 1 ? `${firstTitle} (+${slice.length - 1} more)` : firstTitle;
    const content = slice.map((s) => `${s.title}\n${s.content}`).join('\n\n');
    consolidated.push({
      id: `sec-${consolidated.length + 1}`,
      title,
      content,
      wordCount: slice.reduce((sum, s) => sum + s.wordCount, 0),
    });
  }
  return consolidated;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

/**
 * Stratified sampling within a single long section: retains beginning, middle, and ending
 * passages rather than chopping off everything after the opening sentences.
 */
function sampleStratifiedText(text: string, budget: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return trimmed;
  if (budget < 180) {
    const half = Math.max(40, Math.floor((budget - 9) / 2));
    return `${trimmed.slice(0, half).trimEnd()}\n[...]\n${trimmed.slice(-half).trimStart()}`;
  }

  const separator = '\n[...]\n';
  const usable = Math.max(120, budget - separator.length * 2);
  const startLen = Math.floor(usable * 0.4);
  const midLen = Math.floor(usable * 0.3);
  const endLen = Math.max(40, usable - startLen - midLen);

  const startPart = trimmed.slice(0, startLen).trimEnd();
  const midCenter = Math.floor(trimmed.length / 2);
  const midStart = Math.max(startLen, Math.floor(midCenter - midLen / 2));
  const midPart = trimmed.slice(midStart, midStart + midLen).trim();
  const endPart = trimmed.slice(Math.max(midStart + midLen, trimmed.length - endLen)).trimStart();

  return `${startPart}${separator}${midPart}${separator}${endPart}`;
}

/**
 * Distributes character budget proportionally across every selected section and file,
 * sampling beginning + middle + end of long chapters so multi-file and 200+ page volumes
 * retain full thematic coverage.
 */
export function buildBalancedStudyExcerpt(
  sections: Array<{ fileName?: string; title: string; content: string }>,
  maxChars: number = 22000
): string {
  const valid = sections.filter((s) => s.content && s.content.trim().length > 0);
  if (valid.length === 0) return '';

  const totalChars = valid.reduce((sum, s) => sum + s.content.length, 0);
  if (totalChars <= maxChars) {
    return valid
      .map((s) => {
        const prefix = s.fileName ? `[${s.fileName}] ` : '';
        return `# ${prefix}${s.title}\n${s.content.trim()}`;
      })
      .join('\n\n');
  }

  const headerAllowance = valid.reduce(
    (sum, s) => sum + (s.fileName ? s.fileName.length + 4 : 0) + s.title.length + 10,
    0
  );
  const contentBudget = Math.max(valid.length * 90, maxChars - headerAllowance);
  const perSectionBudget = Math.max(90, Math.floor(contentBudget / valid.length));

  return valid
    .map((s) => {
      const prefix = s.fileName ? `[${s.fileName}] ` : '';
      const snippet = sampleStratifiedText(s.content, perSectionBudget);
      return `# ${prefix}${s.title}\n${snippet}`;
    })
    .join('\n\n')
    .slice(0, maxChars);
}

export function parseCsvToStudyPairs(
  csvText: string
): Array<{ prompt: string; answer: string }> {
  const lines = cleanExtractedText(csvText)
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const pairs: Array<{ prompt: string; answer: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvRow(lines[i]);
    if (cols.length < 2) continue;
    const left = cols[0].trim();
    const right = cols[1].trim();
    if (!left || !right) continue;
    if (
      i === 0 &&
      /^(question|term|front|prompt|câu hỏi|thuật ngữ)$/i.test(left) &&
      /^(answer|definition|back|đáp án|định nghĩa)$/i.test(right)
    ) {
      continue;
    }
    pairs.push({ prompt: left, answer: right });
  }
  return pairs;
}

function splitCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Deterministic multilingual fallback extractor when LLM endpoints are unavailable.
 * Supports Unicode scripts (including Vietnamese diacritics) and mirrors the document language.
 */
export function buildStudyItemsFromDocumentText(
  rawText: string,
  tool: 'flashcards' | 'quiz',
  maxCount: number = 6,
  subjectHint: string = 'Document Study'
): GeneratedCardDraft[] {
  const text = cleanExtractedText(rawText);
  if (!text) return [];

  const language = detectDocumentLanguage(text);
  const isVi = language === 'Vietnamese';
  const drafts: GeneratedCardDraft[] = [];

  // 1. Extract Unicode "Term: Definition" or "Term - Definition" lines
  const lines = text.split('\n');
  const kvPairs: Array<{ term: string; def: string }> = [];
  const seenTerms = new Set<string>();

  const pushPair = (termRaw: string, defRaw: string) => {
    const term = termRaw.trim();
    const def = defRaw.trim().replace(/\.$/, '');
    if (!term || !def) return;
    const key = term.toLowerCase();
    if (seenTerms.has(key)) return;
    seenTerms.add(key);
    kvPairs.push({ term, def });
  };

  for (const line of lines) {
    const cleaned = line.replace(/^[-*•#+\s]+/, '').trim();
    const kv = /^([\p{L}\p{N}\s/(),.'’"“”-]{2,64})\s*[:–—-]\s+(.{8,240})$/u.exec(cleaned);
    if (kv && !/^https?$/i.test(kv[1])) {
      pushPair(kv[1], kv[2]);
    }
  }

  // 2. Extract multilingual declarative sentences ("X là Y", "X được định nghĩa là Y", "X is Y", etc.)
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24 && s.length <= 260);

  const defRegex =
    /^([\p{Lu}\p{L}][\p{L}\p{N}\s,.'’()-]{1,56}?)\s+(?:là|được định nghĩa là|có nghĩa là|bao gồm|gồm có|dùng để|đóng vai trò|thể hiện|phản ánh|tạo nên|is|are|refers to|means|converts|transports|stores|defines|est|signifie)\s+(.{8,220})\.?$/iu;

  for (const s of sentences) {
    const m = defRegex.exec(s);
    if (m) {
      pushPair(m[1], m[2]);
    }
  }

  const answerPool = kvPairs.map((p) => p.term);
  const genericTermDistractors = isVi
    ? ['Yếu tố bổ trợ thứ cấp', 'Hiện tượng bề mặt tạm thời', 'Cơ chế điều chỉnh gián tiếp']
    : ['Secondary contextual factor', 'Transient surface effect', 'Indirect regulatory shift'];
  const genericDefDistractors = isVi
    ? [
        'Một quá trình phụ không liên quan trực tiếp',
        'Hiện tượng nhất thời không làm thay đổi bản chất',
        'Cơ chế đảo ngược làm giảm hiệu quả hệ thống',
      ]
    : [
        'An unrelated secondary process',
        'A temporary surface artifact',
        'An inverse feedback mechanism',
      ];

  for (let i = 0; i < kvPairs.length && drafts.length < maxCount; i++) {
    const { term, def } = kvPairs[i];
    const otherTerms = answerPool.filter((t) => t.toLowerCase() !== term.toLowerCase());
    const distractors = [...otherTerms, ...genericTermDistractors].slice(0, 3);

    if (tool === 'flashcards') {
      drafts.push({
        prompt: isVi ? `Trình bày và giải thích: ${term}` : `Define or explain: ${term}`,
        answer: def,
        distractors: kvPairs
          .filter((_, idx) => idx !== i)
          .slice(0, 3)
          .map((p) => p.def)
          .concat(genericDefDistractors)
          .slice(0, 3),
        acceptableAnswers: [def],
        hint: isVi
          ? `Bắt đầu bằng "${def.slice(0, Math.min(16, def.length))}..."`
          : `Starts with "${def.slice(0, Math.min(14, def.length))}..."`,
        explanation: `${term}: ${def}.`,
        conceptTag: subjectHint,
        exerciseType: 'conceptual',
        workedSteps: isVi
          ? [`Xác định đối tượng trọng tâm: ${term}`, `Đối chiếu nội dung cốt lõi trong tài liệu: ${def}`]
          : [`Identify core concept: ${term}`, `Match exact meaning from source: ${def}`],
      });
    } else {
      drafts.push({
        prompt: isVi
          ? `Khái niệm nào trong tài liệu tương ứng với mô tả sau: "${def}"?`
          : `Which concept from your document matches this description: "${def}"?`,
        answer: term,
        distractors,
        acceptableAnswers: [term],
        hint: isVi
          ? `Chú ý thuật ngữ bắt đầu bằng "${term.slice(0, Math.min(3, term.length))}".`
          : `Look closely at the term starting with "${term.slice(0, 2)}".`,
        explanation: `${term} — ${def}.`,
        conceptTag: subjectHint,
        exerciseType: 'conceptual',
        workedSteps: isVi
          ? [`Phân tích dấu hiệu mô tả: "${def}"`, `Liên kết với khái niệm chính xác: ${term}`]
          : [`Analyze key description: "${def}"`, `Connect description to concept: ${term}`],
      });
    }
  }

  // 3. Build Unicode-aware fill-in-the-blank recall cards from remaining informative sentences
  const fillerWordPool = Array.from(
    new Set(
      text
        .split(/\s+/)
        .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
        .filter((w) => w.length >= 5 && /^[\p{L}-]+$/u.test(w))
    )
  );

  for (const s of sentences) {
    if (drafts.length >= maxCount) break;
    const words = s.replace(/[.!?]$/, '').split(/\s+/);
    if (words.length < 6) continue;

    const candidates = words
      .map((w, idx) => ({ w: w.replace(/[,;:()"“”'’]/g, ''), idx }))
      .filter((x) => x.idx >= 2 && x.w.length >= 4 && /^[\p{L}-]+$/u.test(x.w));
    if (candidates.length === 0) continue;

    const picked = candidates[candidates.length - 1];
    const blanked = words
      .map((w, idx) => (idx === picked.idx ? '______' : w))
      .join(' ');

    if (drafts.some((d) => d.answer.toLowerCase() === picked.w.toLowerCase())) {
      continue;
    }

    const fallbackWords = isVi
      ? ['biện chứng', 'khách quan', 'thực tiễn', 'hệ thống']
      : ['equilibrium', 'synthesis', 'structure', 'mechanism'];
    const distractorCandidates = [
      ...fillerWordPool.filter((w) => w.toLowerCase() !== picked.w.toLowerCase()),
      ...fallbackWords.filter((w) => w.toLowerCase() !== picked.w.toLowerCase()),
    ];

    drafts.push({
      prompt: isVi
        ? `Hoàn thành nhận định sau từ tài liệu: "${blanked}"`
        : `Complete the statement from your document: "${blanked}"`,
      answer: picked.w,
      distractors: distractorCandidates.slice(0, 3),
      acceptableAnswers: [picked.w],
      hint: isVi
        ? `Từ gồm ${picked.w.length} ký tự, bắt đầu bằng "${picked.w[0]}".`
        : `${picked.w.length} letters, starts with "${picked.w[0]}"`,
      explanation: isVi ? `Nguyên văn tài liệu: "${s}"` : `Full source sentence: "${s}"`,
      conceptTag: subjectHint,
      exerciseType: 'conceptual',
      workedSteps: isVi
        ? [`Đọc ngữ cảnh câu trích dẫn trong tài liệu`, `Chọn từ khóa phù hợp về ngữ nghĩa: "${picked.w}"`]
        : [`Review sentence context from reading`, `Select matching key term: "${picked.w}"`],
    });
  }

  return drafts.slice(0, maxCount);
}
