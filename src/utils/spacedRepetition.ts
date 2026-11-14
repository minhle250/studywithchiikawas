import type { ForecastDay, QuizCard, QuizDeck, ReviewRating } from '../types/quiz';
import { areMathExpressionsEquivalent } from './mathExerciseEngine';

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.2;
const DAY_MS = 24 * 60 * 60 * 1000;

export function clampEaseFactor(ef: number): number {
  return Math.round(Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, ef)) * 100) / 100;
}

export function createNewCard(
  partial: Omit<
    QuizCard,
    'easeFactor' | 'interval' | 'repetitions' | 'lapses' | 'dueDate' | 'lastReviewedAt' | 'state'
  >,
  now: Date = new Date()
): QuizCard {
  return {
    ...partial,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    lapses: 0,
    dueDate: now.toISOString(),
    lastReviewedAt: null,
    state: 'new',
  };
}

export function isCardDue(card: QuizCard, now: Date = new Date()): boolean {
  if (card.state === 'new' || card.state === 'learning') {
    return new Date(card.dueDate).getTime() <= now.getTime();
  }
  return new Date(card.dueDate).getTime() <= now.getTime();
}

export function scheduleCardReview(
  card: QuizCard,
  rating: ReviewRating,
  now: Date = new Date()
): QuizCard {
  let nextInterval = card.interval;
  let nextReps = card.repetitions;
  let nextLapses = card.lapses;
  let nextEf = card.easeFactor;

  if (rating === 1) {
    // Lapse / Forgotten: reset repetitions, immediate re-queue in session
    nextReps = 0;
    nextInterval = 0;
    nextLapses = card.lapses + 1;
    nextEf = clampEaseFactor(card.easeFactor - 0.2);

    return {
      ...card,
      easeFactor: nextEf,
      interval: nextInterval,
      repetitions: nextReps,
      lapses: nextLapses,
      dueDate: now.toISOString(),
      lastReviewedAt: now.toISOString(),
      state: 'learning',
    };
  }

  // Successful recall (Hard=2, Good=3, Easy=4)
  if (card.repetitions === 0) {
    if (rating === 2) nextInterval = 1;
    else if (rating === 3) nextInterval = 1;
    else nextInterval = 4;
  } else if (card.repetitions === 1) {
    if (rating === 2) nextInterval = 3;
    else if (rating === 3) nextInterval = 6;
    else nextInterval = 8;
  } else {
    if (rating === 2) {
      nextInterval = Math.max(card.interval + 1, Math.round(card.interval * 1.2));
    } else if (rating === 3) {
      nextInterval = Math.max(card.interval + 1, Math.round(card.interval * card.easeFactor));
    } else {
      nextInterval = Math.max(
        card.interval + 2,
        Math.round(card.interval * card.easeFactor * 1.3)
      );
    }
  }

  if (rating === 2) {
    nextEf = clampEaseFactor(card.easeFactor - 0.15);
  } else if (rating === 4) {
    nextEf = clampEaseFactor(card.easeFactor + 0.15);
  } else {
    nextEf = clampEaseFactor(card.easeFactor);
  }

  nextReps = card.repetitions + 1;
  const dueTime = new Date(now.getTime() + nextInterval * DAY_MS);
  const nextState = nextInterval >= 21 && nextReps >= 3 ? 'mastered' : 'review';

  return {
    ...card,
    easeFactor: nextEf,
    interval: nextInterval,
    repetitions: nextReps,
    lapses: nextLapses,
    dueDate: dueTime.toISOString(),
    lastReviewedAt: now.toISOString(),
    state: nextState,
  };
}

export function formatInterval(days: number, rating?: ReviewRating): string {
  if (rating === 1 || days === 0) return '< 5 min';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round((days / 30) * 10) / 10;
  return months === 1 ? '1 month' : `${months} months`;
}

export function previewIntervals(
  card: QuizCard,
  now: Date = new Date()
): Record<ReviewRating, string> {
  return {
    1: formatInterval(scheduleCardReview(card, 1, now).interval, 1),
    2: formatInterval(scheduleCardReview(card, 2, now).interval, 2),
    3: formatInterval(scheduleCardReview(card, 3, now).interval, 3),
    4: formatInterval(scheduleCardReview(card, 4, now).interval, 4),
  };
}

/**
 * Estimates current memory retention probability [0..1] using Ebbinghaus exponential decay:
 * R(t) = exp(-t / S) where S is scaled so R(interval) ~= 0.90.
 */
export function calculateRetentionProbability(
  card: QuizCard,
  now: Date = new Date()
): number {
  if (card.state === 'new' || !card.lastReviewedAt) {
    return 0;
  }
  const elapsedMs = Math.max(0, now.getTime() - new Date(card.lastReviewedAt).getTime());
  const elapsedDays = elapsedMs / DAY_MS;

  if (card.interval <= 0) {
    // Short-term learning stability (~1.2 days decay)
    return Math.round(Math.exp(-elapsedDays / 1.2) * 100) / 100;
  }

  // At t == interval, R = 0.90 -> -ln(0.9) ≈ 0.10536
  const stability = (card.interval / 0.10536) * (card.easeFactor / 2.5);
  const retention = Math.exp(-elapsedDays / Math.max(0.5, stability));
  return Math.round(Math.min(1, Math.max(0.05, retention)) * 100) / 100;
}

