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
    const md = /^#{1,3}\s+(.+)$/.exec(t);
    if (md) return md[1].trim();
    // Numbered headings: 1. Title or 1.2 Title (short, no trailing period)
    const num = /^(\d+(?:\.\d+)*[.)]\s+[A-Z][\w\s,&/-]{2,60})$/.exec(t);
    if (num && !t.endsWith('.')) return num[1].trim();
    // Short standalone title line followed by content (no sentence punctuation)
    if (
      t.length >= 4 &&
      t.length <= 54 &&
      /^[A-Z]/.test(t) &&
      !/[.!?;,]$/.test(t) &&
      t.split(/\s+/).length <= 8
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
    // Require either markdown syntax or non-empty content around short standalone heading
    const isMarkdown = /^#{1,3}\s+/.test(line.trim());
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

  // If document had no headings and is long, chunk into readable ~220-word sections
  if (sections.length === 1 && sections[0].wordCount > 240) {
    const paragraphs = sections[0].content.split(/\n\n+/);
    const targetWordsPerChunk = sections[0].wordCount > 10000 ? Math.ceil(sections[0].wordCount / 16) : 200;
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
      slice.length > 1
        ? `${firstTitle} (+${slice.length - 1} more)`
        : firstTitle;
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
 * Distributes character budget proportionally across every selected section and file
 * so multi-file and large-volume study generation samples from ALL uploaded documents,
 * rather than truncating after the first few pages of File 1.
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

  // Reserve space for headers so later files/sections are never truncated away
  const headerAllowance = valid.reduce(
    (sum, s) => sum + (s.fileName ? s.fileName.length + 4 : 0) + s.title.length + 10,
    0
  );
  const contentBudget = Math.max(valid.length * 80, maxChars - headerAllowance);
  const perSectionBudget = Math.max(80, Math.floor(contentBudget / valid.length));

  return valid
    .map((s) => {
      const prefix = s.fileName ? `[${s.fileName}] ` : '';
      const trimmed = s.content.trim();
      const snippet =
        trimmed.length <= perSectionBudget
          ? trimmed
          : `${trimmed.slice(0, perSectionBudget)}...`;
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
    // Skip obvious header row
    if (
      i === 0 &&
      /^(question|term|front|prompt)$/i.test(left) &&
      /^(answer|definition|back)$/i.test(right)
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
 * Deterministic fallback extractor when AI generation is unavailable or for structured CSV files.
 * Builds genuine atomic flashcards or quiz questions directly from the uploaded document text.
 */
export function buildStudyItemsFromDocumentText(
  rawText: string,
  tool: 'flashcards' | 'quiz',
  maxCount: number = 6,
  subjectHint: string = 'Document Study'
): GeneratedCardDraft[] {
  const text = cleanExtractedText(rawText);
  if (!text) return [];

  const drafts: GeneratedCardDraft[] = [];

  // 1. Extract "Term: Definition" or "Term - Definition" lines first
  const lines = text.split('\n');
  const kvPairs: Array<{ term: string; def: string }> = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-*•]\s*/, '').trim();
    const kv = /^([A-Za-z0-9\s/()-]{2,48})\s*[:–—-]\s+(.{8,220})$/.exec(cleaned);
    if (kv && !/^https?$/i.test(kv[1])) {
      kvPairs.push({ term: kv[1].trim(), def: kv[2].trim().replace(/\.$/, '') });
    }
  }

  // 2. Also extract declarative "X is/are/refers to Y" sentences
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 28 && s.length <= 240);

  const defRegex =
    /^([A-Z][A-Za-z0-9\s-]{2,45}?)\s+(?:is|are|refers to|means|converts|transports|stores)\s+(.{10,180})\.?$/;

  for (const s of sentences) {
    const m = defRegex.exec(s);
    if (m) {
      kvPairs.push({ term: m[1].trim(), def: m[2].trim().replace(/\.$/, '') });
    }
  }

  // Collect pool of answers for plausible distractors
  const answerPool = kvPairs.map((p) => p.term);

  for (let i = 0; i < kvPairs.length && drafts.length < maxCount; i++) {
    const { term, def } = kvPairs[i];
    const otherTerms = answerPool.filter((t) => t.toLowerCase() !== term.toLowerCase());
    const distractors = [
      otherTerms[0] ?? 'Passive sensory adaptation',
      otherTerms[1] ?? 'Baseline metabolic drift',
      otherTerms[2] ?? 'Unrelated structural factor',
    ];

    if (tool === 'flashcards') {
      drafts.push({
        prompt: `Define or explain: ${term}`,
        answer: def,
        distractors: kvPairs
          .filter((_, idx) => idx !== i)
          .slice(0, 3)
          .map((p) => p.def)
          .concat(['An unrelated secondary process', 'A temporary surface artifact', 'An inverse feedback loop'])
          .slice(0, 3),
        acceptableAnswers: [def],
        hint: `Starts with "${def.slice(0, Math.min(14, def.length))}..."`,
        explanation: `${term}: ${def}.`,
        conceptTag: subjectHint,
      });
    } else {
      drafts.push({
        prompt: `Which concept from your document matches this description: "${def}"?`,
        answer: term,
        distractors: distractors.slice(0, 3),
        acceptableAnswers: [term],
        hint: `Look closely at the term starting with "${term.slice(0, 2)}".`,
        explanation: `${term} — ${def}.`,
        conceptTag: subjectHint,
      });
    }
  }

  // 3. If still under maxCount, turn remaining informative sentences into fill/recall cards
  for (const s of sentences) {
    if (drafts.length >= maxCount) break;
    const words = s.replace(/[.!?]$/, '').split(/\s+/);
    if (words.length < 7) continue;
    // Pick a salient longer word near the end as target concept
    const candidates = words
      .map((w, idx) => ({ w: w.replace(/[,;:()"]/g, ''), idx }))
      .filter((x) => x.idx >= 2 && x.w.length >= 5 && /^[A-Za-z-]+$/.test(x.w));
    if (candidates.length === 0) continue;

    const picked = candidates[candidates.length - 1];
    const blanked = words
      .map((w, idx) => (idx === picked.idx ? '______' : w))
      .join(' ');

    if (drafts.some((d) => d.answer.toLowerCase() === picked.w.toLowerCase())) {
      continue;
    }

    drafts.push({
      prompt: `Complete the statement from your document: "${blanked}"`,
      answer: picked.w,
      distractors: ['equilibrium', 'synthesis', 'gradient']
        .filter((d) => d.toLowerCase() !== picked.w.toLowerCase())
        .concat(['baseline'])
        .slice(0, 3),
      acceptableAnswers: [picked.w],
      hint: `${picked.w.length} letters, starts with "${picked.w[0]}"`,
      explanation: `Full source sentence: "${s}"`,
      conceptTag: subjectHint,
    });
  }

  return drafts.slice(0, maxCount);
}
