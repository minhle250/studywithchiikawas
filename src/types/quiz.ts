export type ReviewRating = 1 | 2 | 3 | 4; // 1=Again, 2=Hard, 3=Good, 4=Easy

export type CardState = 'new' | 'learning' | 'review' | 'mastered';

export type QuizMode = 'mixed' | 'multiple-choice' | 'type-answer' | 'flashcard';

export type MascotId = 'mochi' | 'pip' | 'bramble' | 'trio';

export type MascotMood =
  | 'idle'
  | 'thinking'
  | 'celebrate_good'
  | 'celebrate_easy'
  | 'celebrate_streak'
  | 'celebrate_mastery'
  | 'encourage';

export type SoundMilestone =
  | 'card_flip'
  | 'correct_good'
  | 'correct_easy'
  | 'streak_3'
  | 'streak_5'
  | 'streak_10'
  | 'deck_complete'
  | 'encourage_again'
  | 'quiz_generated';

export type ExerciseKind = 'conceptual' | 'calculation' | 'worked-example';

export interface ResearchSource {
  title: string;
  url: string;
}

export interface AgentTraceStep {
  agent: 'analyzer' | 'search' | 'builder';
  label: string;
  status: 'running' | 'done' | 'fallback';
  detail: string;
}

export interface QuizCard {
  id: string;
  prompt: string;
  answer: string;
  distractors: string[];
  acceptableAnswers?: string[];
  hint?: string;
  explanation: string;
  conceptTag: string;
  exerciseType?: ExerciseKind;
  formulaUsed?: string;
  workedSteps?: string[];
  easeFactor: number;
  interval: number; // in days
  repetitions: number;
  lapses: number;
  dueDate: string; // ISO string
  lastReviewedAt: string | null;
  state: CardState;
}

export interface QuizDeck {
  id: string;
  title: string;
  description: string;
  subject: string;
  createdAt: string;
  cards: QuizCard[];
  researchSources?: ResearchSource[];
}

export interface StudyLogEntry {
  id: string;
  deckId: string;
  cardId: string;
  rating: ReviewRating;
  timestamp: string;
  correct: boolean;
}

export interface ForecastDay {
  dayOffset: number;
  label: string;
  dueCount: number;
}

export interface AudioSettings {
  musicEnabled: boolean;
  sfxEnabled: boolean;
  volume: number; // 0 to 1
}

export interface GeneratedCardDraft {
  prompt: string;
  answer: string;
  distractors: string[];
  acceptableAnswers: string[];
  hint: string;
  explanation: string;
  conceptTag: string;
  exerciseType?: ExerciseKind;
  formulaUsed?: string;
  workedSteps?: string[];
}

export interface QuizIdeaSuggestion {
  title: string;
  subject: string;
  promptTopic: string;
  whyItWorks: string;
}
