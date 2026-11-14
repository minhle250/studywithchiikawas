import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBalancedStudyExcerpt,
  buildStudyItemsFromDocumentText,
  cleanExtractedText,
  countWords,
  detectDocumentLanguage,
  detectDocumentSections,
  extractTextFromPptxXmlSlides,
  formatFileSize,
  parseCsvToStudyPairs,
} from './documentParser';

test('cleanExtractedText normalizes line endings and trims whitespace', () => {
  const cleaned = cleanExtractedText('Hello\r\n\r\n\r\nWorld   \n');
  assert.equal(cleaned, 'Hello\n\nWorld');
  assert.equal(countWords(cleaned), 2);
});

test('detectDocumentLanguage identifies Vietnamese, Japanese, and English accurately', () => {
  assert.equal(
    detectDocumentLanguage(
      'Chủ nghĩa duy vật biện chứng là hạt nhân lý luận của thế giới quan khoa học.'
    ),
    'Vietnamese'
  );
  assert.equal(
    detectDocumentLanguage('光合成は植物が太陽エネルギーを用いて糖を合成する反応です。'),
    'Japanese'
  );
  assert.equal(
    detectDocumentLanguage('Cognitive retrieval practice improves long-term retention.'),
    'English'
  );
});

test('detectDocumentSections splits markdown and Vietnamese chapter headings cleanly', () => {
  const doc = `# Tổng quan Triết học
Triết học nghiên cứu những quy luật chung nhất của tự nhiên, xã hội và tư duy.

Chương 1: Chủ nghĩa duy vật biện chứng
Vật chất có trước, ý thức có sau và phản ánh thế giới khách quan.`;

  const sections = detectDocumentSections(doc);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, 'Tổng quan Triết học');
  assert.equal(sections[1].title, 'Chương 1: Chủ nghĩa duy vật biện chứng');
  assert.ok(sections[0].wordCount >= 10);
});

test('detectDocumentSections consolidates high-volume documents with 40+ headings', () => {
  const hugeDoc = Array.from({ length: 42 }, (_, i) => {
    return `# Chapter ${i + 1}\nKey concept ${i + 1}: important mechanism studied in week ${i + 1}.`;
  }).join('\n\n');

  const sections = detectDocumentSections(hugeDoc);
  assert.ok(sections.length <= 24);
  assert.ok(sections.length >= 10);
  const totalWords = sections.reduce((sum, s) => sum + s.wordCount, 0);
  assert.ok(totalWords > 300);
});

test('buildBalancedStudyExcerpt performs stratified beginning + middle + end sampling across long chapters', () => {
  const startMarker = 'OPENING_INTRO_MARKER ';
  const middleMarker = 'MIDCHAPTER_CORE_THEORY ';
  const endMarker = 'CLOSING_SUMMARY_MARKER ';
  const padding = 'explanatory paragraph text covering conceptual mechanisms in detail. ';

  const longChapter =
    startMarker +
    padding.repeat(80) +
    middleMarker +
    padding.repeat(80) +
    endMarker;

  const excerpt = buildBalancedStudyExcerpt(
    [
      { fileName: 'textbook_ch1.pdf', title: 'Chapter 1', content: longChapter },
      { fileName: 'textbook_ch2.pdf', title: 'Chapter 2', content: longChapter },
    ],
    2200
  );

  assert.ok(excerpt.length <= 2200);
  assert.ok(excerpt.includes('[textbook_ch1.pdf]'));
  assert.ok(excerpt.includes('[textbook_ch2.pdf]'));
  assert.ok(excerpt.includes('OPENING_INTRO_MARKER'));
  assert.ok(excerpt.includes('MIDCHAPTER_CORE_THEORY'));
  assert.ok(excerpt.includes('CLOSING_SUMMARY_MARKER'));
});

test('extractTextFromPptxXmlSlides sorts slide files numerically and decodes Unicode XML runs', () => {
  const slides = [
    {
      name: 'ppt/slides/slide10.xml',
      xml: '<p:sld><a:p><a:r><a:t>Kết luận chương &amp; Ứng dụng</a:t></a:r></a:p><a:p><a:r><a:t>Tổng kết bài học.</a:t></a:r></a:p></p:sld>',
    },
    {
      name: 'ppt/slides/slide2.xml',
      xml: '<p:sld><a:p><a:r><a:t>Nội dung chính</a:t></a:r></a:p><a:p><a:r><a:t>Phân tích nhân quả.</a:t></a:r></a:p></p:sld>',
    },
  ];

  const out = extractTextFromPptxXmlSlides(slides);
  assert.equal(out.slideCount, 2);
  const slide2Idx = out.text.indexOf('# Slide 2: Nội dung chính');
  const slide10Idx = out.text.indexOf('# Slide 10: Kết luận chương & Ứng dụng');
  assert.ok(slide2Idx >= 0);
  assert.ok(slide10Idx > slide2Idx);
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

test('buildStudyItemsFromDocumentText supports Vietnamese humanities documents without English filler', () => {
  const viNotes = `
# Triết học Mác - Lênin
Chủ nghĩa duy vật biện chứng: Học thuyết xem vật chất là nguồn gốc và tính thứ nhất của hiện thực khách quan.
Phép biện chứng duy vật là khoa học về mối liên hệ phổ biến và sự phát triển của sự vật.
Thực tiễn: Toàn bộ hoạt động vật chất có mục đích, mang tính lịch sử - xã hội của con người nhằm cải tạo tự nhiên và xã hội.
Quy luật lượng - chất: Sự tích lũy dần về lượng vượt quá điểm nút sẽ dẫn đến bước nhảy vọt về chất.
`;

  const quiz = buildStudyItemsFromDocumentText(viNotes, 'quiz', 4, 'Triết học');
  assert.equal(quiz.length, 4);
  assert.ok(quiz.some((c) => c.prompt.includes('Khái niệm nào') || c.prompt.includes('Hoàn thành')));
  assert.ok(
    quiz.every((c) => !c.distractors.includes('Passive sensory adaptation')),
    'Should not emit English filler distractors for Vietnamese content'
  );

  const flashcards = buildStudyItemsFromDocumentText(viNotes, 'flashcards', 3, 'Triết học');
  assert.equal(flashcards.length, 3);
  assert.ok(flashcards[0].prompt.includes('Trình bày'));
});
