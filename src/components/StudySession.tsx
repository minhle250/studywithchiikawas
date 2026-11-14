import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  HelpCircle,
  Music,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AudioSettings,
  MascotId,
  MascotMood,
  QuizCard,
  QuizDeck,
  QuizMode,
  ReviewRating,
} from '../types/quiz';
import {
  evaluateTypedAnswer,
  previewIntervals,
  shuffleMultipleChoiceOptions,
} from '../utils/spacedRepetition';
import { soundEngine } from '../utils/soundEngine';
import { MascotStage } from './MascotStage';

export interface QueueItem {
  deckId: string;
  deckTitle: string;
  card: QuizCard;
}

interface StudySessionProps {
  initialQueue: QueueItem[];
  initialMode?: QuizMode;
  mascotId: MascotId;
  audioSettings: AudioSettings;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onCardReviewed: (deckId: string, updatedCard: QuizCard, rating: ReviewRating) => void;
  onExit: () => void;
  onScheduleCard: (card: QuizCard, rating: ReviewRating) => QuizCard;
}

type ChallengeFormat = 'multiple-choice' | 'type-answer' | 'flashcard';

export const StudySession: React.FC<StudySessionProps> = ({
  initialQueue,
  initialMode = 'mixed',
  mascotId,
  audioSettings,
  onToggleMusic,
  onToggleSfx,
  onCardReviewed,
  onExit,
  onScheduleCard,
}) => {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [quizMode, setQuizMode] = useState<QuizMode>(initialMode);
  const [showHint, setShowHint] = useState(false);
  const [revealedStepCount, setRevealedStepCount] = useState(0);

  // Per-card interaction state
  const [revealed, setRevealed] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [typedInput, setTypedInput] = useState('');
  const [typedOutcome, setTypedOutcome] = useState<'exact' | 'close' | 'miss' | null>(null);
  const [isCorrectAnswer, setIsCorrectAnswer] = useState<boolean | null>(null);

  // Session telemetry & companion mood
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mood, setMood] = useState<MascotMood>('thinking');
  const [mascotMessage, setMascotMessage] = useState(
    'Take a quiet breath in the grass. You have got this!'
  );
  const [sessionFinished, setSessionFinished] = useState(initialQueue.length === 0);

  const currentItem = queue[currentIndex];

  const activeFormat: ChallengeFormat = useMemo(() => {
    if (!currentItem) return 'flashcard';
    if (quizMode === 'multiple-choice') return 'multiple-choice';
    if (quizMode === 'type-answer') return 'type-answer';
    if (quizMode === 'flashcard') return 'flashcard';
    if (currentItem.card.exerciseType === 'calculation') {
      return currentIndex % 2 === 0 ? 'type-answer' : 'multiple-choice';
    }
    // Mixed interactive: rotate across active recall formats for interleaving!
    const formats: ChallengeFormat[] = ['multiple-choice', 'type-answer', 'flashcard'];
    return formats[currentIndex % formats.length];
  }, [quizMode, currentIndex, currentItem]);

  const options = useMemo(() => {
    if (!currentItem) return [];
    return shuffleMultipleChoiceOptions(currentItem.card);
  }, [currentItem?.card.id, currentIndex]);

  const intervalLabels = useMemo(() => {
    if (!currentItem) return { 1: '', 2: '', 3: '', 4: '' };
    return previewIntervals(currentItem.card);
  }, [currentItem]);

  useEffect(() => {
    setShowHint(false);
    setRevealedStepCount(0);
    setRevealed(false);
    setSelectedOption(null);
    setTypedInput('');
    setTypedOutcome(null);
    setIsCorrectAnswer(null);
    if (!sessionFinished && currentItem) {
      setMood('thinking');
      setMascotMessage(
        activeFormat === 'multiple-choice'
          ? 'Pick the clover answer you recall best.'
          : activeFormat === 'type-answer'
          ? 'Try typing the answer from memory!'
          : 'Recall the answer in your head, then flip.'
      );
    }
  }, [currentIndex, sessionFinished]);

  const triggerCorrectCelebration = (nextStreak: number, isEasyHint = false) => {
    if (nextStreak >= 10 && nextStreak % 5 === 0) {
      setMood('celebrate_streak');
      setMascotMessage(`Unstoppable ${nextStreak}-card streak! Meadow fireworks!`);
      soundEngine.playMilestone('streak_10');
    } else if (nextStreak === 5) {
      setMood('celebrate_streak');
      setMascotMessage('5 in a row! Everyone is cheering in the clover field!');
      soundEngine.playMilestone('streak_5');
    } else if (nextStreak === 3) {
      setMood('celebrate_streak');
      setMascotMessage('3-card streak! The whole meadow squad hopped up to cheer!');
      soundEngine.playMilestone('streak_3');
    } else if (isEasyHint) {
      setMood('celebrate_easy');
      setMascotMessage('Spot-on! Memory trace locked in brightly.');
      soundEngine.playMilestone('correct_easy');
    } else {
      setMood('celebrate_good');
      setMascotMessage('Nice recall! Your neural pathway just grew stronger.');
      soundEngine.playMilestone('correct_good');
    }
  };

  const handleSelectOption = (option: string) => {
    if (revealed || !currentItem) return;
    const correct = option === currentItem.card.answer;
    setSelectedOption(option);
    setRevealed(true);
    setIsCorrectAnswer(correct);

    if (correct) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((prev) => Math.max(prev, nextStreak));
      setCorrectCount((c) => c + 1);
      triggerCorrectCelebration(nextStreak, false);
    } else {
      setStreak(0);
      setMood('encourage');
      setMascotMessage('Close! Missing a card now makes the next recall stronger.');
      soundEngine.playMilestone('encourage_again');
    }
  };

  const handleTypedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (revealed || !currentItem || !typedInput.trim()) return;

    const result = evaluateTypedAnswer(typedInput, currentItem.card);
    setTypedOutcome(result.matchType);
    setRevealed(true);
    setIsCorrectAnswer(result.isCorrect);

    if (result.isCorrect) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((prev) => Math.max(prev, nextStreak));
      setCorrectCount((c) => c + 1);
      triggerCorrectCelebration(nextStreak, result.matchType === 'exact');
    } else {
      setStreak(0);
      setMood('encourage');
      setMascotMessage('Good effort! Review the explanation and try again shortly.');
      soundEngine.playMilestone('encourage_again');
    }
  };

  const handleRevealFlashcard = () => {
    if (revealed) return;
    setRevealed(true);
    soundEngine.playMilestone('card_flip');
    setMood('idle');
    setMascotMessage('How clearly did you remember it? Rate your recall below.');
  };

  const handleRateCard = (rating: ReviewRating) => {
    if (!currentItem) return;

    const updatedCard = onScheduleCard(currentItem.card, rating);
    onCardReviewed(currentItem.deckId, updatedCard, rating);

    // For flashcard mode (where correctness wasn't evaluated before reveal), update streak/celebration here
    if (activeFormat === 'flashcard') {
      if (rating >= 3) {
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        setBestStreak((prev) => Math.max(prev, nextStreak));
        setCorrectCount((c) => c + 1);
        triggerCorrectCelebration(nextStreak, rating === 4);
      } else if (rating === 2) {
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        setBestStreak((prev) => Math.max(prev, nextStreak));
        setCorrectCount((c) => c + 1);
        setMood('celebrate_good');
        soundEngine.playMilestone('correct_good');
      } else {
        setStreak(0);
        setMood('encourage');
        soundEngine.playMilestone('encourage_again');
      }
    } else if (rating === 4 && isCorrectAnswer) {
      soundEngine.playMilestone('correct_easy');
    }

    setCompletedCount((c) => c + 1);

    // If rated Again (1), re-insert into queue 2 slots ahead for immediate spaced retrieval
    let nextQueue = queue;
    if (rating === 1) {
      const insertAt = Math.min(queue.length, currentIndex + 3);
      nextQueue = [
        ...queue.slice(0, insertAt),
        { ...currentItem, card: updatedCard },
        ...queue.slice(insertAt),
      ];
      setQueue(nextQueue);
    }

    const nextIdx = currentIndex + 1;
    if (nextIdx >= nextQueue.length) {
      setSessionFinished(true);
      setMood('celebrate_mastery');
      setMascotMessage('Session complete! Your meadow is blooming with memory roots.');
      soundEngine.playMilestone('deck_complete');
    } else {
      // Brief pause only in flashcard mode isn't needed since clicking Next/Rating advances cleanly
      setCurrentIndex(nextIdx);
    }
  };

  // Keyboard shortcuts for fast study flow
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (sessionFinished || !currentItem) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (!revealed && activeFormat === 'flashcard' && e.code === 'Space') {
        e.preventDefault();
        handleRevealFlashcard();
      } else if (!revealed && activeFormat === 'multiple-choice') {
        const idx = ['1', '2', '3', '4'].indexOf(e.key);
        if (idx !== -1 && options[idx]) {
          e.preventDefault();
          handleSelectOption(options[idx]);
        }
      } else if (revealed) {
        const ratingMap: Record<string, ReviewRating> = {
          '1': 1,
          '2': 2,
          '3': 3,
          '4': 4,
        };
        if (ratingMap[e.key]) {
          e.preventDefault();
          handleRateCard(ratingMap[e.key]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionFinished, currentItem, revealed, activeFormat, options]);

  if (sessionFinished) {
    const accuracy =
      completedCount > 0 ? Math.round((correctCount / completedCount) * 100) : 100;

    return (
      <section className="mx-auto max-w-4xl py-4">
        <div className="rounded-3xl border border-[#D8E3CE] bg-white/95 p-8 shadow-sm">
          <div className="grid items-center gap-8 md:grid-cols-2">
            <MascotStage
              mascotId="trio"
              mood="celebrate_mastery"
              message="Otsukaresama! Every card you recalled today has been scheduled right before you would forget it."
              streak={bestStreak}
            />

            <div>
              <p className="text-xs font-medium text-[#3F6E4A]">
                Session Milestone · Spaced Repetition Saved
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#1F2A1E] text-balance">
                Meadow Review Complete
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4E5E4B]">
                Your SM-2 memory intervals have been updated based on retrieval effort. Come
                back tomorrow for your next short harvest!
              </p>

              <dl className="mt-6 grid grid-cols-3 gap-4 border-y border-[#E6EEDF] py-4">
                <div>
                  <dt className="text-xs text-[#5E6E5B]">Reviews</dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-[#1F2A1E] tabular-nums">
                    {completedCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#5E6E5B]">Accuracy</dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-[#2F855A] tabular-nums">
                    {accuracy}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#5E6E5B]">Best Streak</dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-[#D97706] tabular-nums">
                    {bestStreak}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onExit}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#276749] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A] whitespace-nowrap shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Study Meadow
                </button>
                {initialQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setQueue(initialQueue);
                      setCurrentIndex(0);
                      setCompletedCount(0);
                      setCorrectCount(0);
                      setStreak(0);
                      setSessionFinished(false);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#D4DFC7] bg-[#F7FAF2] px-4 py-2.5 text-sm font-medium text-[#2C3A2B] transition-colors hover:bg-[#ECF3E2] whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Practice Again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!currentItem) return null;

  const progressPct = Math.round(((currentIndex + (revealed ? 1 : 0)) / queue.length) * 100);

  return (
    <section className="mx-auto max-w-6xl space-y-5">
      {/* Compact Session Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#D8E3CE] bg-white/90 px-5 py-3.5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-[#3D4C3B] transition-colors hover:bg-[#EFF5E7] whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            Meadow
          </button>
          <div className="h-4 w-px bg-[#DCE6D3]" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-[#1F2A1E]">
              {currentItem.deckTitle}
            </h2>
            <p className="text-xs text-[#5A6B57] tabular-nums">
              Card {currentIndex + 1} of {queue.length} · Streak {streak} · Best {bestStreak}
            </p>
          </div>
        </div>

        {/* Mode Segmented Switcher */}
        <div className="flex items-center gap-1 rounded-xl bg-[#F1F6EA] p-1" role="group" aria-label="Quiz interaction mode">
          {(
            [
              { id: 'mixed', label: 'Mixed' },
              { id: 'multiple-choice', label: 'Choices' },
              { id: 'type-answer', label: 'Type Recall' },
              { id: 'flashcard', label: 'Flashcard' },
            ] as Array<{ id: QuizMode; label: string }>
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setQuizMode(mode.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                quizMode === mode.id
                  ? 'bg-white text-[#1F2A1E] shadow-xs'
                  : 'text-[#556653] hover:text-[#1F2A1E]'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Thin Meadow Progress Track */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E3ECD8]">
        <div
          className="h-full rounded-full bg-[#38A169] transition-all duration-300"
          style={{ width: `${Math.max(4, progressPct)}%` }}
        />
      </div>

      {/* Main Two-Column Active Recall Stage */}
      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* Left: Interactive Quiz Card (8 cols) */}
        <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6 shadow-xs sm:p-8 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A6B57]">
            <span>
              {currentItem.card.conceptTag} · Ease{' '}
              <span className="font-mono tabular-nums">
                {currentItem.card.easeFactor.toFixed(2)}
              </span>{' '}
              · Interval{' '}
              <span className="font-mono tabular-nums">{currentItem.card.interval}d</span>
            </span>
            <div className="flex items-center gap-3">
              {currentItem.card.workedSteps &&
                currentItem.card.workedSteps.length > 1 &&
                !revealed && (
                  <button
                    type="button"
                    onClick={() =>
                      setRevealedStepCount((c) =>
                        Math.min(
                          Math.max(1, (currentItem.card.workedSteps?.length ?? 1) - 1),
                          c + 1
                        )
                      )
                    }
                    className="inline-flex items-center gap-1 font-medium text-[#9D3E63] hover:underline whitespace-nowrap shrink-0"
                  >
                    Step Scaffold (
                    {revealedStepCount}/
                    {Math.max(1, currentItem.card.workedSteps.length - 1)})
                  </button>
                )}
              {currentItem.card.hint && !revealed && (
                <button
                  type="button"
                  onClick={() => setShowHint((h) => !h)}
                  className="inline-flex items-center gap-1 font-medium text-[#2F855A] hover:underline whitespace-nowrap shrink-0"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  {showHint ? 'Hide Hint' : 'Show Hint'}
                </button>
              )}
            </div>
          </div>

          <h3 className="mt-4 font-display text-2xl font-semibold leading-snug text-[#1F2A1E] text-balance">
            {currentItem.card.prompt}
          </h3>

          {currentItem.card.formulaUsed && !revealed && revealedStepCount > 0 && (
            <p className="mt-2 font-mono text-xs text-[#3D4C3B]">
              {currentItem.card.exerciseType === 'calculation' ? 'Formula: ' : 'Rule / Principle: '}
              {currentItem.card.formulaUsed}
            </p>
          )}

          {revealedStepCount > 0 &&
            currentItem.card.workedSteps &&
            !revealed && (
              <ol className="mt-3 list-decimal space-y-1 rounded-xl border border-[#EAD5DE] bg-[#FFF9FB] py-2.5 pl-7 pr-4 text-xs text-[#3A2B32]">
                {currentItem.card.workedSteps
                  .slice(0, revealedStepCount)
                  .map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
              </ol>
            )}

          {showHint && currentItem.card.hint && !revealed && (
            <p className="mt-3 rounded-xl border border-[#E6EEDF] bg-[#F8FBF3] px-4 py-2.5 text-sm text-[#425540]">
              Hint: {currentItem.card.hint}
            </p>
          )}

          {/* Mode 1: Multiple Choice */}
          {activeFormat === 'multiple-choice' && (
            <div className="mt-6 grid gap-3">
              {options.map((option, idx) => {
                const isSelected = selectedOption === option;
                const isAnswer = option === currentItem.card.answer;

                let stateClasses =
                  'border-[#D8E3CE] bg-[#FAFDF7] text-[#1F2A1E] hover:border-[#7BB86F] hover:bg-[#F1F8EA]';
                if (revealed) {
                  if (isAnswer) {
                    stateClasses = 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]';
                  } else if (isSelected && !isAnswer) {
                    stateClasses = 'border-[#DC2626] bg-[#FEF2F2] text-[#991B1B]';
                  } else {
                    stateClasses = 'border-[#E6EEDF] bg-[#FAFDF7] text-[#7A8A77] opacity-70';
                  }
                }

                return (
                  <button
                    key={option}
                    type="button"
                    data-option-index={idx}
                    disabled={revealed}
                    onClick={() => handleSelectOption(option)}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3.5 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A] ${stateClasses}`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-current/20 font-mono text-xs tabular-nums">
                        {idx + 1}
                      </span>
                      <span>{option}</span>
                    </span>
                    {revealed && isAnswer && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F855A] shrink-0">
                        <CheckCircle2 className="h-4 w-4" />
                        Correct
                      </span>
                    )}
                    {revealed && isSelected && !isAnswer && (
                      <span className="text-xs font-semibold text-[#DC2626] shrink-0">
                        Your choice
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Mode 2: Typed Active Recall */}
          {activeFormat === 'type-answer' && (
            <form onSubmit={handleTypedSubmit} className="mt-6 space-y-3">
              <label
                htmlFor="typed-recall-input"
                className="block text-xs font-medium text-[#4E5E4B]"
              >
                Type the key concept or answer from memory
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="typed-recall-input"
                  type="text"
                  value={typedInput}
                  onChange={(e) => setTypedInput(e.target.value)}
                  disabled={revealed}
                  placeholder={
                    currentItem.card.exerciseType === 'calculation'
                      ? 'Enter value or equivalent fraction (e.g. 12, 3/4, 0.75)...'
                      : 'Enter your answer...'
                  }
                  className="flex-1 rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-4 py-3 text-sm text-[#1F2A1E] placeholder:text-[#8E9C8B] focus:border-[#2F855A] focus:outline-none"
                />
                {!revealed && (
                  <button
                    type="submit"
                    disabled={!typedInput.trim()}
                    className="rounded-xl bg-[#2F855A] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#276749] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    Check Answer
                  </button>
                )}
              </div>

              {revealed && (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    isCorrectAnswer
                      ? 'border-[#86EFAC] bg-[#ECF8F0] text-[#1D593A]'
                      : 'border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B]'
                  }`}
                >
                  <p className="font-semibold">
                    {typedOutcome === 'exact'
                      ? 'Exact recall match!'
                      : typedOutcome === 'close'
                      ? 'Close enough — core concept recalled!'
                      : 'Not quite — compare with the answer below:'}
                  </p>
                  <p className="mt-1">
                    Answer: <strong className="font-semibold">{currentItem.card.answer}</strong>
                  </p>
                </div>
              )}
            </form>
          )}

          {/* Mode 3: Classic Active Recall Flashcard */}
          {activeFormat === 'flashcard' && (
            <div className="mt-6">
              {!revealed ? (
                <div className="rounded-2xl border border-dashed border-[#C7D6B9] bg-[#F8FBF3] px-6 py-10 text-center">
                  <p className="text-sm text-[#4E5E4B]">
                    Say or picture the answer silently before revealing.
                  </p>
                  <button
                    type="button"
                    onClick={handleRevealFlashcard}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#276749] whitespace-nowrap shrink-0"
                  >
                    <Eye className="h-4 w-4" />
                    Reveal Answer (Space)
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#C6DEC0] bg-[#F3FAF0] px-5 py-4">
                  <p className="text-xs font-medium text-[#3B6B46]">Answer</p>
                  <p className="mt-1 font-display text-xl font-semibold text-[#183823]">
                    {currentItem.card.answer}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Explanation & SM-2 Interval Rating Controls */}
          {revealed && (
            <div className="mt-6 space-y-5 border-t border-[#E6EEDF] pt-5">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-[#4E5E4B]">Why this sticks</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#2A3729]">
                    {currentItem.card.explanation}
                  </p>
                </div>

                {(currentItem.card.formulaUsed ||
                  (currentItem.card.workedSteps && currentItem.card.workedSteps.length > 0)) && (
                  <div className="rounded-2xl border border-[#DCE8D3] bg-[#F7FBF3] p-4">
                    {currentItem.card.formulaUsed && (
                      <p className="font-mono text-xs font-semibold text-[#1D593A]">
                        {currentItem.card.exerciseType === 'calculation' ? 'Formula: ' : 'Rule / Principle: '}
                        {currentItem.card.formulaUsed}
                      </p>
                    )}
                    {currentItem.card.workedSteps && currentItem.card.workedSteps.length > 0 && (
                      <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-[#2A3729]">
                        {currentItem.card.workedSteps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-2.5 flex items-center justify-between text-xs text-[#5A6B57]">
                  <span className="font-medium text-[#2C3A2B]">
                    Schedule next spaced review (keys 1–4)
                  </span>
                  <span>SM-2 Interval Preview</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(
                    [
                      {
                        rating: 1 as ReviewRating,
                        label: 'Again',
                        sub: intervalLabels[1],
                        tone: 'border-[#F3C2C2] bg-[#FEF5F5] text-[#991B1B] hover:bg-[#FEE2E2]',
                        recommended: isCorrectAnswer === false,
                      },
                      {
                        rating: 2 as ReviewRating,
                        label: 'Hard',
                        sub: intervalLabels[2],
                        tone: 'border-[#F2D9B1] bg-[#FFFBEB] text-[#92400E] hover:bg-[#FEF3C7]',
                        recommended: false,
                      },
                      {
                        rating: 3 as ReviewRating,
                        label: 'Good',
                        sub: intervalLabels[3],
                        tone: 'border-[#B8DEC2] bg-[#EFFAF2] text-[#1D593A] hover:bg-[#DCFCE7]',
                        recommended: isCorrectAnswer === true,
                      },
                      {
                        rating: 4 as ReviewRating,
                        label: 'Easy',
                        sub: intervalLabels[4],
                        tone: 'border-[#BAE6FD] bg-[#F0F9FF] text-[#075985] hover:bg-[#E0F2FE]',
                        recommended: false,
                      },
                    ]
                  ).map((btn) => (
                    <button
                      key={btn.rating}
                      type="button"
                      onClick={() => handleRateCard(btn.rating)}
                      className={`flex flex-col items-center justify-center rounded-xl border px-3 py-2.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A] ${
                        btn.tone
                      } ${btn.recommended ? 'ring-2 ring-[#2F855A]/40' : ''}`}
                    >
                      <span className="text-sm font-semibold">{btn.label}</span>
                      <span className="mt-0.5 font-mono text-xs opacity-85 tabular-nums">
                        {btn.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Expressive Companion & Audio Controls (4 cols) */}
        <div className="space-y-4 lg:col-span-4">
          <MascotStage
            mascotId={mascotId}
            mood={mood}
            message={mascotMessage}
            streak={streak}
          />

          <div className="rounded-2xl border border-[#D8E3CE] bg-white/90 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#2C3A2B]">
                Meadow Audio
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMusic}
                  aria-pressed={audioSettings.musicEnabled}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    audioSettings.musicEnabled
                      ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                      : 'border-[#D8E3CE] bg-[#FAFDF7] text-[#4E5E4B] hover:bg-[#EFF5E7]'
                  }`}
                >
                  <Music className="h-3.5 w-3.5" />
                  {audioSettings.musicEnabled ? 'Music On' : 'Music Off'}
                </button>
                <button
                  type="button"
                  onClick={onToggleSfx}
                  aria-pressed={audioSettings.sfxEnabled}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    audioSettings.sfxEnabled
                      ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                      : 'border-[#D8E3CE] bg-[#FAFDF7] text-[#4E5E4B] hover:bg-[#EFF5E7]'
                  }`}
                >
                  {audioSettings.sfxEnabled ? (
                    <Volume2 className="h-3.5 w-3.5" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5" />
                  )}
                  {audioSettings.sfxEnabled ? 'SFX On' : 'SFX Off'}
                </button>
              </div>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-[#5A6B57]">
              <Sparkles className="h-3.5 w-3.5 text-[#D97706] shrink-0" />
              Streaks at 3, 5, and 10 unlock special trio celebrations and chimes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
