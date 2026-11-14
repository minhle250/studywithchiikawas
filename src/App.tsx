import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  FileUp,
  Music,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AudioSettings,
  MascotId,
  QuizCard,
  QuizDeck,
  QuizMode,
  ReviewRating,
  StudyLogEntry,
} from './types/quiz';
import { buildSeedDecks } from './data/seedDecks';
import {
  buildDueQueue,
  calculateDeckRetention,
  isCardDue,
  scheduleCardReview,
} from './utils/spacedRepetition';
import { soundEngine } from './utils/soundEngine';
import { MeadowBackground } from './components/MeadowBackground';
import { MascotStage, MASCOT_PROFILES } from './components/MascotStage';
import { StudySession, type QueueItem } from './components/StudySession';
import { QuizGenerator, type GeneratorTab } from './components/QuizGenerator';
import { RetentionLab } from './components/RetentionLab';
import { SoundGarden } from './components/SoundGarden';

type AppView = 'meadow' | 'generator' | 'retention' | 'sound' | 'study';

const DECKS_STORAGE_KEY = 'kusaquiz_decks_v1';
const LOG_STORAGE_KEY = 'kusaquiz_log_v1';
const MASCOT_STORAGE_KEY = 'kusaquiz_mascot_v1';

const HERO_BANNER_SRC = '/src/assets/images/meadow_hero_banner_1794665425664.jpg';
const CLOVER_EMBLEM_SRC = '/src/assets/images/meadow_clover_emblem_1794665425739.jpg';

