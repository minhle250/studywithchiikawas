import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDueQueue,
  buildReviewForecast,
  calculateRetentionProbability,
  createNewCard,
  estimateSkillMasteryBKT,
  evaluateTypedAnswer,
  formatInterval,
  getScaffoldingRecommendation,
  previewIntervals,
  scheduleCardReview,
} from './spacedRepetition';

const BASE_TIME = new Date('2026-11-14T10:00:00.000Z');

function makeSampleCard() {
  return createNewCard(
    {
      id: 'card-1',
      prompt: 'What brain structure consolidates short-term memories into long-term cortex storage?',
      answer: 'Hippocampus',
      distractors: ['Cerebellum', 'Amygdala', 'Medulla'],
      acceptableAnswers: ['the hippocampus'],
      explanation: 'The hippocampus binds new declarative memories during sleep and spaced review.',
      conceptTag: 'Memory Systems',
    },
    BASE_TIME
  );
}

test('SM-2 progresses Good ratings across 1d -> 6d -> ~15d -> mastered', () => {
  const c0 = makeSampleCard();
  const c1 = scheduleCardReview(c0, 3, BASE_TIME); // Good
  assert.equal(c1.interval, 1);
  assert.equal(c1.repetitions, 1);
  assert.equal(c1.state, 'review');

  const day1 = new Date(BASE_TIME.getTime() + 1 * 86400_000);
  const c2 = scheduleCardReview(c1, 3, day1); // Good again
  assert.equal(c2.interval, 6);
  assert.equal(c2.repetitions, 2);

  const day7 = new Date(day1.getTime() + 6 * 86400_000);
  const c3 = scheduleCardReview(c2, 3, day7); // Good 3rd time -> 6 * 2.5 = 15
  assert.equal(c3.interval, 15);
  assert.equal(c3.repetitions, 3);
  assert.equal(c3.state, 'review');

  const day22 = new Date(day7.getTime() + 15 * 86400_000);
  const c4 = scheduleCardReview(c3, 3, day22); // Good 4th time -> 15 * 2.5 = 38 -> mastered
  assert.equal(c4.interval, 38);
  assert.equal(c4.state, 'mastered');
});

test('SM-2 Easy rating accelerates intervals and raises easeFactor', () => {
  const c0 = makeSampleCard();
  const c1 = scheduleCardReview(c0, 4, BASE_TIME);
  assert.equal(c1.interval, 4);
  assert.equal(c1.easeFactor, 2.65);
});

test('SM-2 Again rating resets repetitions, increments lapses, and clamps easeFactor at 1.3', () => {
  let card = makeSampleCard();
  card = scheduleCardReview(card, 3, BASE_TIME);
  card = scheduleCardReview(card, 3, BASE_TIME);
  assert.equal(card.repetitions, 2);

  for (let i = 0; i < 10; i++) {
    card = scheduleCardReview(card, 1, BASE_TIME);
  }
  assert.equal(card.repetitions, 0);
  assert.equal(card.interval, 0);
  assert.equal(card.lapses, 10);
  assert.equal(card.easeFactor, 1.3);
  assert.equal(card.state, 'learning');
});

test('previewIntervals accurately displays labels for all 4 ratings', () => {
  const c0 = makeSampleCard();
  const labels = previewIntervals(c0, BASE_TIME);
  assert.equal(labels[1], '< 5 min');
  assert.equal(labels[2], '1 day');
  assert.equal(labels[3], '1 day');
  assert.equal(labels[4], '4 days');
  assert.equal(formatInterval(45), '1.5 months');
});

test('calculateRetentionProbability starts at 0 for unstudied cards and decays over elapsed days', () => {
  const c0 = makeSampleCard();
  assert.equal(calculateRetentionProbability(c0, BASE_TIME), 0);

  const c1 = scheduleCardReview(c0, 3, BASE_TIME); // interval = 1d
  const rightAfter = calculateRetentionProbability(c1, BASE_TIME);
  assert.equal(rightAfter, 1);

  const oneDayLater = new Date(BASE_TIME.getTime() + 1 * 86400_000);
  const atDueDate = calculateRetentionProbability(c1, oneDayLater);
  assert.ok(atDueDate >= 0.88 && atDueDate <= 0.92, `expected ~0.90, got ${atDueDate}`);

  const fiveDaysLater = new Date(BASE_TIME.getTime() + 5 * 86400_000);
  const overdue = calculateRetentionProbability(c1, fiveDaysLater);
  assert.ok(overdue < atDueDate, 'overdue retention should be lower than due-date retention');
});

