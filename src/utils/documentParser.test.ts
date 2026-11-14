import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBalancedStudyExcerpt,
  buildStudyItemsFromDocumentText,
  cleanExtractedText,
  countWords,
  detectDocumentSections,
  formatFileSize,
  parseCsvToStudyPairs,
} from './documentParser';

test('cleanExtractedText normalizes line endings and trims whitespace', () => {
  const cleaned = cleanExtractedText('Hello\r\n\r\n\r\nWorld   \n');
  assert.equal(cleaned, 'Hello\n\nWorld');
  assert.equal(countWords(cleaned), 2);
});

test('detectDocumentSections splits markdown headings into labeled sections', () => {
  const doc = `# Photosynthesis Overview
Chloroplasts capture sunlight to build sugars.

# Light Reactions
Thylakoids split water molecules and release oxygen.`;

  const sections = detectDocumentSections(doc);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, 'Photosynthesis Overview');
  assert.equal(sections[1].title, 'Light Reactions');
  assert.ok(sections[0].wordCount >= 5);
});

test('detectDocumentSections consolidates high-volume documents with 40+ headings', () => {
  const hugeDoc = Array.from({ length: 42 }, (_, i) => {
    return `# Chapter ${i + 1}\nKey concept ${i + 1}: important biological mechanism studied in week ${i + 1}.`;
  }).join('\n\n');

  const sections = detectDocumentSections(hugeDoc);
  assert.ok(sections.length <= 24);
  assert.ok(sections.length >= 10);
  const totalWords = sections.reduce((sum, s) => sum + s.wordCount, 0);
  assert.ok(totalWords > 300);
});

test('buildBalancedStudyExcerpt distributes budget fairly across multiple files', () => {
  const longTextA = 'Alpha mitochondrial matrix reaction '.repeat(120);
  const longTextB = 'Beta chloroplast stroma cycle '.repeat(120);
  const longTextC = 'Gamma ribosomal translation step '.repeat(120);

  const excerpt = buildBalancedStudyExcerpt(
    [
      { fileName: 'bio_ch1.pdf', title: 'Cell Respiration', content: longTextA },
      { fileName: 'bio_ch2.docx', title: 'Photosynthesis', content: longTextB },
      { fileName: 'bio_ch3.md', title: 'Protein Synthesis', content: longTextC },
    ],
    1800
  );

  assert.ok(excerpt.length <= 1800);
  assert.ok(excerpt.includes('[bio_ch1.pdf]'));
  assert.ok(excerpt.includes('[bio_ch2.docx]'));
  assert.ok(excerpt.includes('[bio_ch3.md]'));
});

test('formatFileSize formats bytes, KB, MB, and GB cleanly', () => {
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(24 * 1024 * 1024), '24.0 MB');
  assert.equal(formatFileSize(1.5 * 1024 * 1024 * 1024), '1.50 GB');
});

test('parseCsvToStudyPairs skips headers and extracts quoted CSV columns', () => {
  const csv = `Question,Answer
"What does Kusa mean?",Grass
"What does Yotsuba mean?",Four leaves`;
  const pairs = parseCsvToStudyPairs(csv);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], { prompt: 'What does Kusa mean?', answer: 'Grass' });
});

test('buildStudyItemsFromDocumentText generates flashcards and quizzes from document notes', () => {
  const notes = `
# Neurobiology Notes
Hippocampus: Brain region that consolidates short-term facts into long-term memory.
Myelin Sheath: Fatty insulating layer that speeds up action potential conduction.
Synaptic Plasticity: Ability of neural connections to strengthen with repeated recall.
Dopamine: Neuromodulator linked to motivation and reward prediction.
`;

  const flashcards = buildStudyItemsFromDocumentText(notes, 'flashcards', 4, 'Neurobiology');
  assert.equal(flashcards.length, 4);
  assert.ok(flashcards[0].prompt.includes('Hippocampus'));
  assert.ok(flashcards[0].answer.includes('consolidates'));

  const quiz = buildStudyItemsFromDocumentText(notes, 'quiz', 4, 'Neurobiology');
  assert.equal(quiz.length, 4);
  assert.equal(quiz[0].answer, 'Hippocampus');
  assert.equal(quiz[0].distractors.length, 3);
});