export function calculateDeckRetention(deck: QuizDeck, now: Date = new Date()): number {
  const studiedCards = deck.cards.filter((c) => c.lastReviewedAt !== null);
  if (studiedCards.length === 0) return 0;
  const total = studiedCards.reduce(
    (sum, card) => sum + calculateRetentionProbability(card, now),
    0
  );
  return Math.round((total / studiedCards.length) * 100);
}

export function buildDueQueue(decks: QuizDeck[], now: Date = new Date()): Array<{
  deckId: string;
  deckTitle: string;
  card: QuizCard;
}> {
  const queue: Array<{ deckId: string; deckTitle: string; card: QuizCard }> = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      if (isCardDue(card, now)) {
        queue.push({ deckId: deck.id, deckTitle: deck.title, card });
      }
    }
  }

  // Prioritize learning/lapsed cards, then overdue review cards, then new cards
  return queue.sort((a, b) => {
    const priority = (c: QuizCard) => {
      if (c.state === 'learning') return 0;
      if (c.state === 'review' || c.state === 'mastered') return 1;
      return 2;
    };
    const pDiff = priority(a.card) - priority(b.card);
    if (pDiff !== 0) return pDiff;
    return new Date(a.card.dueDate).getTime() - new Date(b.card.dueDate).getTime();
  });
}

export function buildReviewForecast(
  decks: QuizDeck[],
  days: number = 7,
  now: Date = new Date()
): ForecastDay[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const buckets: ForecastDay[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let i = 0; i < days; i++) {
    const target = new Date(startOfToday.getTime() + i * DAY_MS);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : dayNames[target.getDay()];
    buckets.push({ dayOffset: i, label, dueCount: 0 });
  }

  for (const deck of decks) {
    for (const card of deck.cards) {
      const dueTime = new Date(card.dueDate).getTime();
      const diffDays = Math.floor((dueTime - startOfToday.getTime()) / DAY_MS);
      if (diffDays <= 0) {
        buckets[0].dueCount += 1;
      } else if (diffDays < days) {
        buckets[diffDays].dueCount += 1;
      }
    }
  }

  return buckets;
}

export function normalizeAnswerText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

export function evaluateTypedAnswer(
  userInput: string,
  card: QuizCard
): { isCorrect: boolean; matchType: 'exact' | 'close' | 'miss' } {
  const rawTrimmed = userInput.trim();
  if (!rawTrimmed) {
    return { isCorrect: false, matchType: 'miss' };
  }

  // Check numeric / fraction / algebraic equivalence before punctuation stripping
  const rawCandidates = [card.answer, ...(card.acceptableAnswers ?? [])];
  for (const target of rawCandidates) {
    if (areMathExpressionsEquivalent(rawTrimmed, target)) {
      return { isCorrect: true, matchType: 'exact' };
    }
  }

  const normalizedInput = normalizeAnswerText(userInput);
  if (!normalizedInput) {
    return { isCorrect: false, matchType: 'miss' };
  }

  const candidates = rawCandidates.map(normalizeAnswerText);
  if (candidates.includes(normalizedInput)) {
    return { isCorrect: true, matchType: 'exact' };
  }

  // Allow substring inclusion when input is meaningful (>= 4 chars) and matches core term
  for (const target of candidates) {
    if (
      normalizedInput.length >= 4 &&
      (target.includes(normalizedInput) || normalizedInput.includes(target))
    ) {
      return { isCorrect: true, matchType: 'close' };
    }
    if (levenshteinDistance(normalizedInput, target) <= (target.length >= 8 ? 2 : 1)) {
      return { isCorrect: true, matchType: 'close' };
    }
  }

  return { isCorrect: false, matchType: 'miss' };
}

/**
 * Bayesian Knowledge Tracing (BKT) latent skill mastery estimator P(L).
 * Uses standard Corbett & Anderson update parameters (P(L0)=0.2, P(T)=0.25, P(G)=0.2, P(S)=0.1)
 * to guide Worked Example Scaffolding vs Active Calculation Practice vs Spaced Maintenance.
 */
export function estimateSkillMasteryBKT(outcomes: boolean[]): number {
  let pL = 0.2;
  const pT = 0.25;
  const pG = 0.2;
  const pS = 0.1;

  for (const correct of outcomes) {
    let pLGivenObs: number;
    if (correct) {
      const num = pL * (1 - pS);
      const den = num + (1 - pL) * pG;
      pLGivenObs = den > 0 ? num / den : pL;
    } else {
      const num = pL * pS;
      const den = num + (1 - pL) * (1 - pG);
      pLGivenObs = den > 0 ? num / den : pL;
    }
    pL = pLGivenObs + (1 - pLGivenObs) * pT;
  }

  return Math.round(Math.min(0.99, Math.max(0.01, pL)) * 100) / 100;
}

export function getScaffoldingRecommendation(
  masteryProb: number
): 'worked-example' | 'active-practice' | 'spaced-maintenance' {
  if (masteryProb < 0.5) return 'worked-example';
  if (masteryProb < 0.9) return 'active-practice';
  return 'spaced-maintenance';
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

export function shuffleMultipleChoiceOptions(card: QuizCard): string[] {
  const all = [card.answer, ...card.distractors.slice(0, 3)];
  // Deterministic-friendly Fisher-Yates shuffle
  const copy = [...all];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