function loadInitialDecks(): QuizDeck[] {
  try {
    const raw = localStorage.getItem(DECKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to seed decks
  }
  return buildSeedDecks();
}

function loadInitialLog(): StudyLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function loadInitialMascot(): MascotId {
  try {
    const raw = localStorage.getItem(MASCOT_STORAGE_KEY);
    if (raw === 'mochi' || raw === 'pip' || raw === 'bramble' || raw === 'trio') {
      return raw;
    }
  } catch {
    // ignore
  }
  return 'mochi';
}

export default function App() {
  const [decks, setDecks] = useState<QuizDeck[]>(loadInitialDecks);
  const [studyLog, setStudyLog] = useState<StudyLogEntry[]>(loadInitialLog);
  const [mascotId, setMascotId] = useState<MascotId>(loadInitialMascot);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(() =>
    soundEngine.getSettings()
  );

  const [view, setView] = useState<AppView>('meadow');
  const [generatorTab, setGeneratorTab] = useState<GeneratorTab>('file');
  const [activeQueue, setActiveQueue] = useState<QueueItem[]>([]);
  const [sessionInitialMode, setSessionInitialMode] = useState<QuizMode>('mixed');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(DECKS_STORAGE_KEY, JSON.stringify(decks));
    } catch {
      // ignore storage quota errors
    }
  }, [decks]);

  useEffect(() => {
    try {
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(studyLog));
    } catch {
      // ignore
    }
  }, [studyLog]);

  useEffect(() => {
    try {
      localStorage.setItem(MASCOT_STORAGE_KEY, mascotId);
    } catch {
      // ignore
    }
  }, [mascotId]);

  const dueQueue = useMemo(() => buildDueQueue(decks), [decks]);

  // Support ?autostart=1 for instant study entry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      const queue =
        dueQueue.length > 0
          ? dueQueue
          : decks.flatMap((d) =>
              d.cards.map((card) => ({ deckId: d.id, deckTitle: d.title, card }))
            );
      if (queue.length > 0) {
        setActiveQueue(queue);
        setView('study');
      }
    }
  }, []);

  const totalCards = useMemo(
    () => decks.reduce((sum, d) => sum + d.cards.length, 0),
    [decks]
  );

  const masteredCards = useMemo(
    () =>
      decks.reduce(
        (sum, d) => sum + d.cards.filter((c) => c.state === 'mastered').length,
        0
      ),
    [decks]
  );

  const handleToggleMusic = () => {
    const next = soundEngine.updateSettings({
      musicEnabled: !audioSettings.musicEnabled,
    });
    setAudioSettings(next);
  };

  const handleToggleSfx = () => {
    const next = soundEngine.updateSettings({
      sfxEnabled: !audioSettings.sfxEnabled,
    });
    setAudioSettings(next);
  };

  const startDeckStudy = (deck: QuizDeck, practiceAll = false) => {
    const dueCards = deck.cards.filter((c) => isCardDue(c));
    const chosen = practiceAll || dueCards.length === 0 ? deck.cards : dueCards;
    if (chosen.length === 0) return;

    setSessionInitialMode('mixed');
    setActiveQueue(
      chosen.map((card) => ({
        deckId: deck.id,
        deckTitle: deck.title,
        card,
      }))
    );
    setView('study');
  };

  const startAllDueStudy = () => {
    if (dueQueue.length > 0) {
      setSessionInitialMode('mixed');
      setActiveQueue(dueQueue);
      setView('study');
    } else if (decks.length > 0) {
      startDeckStudy(decks[0], true);
    } else {
      setView('generator');
    }
  };

  const handleCardReviewed = (
    deckId: string,
    updatedCard: QuizCard,
    rating: ReviewRating
  ) => {
    setDecks((prev) =>
      prev.map((deck) => {
        if (deck.id !== deckId) return deck;
        return {
          ...deck,
          cards: deck.cards.map((c) => (c.id === updatedCard.id ? updatedCard : c)),
        };
      })
    );
    setStudyLog((prev) => [
      {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        deckId,
        cardId: updatedCard.id,
        rating,
        timestamp: new Date().toISOString(),
        correct: rating >= 2,
      },
      ...prev.slice(0, 499),
    ]);
  };

  const handleSaveNewDeck = (
    newDeck: QuizDeck,
    startImmediately = false,
    initialMode: QuizMode = 'mixed'
  ) => {
    setDecks((prev) => [newDeck, ...prev]);
    if (startImmediately) {
      setSessionInitialMode(initialMode);
      setActiveQueue(
        newDeck.cards.map((card) => ({
          deckId: newDeck.id,
          deckTitle: newDeck.title,
          card,
        }))
      );
      setView('study');
    } else {
      setView('meadow');
    }
  };

  const handleDeleteDeck = (deckId: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setConfirmDeleteId(null);
  };

  const handleRestoreSeeds = () => {
    const seeds = buildSeedDecks();
    setDecks((prev) => {
      const existingIds = new Set(prev.map((d) => d.id));
      const missing = seeds.filter((s) => !existingIds.has(s.id));
      return [...prev, ...missing];
    });
  };

  const companionDisplayName =
    mascotId === 'trio' ? 'All Friends' : MASCOT_PROFILES[mascotId].name;

  return (
    <div className="relative min-h-screen text-[#1F2A1E]">
      <MeadowBackground />

      {/* Top Bar Contract: Zone 1 (1-line Brand) — Zone 2 (4 nav links) — Zone 3 (1 primary CTA) */}
      <header className="border-b border-[#EAD5DE] bg-[#FFFDFB]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setView('meadow')}
            className="font-display text-xl font-bold tracking-tight text-[#1F2A1E] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A]"
          >
            KusaQuiz
          </button>

          {/* Zone 2: 4 concise single-line text nav links */}
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-6 md:flex"
          >
            {(
              [
                { id: 'meadow', label: 'Study Meadow' },
                { id: 'generator', label: 'Quiz Generator' },
                { id: 'retention', label: 'Retention Lab' },
                { id: 'sound', label: 'Sound Garden' },
              ] as Array<{ id: AppView; label: string }>
            ).map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`border-b-2 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-[#2F855A] text-[#1F2A1E]'
                      : 'border-transparent text-[#4E5E4B] hover:border-[#A7D397] hover:text-[#1F2A1E]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            {dueQueue.length > 0 ? (
              <button
                type="button"
                onClick={startAllDueStudy}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#276749] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A]"
              >
                <Play className="h-3.5 w-3.5" />
                Start Due Review
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setView('generator')}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#276749] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A]"
              >
                <Plus className="h-3.5 w-3.5" />
                New Quiz
              </button>
            )}
          </div>
        </div>

        {/* Mobile Secondary Nav Row (non-sticky so 0% sticky cap) */}
        <nav
          aria-label="Mobile navigation"
          className="flex items-center justify-between gap-2 border-t border-[#E6EEDF] px-4 py-2 md:hidden"
        >
          {(
            [
              { id: 'meadow', label: 'Study Meadow' },
              { id: 'generator', label: 'Generator' },
              { id: 'retention', label: 'Retention' },
              { id: 'sound', label: 'Sounds' },
            ] as Array<{ id: AppView; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={`rounded-md px-1.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                view === item.id
                  ? 'bg-[#ECF8F0] font-semibold text-[#2F855A]'
                  : 'text-[#4E5E4B]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-14 pb-24">
        {view === 'study' ? (
          <StudySession
            initialQueue={activeQueue}
            initialMode={sessionInitialMode}
            mascotId={mascotId}
            audioSettings={audioSettings}
            onToggleMusic={handleToggleMusic}
            onToggleSfx={handleToggleSfx}
            onCardReviewed={handleCardReviewed}
            onScheduleCard={(card, rating) => scheduleCardReview(card, rating)}
            onExit={() => setView('meadow')}
          />
        ) : view === 'generator' ? (
          <QuizGenerator
            key={generatorTab}
            initialTab={generatorTab}
            onSaveDeck={handleSaveNewDeck}
          />
        ) : view === 'retention' ? (
          <RetentionLab decks={decks} studyLog={studyLog} />
        ) : view === 'sound' ? (
          <SoundGarden
            mascotId={mascotId}
            onSelectMascot={setMascotId}
            audioSettings={audioSettings}
            onUpdateAudio={setAudioSettings}
          />
        ) : (
          /* Study Meadow Home View */
          <div className="space-y-8">
            {/* Hero Sanctuary Split */}
            <section className="grid items-stretch gap-6 lg:grid-cols-12">
              {/* Left Narrative & Primary Actions */}
              <div className="flex flex-col justify-between rounded-3xl border border-[#E6D5DC] bg-white/95 p-7 shadow-xs lg:col-span-7">
                <div>
                  <p className="text-xs font-medium text-[#A2496B]">
                    Spaced Repetition Sanctuary · SM-2 Active Recall
                  </p>
                  <h1 className="mt-2.5 font-display text-4xl font-bold tracking-tight text-[#1F2A1E] text-balance sm:text-[2.65rem] sm:leading-[1.12]">
                    Grow lasting memory in a quiet grass meadow
                  </h1>
                  <p className="mt-3 max-w-xl text-base leading-relaxed text-[#4E5E4B]">
                    Generate interactive quizzes from any topic or lecture notes. Answer
                    with multiple choice, typed recall, or flashcards while{' '}
                    {companionDisplayName} celebrates your streaks with soothing meadow
                    chimes.
                  </p>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={startAllDueStudy}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#276749] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F855A]"
                    >
                      <Play className="h-4 w-4" />
                      {dueQueue.length > 0
                        ? `Study Due Cards (${dueQueue.length})`
                        : 'Practice Meadow Deck'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGeneratorTab('file');
                        setView('generator');
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#E6D5DC] bg-[#FFF8FA] px-5 py-3 text-sm font-semibold text-[#1F2A1E] transition-colors hover:bg-[#FCEFF4] whitespace-nowrap shrink-0"
                    >
                      <FileUp className="h-4 w-4 text-[#A2496B]" />
                      Read PDF / DOCX
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGeneratorTab('ai');
                        setView('generator');
                      }}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#CBD8BE] bg-[#F7FAF2] px-5 py-3 text-sm font-semibold text-[#1F2A1E] transition-colors hover:bg-[#ECF3E2] whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-4 w-4 text-[#2F855A]" />
                      Generate New Quiz
                    </button>
                  </div>

                  {/* Workspace Audio Quick Controls */}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[#EDF2E7] pt-4 text-xs">
                    <button
                      type="button"
                      onClick={handleToggleMusic}
                      aria-pressed={audioSettings.musicEnabled}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                        audioSettings.musicEnabled
                          ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                          : 'border-[#DCE6D3] bg-[#FAFDF7] text-[#4E5E4B] hover:bg-[#EFF5E7]'
                      }`}
                    >
                      <Music className="h-3.5 w-3.5" />
                      {audioSettings.musicEnabled
                        ? 'Meadow Music Playing'
                        : 'Play Soothing Music'}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleSfx}
                      aria-pressed={audioSettings.sfxEnabled}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition-colors whitespace-nowrap shrink-0 ${
                        audioSettings.sfxEnabled
                          ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                          : 'border-[#DCE6D3] bg-[#FAFDF7] text-[#4E5E4B] hover:bg-[#EFF5E7]'
                      }`}
                    >
                      {audioSettings.sfxEnabled ? (
                        <Volume2 className="h-3.5 w-3.5" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5" />
                      )}
                      {audioSettings.sfxEnabled ? 'Milestone SFX On' : 'Milestone SFX Off'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setView('sound')}
                      className="font-medium text-[#2F855A] hover:underline whitespace-nowrap shrink-0"
                    >
                      Switch Companion
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Scenic Meadow Card + Live Companion */}
              <div className="flex flex-col justify-between gap-4 rounded-3xl border border-[#E6D5DC] bg-white/95 p-5 shadow-xs lg:col-span-5">
                <div className="relative overflow-hidden rounded-2xl border border-[#E2ECD7] bg-[#EAF4DE]">
                  {!heroImgFailed ? (
                    <img
                      src={HERO_BANNER_SRC}
                      alt="Sunlit watercolor grass meadow with clover hills and wildflowers"
                      referrerPolicy="no-referrer"
                      onError={() => setHeroImgFailed(true)}
                      className="h-44 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-44 w-full items-center justify-center bg-gradient-to-br from-[#EAF4DE] to-[#CFE5B7] p-6 text-center">
                      <p className="font-display text-sm font-semibold text-[#2C4A2B]">
                        Sunlit Study Meadow
                      </p>
                    </div>
                  )}
                </div>

                <MascotStage
                  mascotId={mascotId}
                  mood={dueQueue.length === 0 ? 'celebrate_mastery' : 'idle'}
                  message={
                    dueQueue.length > 0
                      ? `${dueQueue.length} cards are ready in the grass today. Let's review together!`
                      : 'All due cards are tucked away safely in long-term memory!'
                  }
                  compact
                  embedded
                />
              </div>
            </section>

            {/* Full-Width 4-Column KPI Strip */}
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-[#D8E3CE] bg-white/95 px-5 py-4">
                <dt className="text-xs text-[#5A6B57]">Due for Review</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold text-[#2F855A] tabular-nums">
                  {dueQueue.length}
                </dd>
              </div>
              <div className="rounded-2xl border border-[#D8E3CE] bg-white/95 px-5 py-4">
                <dt className="text-xs text-[#5A6B57]">Total Cards</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold text-[#1F2A1E] tabular-nums">
                  {totalCards}
                </dd>
              </div>
              <div className="rounded-2xl border border-[#D8E3CE] bg-white/95 px-5 py-4">
                <dt className="text-xs text-[#5A6B57]">Mastered (21d+)</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold text-[#D97706] tabular-nums">
                  {masteredCards}
                </dd>
              </div>
              <div className="rounded-2xl border border-[#D8E3CE] bg-white/95 px-5 py-4">
                <dt className="text-xs text-[#5A6B57]">Reviews Logged</dt>
                <dd className="mt-1 font-mono text-2xl font-semibold text-[#1F2A1E] tabular-nums">
                  {studyLog.length}
                </dd>
              </div>
            </dl>

            {/* Decks Section */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-bold text-[#1F2A1E]">
                    Your Quiz Decks
                  </h2>
                  <p className="text-sm text-[#4E5E4B]">
                    Cards surface automatically using SM-2 spacing intervals.
                  </p>
                </div>

                {decks.length < 3 && (
                  <button
                    type="button"
                    onClick={handleRestoreSeeds}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#CBD8BE] bg-white px-3.5 py-2 text-xs font-semibold text-[#2C3A2B] hover:bg-[#F1F8EA] whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restore Starter Decks
                  </button>
                )}
              </div>

              {decks.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[#C7D6B9] bg-white/90 px-6 py-12 text-center">
                  <img
                    src={CLOVER_EMBLEM_SRC}
                    alt="Four-leaf clover beside a study notebook"
                    referrerPolicy="no-referrer"
                    className="h-28 w-28 rounded-2xl object-cover"
                  />
                  <h3 className="mt-4 font-display text-xl font-semibold text-[#1F2A1E]">
                    Your meadow has room to grow
                  </h3>
                  <p className="mt-1 max-w-md text-sm text-[#4E5E4B]">
                    Generate an interactive spaced-repetition quiz from any topic or restore
                    the curated starter decks.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setView('generator')}
                      className="rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#276749]"
                    >
                      Generate Quiz Deck
                    </button>
                    <button
                      type="button"
                      onClick={handleRestoreSeeds}
                      className="rounded-xl border border-[#CBD8BE] bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2A1E] hover:bg-[#F1F8EA]"
                    >
                      Restore Starter Decks
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {decks.map((deck) => {
                    const dueCount = deck.cards.filter((c) => isCardDue(c)).length;
                    const mastered = deck.cards.filter((c) => c.state === 'mastered').length;
                    const retention = calculateDeckRetention(deck);
                    const progressPct =
                      deck.cards.length > 0
                        ? Math.round(
                            (deck.cards.filter((c) => c.repetitions > 0).length /
                              deck.cards.length) *
                              100
                          )
                        : 0;

                    return (
                      <article
                        key={deck.id}
                        className="flex flex-col justify-between rounded-3xl border border-[#D8E3CE] bg-white p-6 shadow-xs transition-colors hover:border-[#A7D397]"
                      >
                        <div>
                          {/* Clean unboxed metadata line */}
                          <p className="text-xs text-[#5A6B57] tabular-nums">
                            {deck.subject} · {deck.cards.length}{' '}
                            {deck.cards.length === 1 ? 'card' : 'cards'} ·{' '}
                            {retention > 0 ? `${retention}% retention` : 'Ready to start'}
                          </p>

                          <h3 className="mt-2 font-display text-xl font-semibold text-[#1F2A1E]">
                            {deck.title}
                          </h3>
                          <p className="mt-1.5 text-sm leading-relaxed text-[#4E5E4B]">
                            {deck.description}
                          </p>
                        </div>

                        <div className="mt-5 space-y-4">
                          <div>
                            <div className="flex items-center justify-between text-xs text-[#5A6B57] tabular-nums">
                              <span>
                                {dueCount > 0 ? `${dueCount} due today` : 'Caught up'}
                              </span>
                              <span>
                                {mastered} mastered · {progressPct}% started
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#E8F0DF]">
                              <div
                                className="h-full rounded-full bg-[#38A169]"
                                style={{ width: `${Math.max(4, progressPct)}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => startDeckStudy(deck, dueCount === 0)}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2F855A] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#276749] whitespace-nowrap shrink-0"
                            >
                              <BookOpen className="h-3.5 w-3.5" />
                              {dueCount > 0 ? `Study Due (${dueCount})` : 'Practice Deck'}
                            </button>

                            {confirmDeleteId === deck.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDeck(deck.id)}
                                  className="rounded-lg bg-[#DC2626] px-2.5 py-2 text-xs font-semibold text-white hover:bg-[#B91C1C] whitespace-nowrap shrink-0"
                                >
                                  Delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded-lg border border-[#D8E3CE] px-2 py-2 text-xs font-medium text-[#4E5E4B] hover:bg-[#F1F8EA]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Delete ${deck.title}`}
                                onClick={() => setConfirmDeleteId(deck.id)}
                                className="rounded-xl border border-[#E2ECD7] p-2.5 text-[#6B7B67] transition-colors hover:border-[#FCA5A5] hover:bg-[#FEF2F2] hover:text-[#991B1B]"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
