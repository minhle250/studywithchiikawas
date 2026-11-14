import React, { useState } from 'react';
import {
  Bot,
  Check,
  ExternalLink,
  Lightbulb,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AgentTraceStep,
  GeneratedCardDraft,
  QuizCard,
  QuizDeck,
  QuizIdeaSuggestion,
  QuizMode,
  ResearchSource,
} from '../types/quiz';
import { CURATED_QUIZ_IDEAS } from '../data/seedDecks';
import { runAgentQuizStream } from '../utils/agentStreamClient';
import { createNewCard } from '../utils/spacedRepetition';
import { soundEngine } from '../utils/soundEngine';
import { FileStudyStudio } from './FileStudyStudio';

export type GeneratorTab = 'file' | 'ai' | 'manual';

interface QuizGeneratorProps {
  initialTab?: GeneratorTab;
  onSaveDeck: (
    deck: QuizDeck,
    startImmediately?: boolean,
    initialMode?: QuizMode
  ) => void;
}

export const QuizGenerator: React.FC<QuizGeneratorProps> = ({
  initialTab = 'file',
  onSaveDeck,
}) => {
  const [builderTab, setBuilderTab] = useState<GeneratorTab>(initialTab);

  // AI Generator state
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('Intermediate');
  const [cardCount, setCardCount] = useState(6);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunningAgents, setIsRunningAgents] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentTraceStep[]>([]);
  const [agentSources, setAgentSources] = useState<ResearchSource[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [generatedPreview, setGeneratedPreview] = useState<{
    title: string;
    description: string;
    subject: string;
    cards: GeneratedCardDraft[];
    researchSources?: ResearchSource[];
  } | null>(null);

  // Ideas helper state
  const [ideas, setIdeas] = useState<QuizIdeaSuggestion[]>(CURATED_QUIZ_IDEAS);
  const [loadingIdeas, setLoadingIdeas] = useState(false);

  // Manual builder state
  const [manualTitle, setManualTitle] = useState('');
  const [manualSubject, setManualSubject] = useState('General Study');
  const [manualCards, setManualCards] = useState<GeneratedCardDraft[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');
  const [draftDistractors, setDraftDistractors] = useState('');
  const [draftHint, setDraftHint] = useState('');
  const [draftExplanation, setDraftExplanation] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const handleSparkIdeas = async () => {
    setLoadingIdeas(true);
    try {
      const res = await fetch('/api/quiz/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interest: topic || notes || '' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.ideas) && data.ideas.length > 0) {
          setIdeas(data.ideas);
          soundEngine.playMilestone('card_flip');
        }
      }
    } catch {
      // Keep curated ideas cleanly without breaking flow
    } finally {
      setLoadingIdeas(false);
    }
  };

  const handleGenerateAiQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAgentSteps([]);
    setAgentSources([]);

    if (!topic.trim() && !notes.trim()) {
      setErrorMsg('Please enter a study topic or paste lecture notes first.');
      return;
    }

    setIsGenerating(true);
    try {
      const res = await fetch('/api/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          notes: notes.trim(),
          difficulty,
          count: cardCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not generate quiz. Please try again.');
        return;
      }
      setGeneratedPreview(data);
      soundEngine.playMilestone('quiz_generated');
    } catch {
      setErrorMsg('Network error while generating quiz. Please check connection and retry.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRunAgentsOnTopic = async () => {
    setErrorMsg(null);
    setAgentSteps([]);
    setAgentSources([]);
    setGeneratedPreview(null);

    if (!topic.trim() && !notes.trim()) {
      setErrorMsg('Please enter a study topic or paste calculation notes first.');
      return;
    }

    setIsRunningAgents(true);
    try {
      const result = await runAgentQuizStream(
        {
          topic: topic.trim(),
          notes: notes.trim(),
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

      setGeneratedPreview({
        title: result.title,
        description: result.description,
        subject: result.subject,
        cards: result.cards,
        researchSources: result.researchSources,
      });
      soundEngine.playMilestone('quiz_generated');
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'AI Agents encountered an error. Please try again.'
      );
    } finally {
      setIsRunningAgents(false);
    }
  };

  const buildDeckFromDrafts = (
    title: string,
    description: string,
    subject: string,
    drafts: GeneratedCardDraft[],
    researchSources?: ResearchSource[]
  ): QuizDeck => {
    const now = new Date();
    const deckId = `deck-${Date.now()}`;
    const cards: QuizCard[] = drafts.map((d, idx) =>
      createNewCard(
        {
          id: `${deckId}-c-${idx + 1}`,
          prompt: d.prompt,
          answer: d.answer,
          distractors:
            Array.isArray(d.distractors) && d.distractors.length >= 3
              ? d.distractors.slice(0, 3)
              : ['Alternative option A', 'Alternative option B', 'Alternative option C'],
          acceptableAnswers: d.acceptableAnswers ?? [],
          hint: d.hint || '',
          explanation: d.explanation || `The correct answer is ${d.answer}.`,
          conceptTag: d.conceptTag || subject,
          exerciseType: d.exerciseType,
          formulaUsed: d.formulaUsed,
          workedSteps: d.workedSteps,
        },
        now
      )
    );
    return {
      id: deckId,
      title,
      description,
      subject,
      createdAt: now.toISOString(),
      cards,
      researchSources,
    };
  };

  const handleSaveGeneratedDeck = (startNow: boolean) => {
    if (!generatedPreview) return;
    const deck = buildDeckFromDrafts(
      generatedPreview.title,
      generatedPreview.description,
      generatedPreview.subject,
      generatedPreview.cards,
      generatedPreview.researchSources
    );
    onSaveDeck(deck, startNow);
    setGeneratedPreview(null);
    setAgentSteps([]);
    setAgentSources([]);
    setTopic('');
    setNotes('');
  };

  const handleAddManualCard = (e: React.FormEvent) => {
    e.preventDefault();
    setManualError(null);
    if (!draftPrompt.trim() || !draftAnswer.trim()) {
      setManualError('Both a question prompt and an answer are required.');
      return;
    }

    const parsedDistractors = draftDistractors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    while (parsedDistractors.length < 3) {
      parsedDistractors.push(`Other concept ${parsedDistractors.length + 1}`);
    }

    setManualCards((prev) => [
      ...prev,
      {
        prompt: draftPrompt.trim(),
        answer: draftAnswer.trim(),
        distractors: parsedDistractors.slice(0, 3),
        acceptableAnswers: [draftAnswer.trim()],
        hint: draftHint.trim(),
        explanation:
          draftExplanation.trim() || `Correct recall: ${draftAnswer.trim()}.`,
        conceptTag: manualSubject || 'Custom Card',
      },
    ]);
    setDraftPrompt('');
    setDraftAnswer('');
    setDraftDistractors('');
    setDraftHint('');
    setDraftExplanation('');
    soundEngine.playMilestone('card_flip');
  };

  const handleSaveManualDeck = (startNow: boolean) => {
    setManualError(null);
    if (!manualTitle.trim()) {
      setManualError('Please give your custom deck a title.');
      return;
    }
    if (manualCards.length === 0) {
      setManualError('Add at least one quiz card before saving.');
      return;
    }

    const deck = buildDeckFromDrafts(
      manualTitle.trim(),
      `Custom spaced-repetition deck with ${manualCards.length} atomic recall ${
        manualCards.length === 1 ? 'card' : 'cards'
      }.`,
      manualSubject.trim() || 'Custom Study',
      manualCards
    );
    soundEngine.playMilestone('quiz_generated');
    onSaveDeck(deck, startNow);
    setManualTitle('');
    setManualCards([]);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2A1E] text-balance">
            Quiz Generator
          </h1>
          <p className="mt-1 text-sm text-[#4E5E4B]">
            Turn any topic or lecture notes into atomic, research-backed spaced-repetition cards.
          </p>
        </div>

        <div
          className="flex flex-wrap items-center gap-1 rounded-xl border border-[#D8E3CE] bg-white p-1"
          role="tablist"
          aria-label="Quiz builder method"
        >
          <button
            type="button"
            role="tab"
            aria-selected={builderTab === 'file'}
            onClick={() => setBuilderTab('file')}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              builderTab === 'file'
                ? 'bg-[#2F855A] text-white'
                : 'text-[#4E5E4B] hover:text-[#1F2A1E]'
            }`}
          >
            Read Files (PDF / DOCX)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={builderTab === 'ai'}
            onClick={() => setBuilderTab('ai')}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              builderTab === 'ai'
                ? 'bg-[#2F855A] text-white'
                : 'text-[#4E5E4B] hover:text-[#1F2A1E]'
            }`}
          >
            AI Topic & Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={builderTab === 'manual'}
            onClick={() => setBuilderTab('manual')}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              builderTab === 'manual'
                ? 'bg-[#2F855A] text-white'
                : 'text-[#4E5E4B] hover:text-[#1F2A1E]'
            }`}
          >
            Manual Card Builder
          </button>
        </div>
      </div>

      {builderTab === 'file' ? (
        <FileStudyStudio onSaveDeck={onSaveDeck} />
      ) : builderTab === 'ai' ? (
        <div className="grid items-start gap-6 lg:grid-cols-12">
          {/* Form Column */}
          <form
            onSubmit={handleGenerateAiQuiz}
            className="space-y-5 rounded-3xl border border-[#D8E3CE] bg-white p-6 shadow-xs lg:col-span-7"
          >
            <div>
              <label
                htmlFor="quiz-topic-input"
                className="block text-sm font-semibold text-[#1F2A1E]"
              >
                Study Topic
              </label>
              <input
                id="quiz-topic-input"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Photosynthesis Light Reactions, Japanese JLPT N5 Verbs, Linear Algebra Eigenvalues"
                className="mt-1.5 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-4 py-2.5 text-sm text-[#1F2A1E] placeholder:text-[#8E9C8B] focus:border-[#2F855A] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="quiz-notes-input"
                className="block text-sm font-semibold text-[#1F2A1E]"
              >
                Paste Study Notes or Textbook Excerpt (Optional)
              </label>
              <textarea
                id="quiz-notes-input"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Paste class notes, definitions, or key concepts. Cards will be extracted following the Minimum Information Principle..."
                className="mt-1.5 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-4 py-2.5 text-sm text-[#1F2A1E] placeholder:text-[#8E9C8B] focus:border-[#2F855A] focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="quiz-difficulty-select"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Cognitive Difficulty
                </label>
                <select
                  id="quiz-difficulty-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2.5 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                >
                  <option value="Foundational">Foundational</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Exam Prep">Exam Prep</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="quiz-count-select"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Cards to Generate
                </label>
                <select
                  id="quiz-count-select"
                  value={cardCount}
                  onChange={(e) => setCardCount(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2.5 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                >
                  <option value={5}>5 atomic cards</option>
                  <option value={8}>8 atomic cards</option>
                  <option value={12}>12 atomic cards</option>
                </select>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
              >
                {errorMsg}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-xs text-[#5A6B57]">
                Includes multiple-choice distractors, hints & worked solutions.
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleRunAgentsOnTopic}
                  disabled={isGenerating || isRunningAgents}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#2F855A] bg-[#EFFAF2] px-4 py-2.5 text-xs font-semibold text-[#1D593A] transition-colors hover:bg-[#DCFCE7] disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {isRunningAgents ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Running AI Agents...
                    </>
                  ) : (
                    <>
                      <Bot className="h-3.5 w-3.5" />
                      AI Agents · Math & Search
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  disabled={isGenerating || isRunningAgents}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#276749] disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sprouting Quiz...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Quiz Deck
                    </>
                  )}
                </button>
              </div>
            </div>

            {agentSteps.length > 0 && (
              <div className="space-y-2 rounded-2xl border border-[#C7DEC6] bg-[#F6FBF3] p-4">
                <p className="text-xs font-semibold text-[#1D593A]">
                  AI Agent Pipeline Trace
                </p>
                {agentSteps.map((step) => (
                  <div
                    key={step.agent}
                    className="flex items-start gap-2 text-xs text-[#2A3729]"
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
                {agentSources.length > 0 && (
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#DCE8D3] pt-2">
                    {agentSources.map((src) => (
                      <li key={src.url}>
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#2F855A] underline"
                        >
                          {src.title}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </form>

          {/* Right Column: Spark Quiz Ideas */}
          <div className="space-y-4 rounded-3xl border border-[#D8E3CE] bg-white/95 p-6 lg:col-span-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
                  Need Quiz Ideas?
                </h2>
                <p className="text-xs text-[#5A6B57]">
                  Click any idea to pre-fill the generator.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSparkIdeas}
                disabled={loadingIdeas}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#D4DFC7] bg-[#F6FAF0] px-3 py-1.5 text-xs font-semibold text-[#2F855A] transition-colors hover:bg-[#EBF4E0] whitespace-nowrap shrink-0"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                {loadingIdeas ? 'Sparking...' : 'Spark Ideas'}
              </button>
            </div>

            <div className="space-y-2.5">
              {ideas.map((idea) => (
                <button
                  key={idea.title}
                  type="button"
                  onClick={() => {
                    setTopic(idea.promptTopic);
                    setErrorMsg(null);
                  }}
                  className="w-full rounded-2xl border border-[#E2ECD7] bg-[#FAFDF7] p-3.5 text-left transition-colors hover:border-[#8DC27E] hover:bg-[#F2F9EA]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#1F2A1E]">
                      {idea.title}
                    </span>
                    <span className="text-xs text-[#5A6B57] shrink-0">
                      {idea.subject}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#4E5E4B]">
                    {idea.whyItWorks}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Generated Deck Preview */}
          {generatedPreview && (
            <div className="rounded-3xl border border-[#9FD0A8] bg-white p-6 shadow-sm lg:col-span-12">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E6EEDF] pb-4">
                <div>
                  <p className="text-xs font-medium text-[#2F855A]">
                    Ready to Plant · {generatedPreview.subject} ·{' '}
                    {generatedPreview.cards.length} cards
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-bold text-[#1F2A1E]">
                    {generatedPreview.title}
                  </h3>
                  <p className="mt-0.5 text-sm text-[#4E5E4B]">
                    {generatedPreview.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSaveGeneratedDeck(false)}
                    className="rounded-xl border border-[#D4DFC7] bg-[#F7FAF2] px-4 py-2.5 text-sm font-semibold text-[#1F2A1E] hover:bg-[#ECF3E2] whitespace-nowrap shrink-0"
                  >
                    Save to Meadow
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveGeneratedDeck(true)}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#2F855A] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#276749] whitespace-nowrap shrink-0"
                  >
                    <Play className="h-4 w-4" />
                    Save & Study Now
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {generatedPreview.cards.map((card, i) => (
                  <div
                    key={i}
                    className="rounded-2xl border border-[#E6EEDF] bg-[#FAFDF7] p-4"
                  >
                    <p className="text-xs text-[#5A6B57]">
                      {i + 1}. {card.conceptTag}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#1F2A1E]">
                      {card.prompt}
                    </p>
                    <p className="mt-1.5 text-sm font-medium text-[#2F855A]">
                      Answer: {card.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Manual Card Builder */
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleAddManualCard}
            className="space-y-4 rounded-3xl border border-[#D8E3CE] bg-white p-6 shadow-xs lg:col-span-7"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="manual-deck-title"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Deck Title
                </label>
                <input
                  id="manual-deck-title"
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g., Anatomy Cranial Nerves"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="manual-deck-subject"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Subject
                </label>
                <input
                  id="manual-deck-subject"
                  type="text"
                  value={manualSubject}
                  onChange={(e) => setManualSubject(e.target.value)}
                  placeholder="e.g., Medicine"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
            </div>

            <div className="border-t border-[#E6EEDF] pt-4">
              <label
                htmlFor="manual-card-prompt"
                className="block text-xs font-semibold text-[#4E5E4B]"
              >
                Question Prompt
              </label>
              <input
                id="manual-card-prompt"
                type="text"
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                placeholder="Ask one atomic question..."
                className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="manual-card-answer"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Correct Answer
                </label>
                <input
                  id="manual-card-answer"
                  type="text"
                  value={draftAnswer}
                  onChange={(e) => setDraftAnswer(e.target.value)}
                  placeholder="Concise answer"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="manual-card-distractors"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  3 Wrong Choices (comma-separated)
                </label>
                <input
                  id="manual-card-distractors"
                  type="text"
                  value={draftDistractors}
                  onChange={(e) => setDraftDistractors(e.target.value)}
                  placeholder="Option A, Option B, Option C"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="manual-card-hint"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Hint (Optional)
                </label>
                <input
                  id="manual-card-hint"
                  type="text"
                  value={draftHint}
                  onChange={(e) => setDraftHint(e.target.value)}
                  placeholder="Gentle clue"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="manual-card-explanation"
                  className="block text-xs font-semibold text-[#4E5E4B]"
                >
                  Explanation (Optional)
                </label>
                <input
                  id="manual-card-explanation"
                  type="text"
                  value={draftExplanation}
                  onChange={(e) => setDraftExplanation(e.target.value)}
                  placeholder="Why this answer holds"
                  className="mt-1 w-full rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3.5 py-2 text-sm text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
                />
              </div>
            </div>

            {manualError && (
              <div
                role="alert"
                className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-sm text-[#991B1B]"
              >
                {manualError}
              </div>
            )}

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#2F855A] bg-[#EFFAF2] px-4 py-2 text-sm font-semibold text-[#1D593A] hover:bg-[#DCFCE7] whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Add Card to Draft ({manualCards.length})
            </button>
          </form>

          <div className="space-y-4 rounded-3xl border border-[#D8E3CE] bg-white p-6 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
                Draft Deck ({manualCards.length} cards)
              </h2>
              {manualCards.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleSaveManualDeck(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2F855A] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#276749] whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  Save & Study
                </button>
              )}
            </div>

            {manualCards.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#D8E3CE] bg-[#FAFDF7] px-4 py-8 text-center text-sm text-[#5A6B57]">
                No draft cards yet. Add your first question on the left!
              </p>
            ) : (
              <div className="space-y-2.5">
                {manualCards.map((c, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-xl border border-[#E6EEDF] bg-[#FAFDF7] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#1F2A1E]">
                        {c.prompt}
                      </p>
                      <p className="text-xs text-[#2F855A]">Answer: {c.answer}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove draft card ${idx + 1}`}
                      onClick={() =>
                        setManualCards((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="rounded-lg p-1.5 text-[#7A8A77] hover:bg-[#FEE2E2] hover:text-[#991B1B]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => handleSaveManualDeck(false)}
                  className="w-full rounded-xl border border-[#D4DFC7] bg-[#F7FAF2] px-4 py-2.5 text-sm font-semibold text-[#1F2A1E] hover:bg-[#ECF3E2]"
                >
                  Save Deck to Study Meadow
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