test('buildReviewForecast buckets due cards across next 7 days', () => {
  const dueNow = makeSampleCard();
  const reviewed = scheduleCardReview(
    { ...makeSampleCard(), id: 'card-2' },
    4,
    BASE_TIME
  ); // due in 4 days

  const forecast = buildReviewForecast(
    [
      {
        id: 'deck-1',
        title: 'Test Deck',
        description: 'Desc',
        subject: 'Neuroscience',
        createdAt: BASE_TIME.toISOString(),
        cards: [dueNow, reviewed],
      },
    ],
    7,
    BASE_TIME
  );

  assert.equal(forecast.length, 7);
  assert.equal(forecast[0].dueCount, 1);
  assert.equal(forecast[4].dueCount, 1);
});

test('buildDueQueue prioritizes learning cards over review and new cards', () => {
  const newCard = makeSampleCard();
  const learningCard = scheduleCardReview({ ...makeSampleCard(), id: 'c-learn' }, 1, BASE_TIME);
  const futureCard = scheduleCardReview({ ...makeSampleCard(), id: 'c-future' }, 3, BASE_TIME);

  const queue = buildDueQueue(
    [
      {
        id: 'deck-1',
        title: 'Deck',
        description: '',
        subject: 'Bio',
        createdAt: BASE_TIME.toISOString(),
        cards: [newCard, futureCard, learningCard],
      },
    ],
    BASE_TIME
  );

  assert.equal(queue.length, 2);
  assert.equal(queue[0].card.id, 'c-learn');
  assert.equal(queue[1].card.id, 'card-1');
});

test('evaluateTypedAnswer handles exact, fuzzy typo, math equivalence, and miss cases', () => {
  const card = makeSampleCard();
  assert.deepEqual(evaluateTypedAnswer('hippocampus', card), {
    isCorrect: true,
    matchType: 'exact',
  });
  assert.deepEqual(evaluateTypedAnswer('hipocampus', card), {
    isCorrect: true,
    matchType: 'close',
  });
  assert.deepEqual(evaluateTypedAnswer('cerebellum', card), {
    isCorrect: false,
    matchType: 'miss',
  });
  assert.deepEqual(evaluateTypedAnswer('   ', card), {
    isCorrect: false,
    matchType: 'miss',
  });

  const mathCard = createNewCard(
    {
      id: 'math-1',
      prompt: 'Evaluate 3/4 as a decimal or fraction',
      answer: '3/4',
      distractors: ['1/2', '2/3', '4/5'],
      acceptableAnswers: ['0.75'],
      explanation: '3 divided by 4 equals 0.75.',
      conceptTag: 'Fractions',
    },
    BASE_TIME
  );
  assert.deepEqual(evaluateTypedAnswer('0.75', mathCard), {
    isCorrect: true,
    matchType: 'exact',
  });
  assert.deepEqual(evaluateTypedAnswer('75%', mathCard), {
    isCorrect: true,
    matchType: 'exact',
  });
});

test('estimateSkillMasteryBKT updates mastery and maps scaffolding policy', () => {
  const initial = estimateSkillMasteryBKT([]);
  assert.equal(getScaffoldingRecommendation(initial), 'worked-example');

  const mid = estimateSkillMasteryBKT([true]);
  assert.ok(mid >= 0.5 && mid < 0.9, `expected intermediate mastery, got ${mid}`);
  assert.equal(getScaffoldingRecommendation(mid), 'active-practice');

  const recovered = estimateSkillMasteryBKT([false, true]);
  assert.ok(recovered >= 0.5 && recovered < 0.9, `expected recovered intermediate mastery, got ${recovered}`);
  assert.equal(getScaffoldingRecommendation(recovered), 'active-practice');

  const high = estimateSkillMasteryBKT([true, true, true, true, true]);
  assert.ok(high >= 0.9, `expected high mastery, got ${high}`);
  assert.equal(getScaffoldingRecommendation(high), 'spaced-maintenance');
});
