import React, { useMemo, useState } from 'react';
import type { QuizDeck, StudyLogEntry } from '../types/quiz';
import {
  buildReviewForecast,
  calculateDeckRetention,
  calculateRetentionProbability,
  formatInterval,
} from '../utils/spacedRepetition';

interface RetentionLabProps {
  decks: QuizDeck[];
  studyLog: StudyLogEntry[];
}

export const RetentionLab: React.FC<RetentionLabProps> = ({ decks, studyLog }) => {
  const [selectedDeckId, setSelectedDeckId] = useState<string>('all');

  const forecast = useMemo(() => buildReviewForecast(decks, 7), [decks]);
  const maxDue = Math.max(1, ...forecast.map((d) => d.dueCount));

  const allCards = useMemo(() => {
    const targetDecks =
      selectedDeckId === 'all' ? decks : decks.filter((d) => d.id === selectedDeckId);
    return targetDecks.flatMap((d) =>
      d.cards.map((card) => ({
        deckTitle: d.title,
        card,
        retentionPct: Math.round(calculateRetentionProbability(card) * 100),
      }))
    );
  }, [decks, selectedDeckId]);

  const totalCards = decks.reduce((s, d) => s + d.cards.length, 0);
  const masteredCount = decks.reduce(
    (s, d) => s + d.cards.filter((c) => c.state === 'mastered').length,
    0
  );
  const avgRetention = useMemo(() => {
    const deckScores = decks
      .map((d) => calculateDeckRetention(d))
      .filter((score) => score > 0);
    if (deckScores.length === 0) return 0;
    return Math.round(deckScores.reduce((a, b) => a + b, 0) / deckScores.length);
  }, [decks]);

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2A1E] text-balance">
          Retention Lab
        </h1>
        <p className="mt-1 text-sm text-[#4E5E4B]">
          Scientific SM-2 scheduling interrupts the Ebbinghaus forgetting curve right before
          recall fades below 90%.
        </p>
      </div>

      {/* Summary KPI Row */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#D8E3CE] bg-white p-4">
          <dt className="text-xs text-[#5A6B57]">Total Cards</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1F2A1E] tabular-nums">
            {totalCards}
          </dd>
        </div>
        <div className="rounded-2xl border border-[#D8E3CE] bg-white p-4">
          <dt className="text-xs text-[#5A6B57]">Estimated Retention</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#2F855A] tabular-nums">
            {avgRetention > 0 ? `${avgRetention}%` : '—'}
          </dd>
        </div>
        <div className="rounded-2xl border border-[#D8E3CE] bg-white p-4">
          <dt className="text-xs text-[#5A6B57]">Mastered (21d+)</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#D97706] tabular-nums">
            {masteredCount}
          </dd>
        </div>
        <div className="rounded-2xl border border-[#D8E3CE] bg-white p-4">
          <dt className="text-xs text-[#5A6B57]">Logged Reviews</dt>
          <dd className="mt-1 font-mono text-2xl font-semibold text-[#1F2A1E] tabular-nums">
            {studyLog.length}
          </dd>
        </div>
      </dl>

      {/* Two Visual Charts: Ebbinghaus Curve & 7-Day Forecast */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Ebbinghaus Spaced Repetition Curve */}
        <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
                Forgetting Curve vs. Spaced Reviews
              </h2>
              <p className="text-xs text-[#5A6B57]">
                Each active recall flattens memory decay across 1d, 6d, and 15d+ intervals.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#4E5E4B]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4 bg-[#CBD5E1]" aria-hidden="true" />
                No review
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-[#2F855A]">
                <span className="h-0.5 w-4 bg-[#2F855A]" aria-hidden="true" />
                SM-2 spaced
              </span>
            </div>
          </div>

          <div className="mt-4">
            <svg
              viewBox="0 0 560 210"
              className="w-full"
              role="img"
              aria-label="Chart comparing memory retention without review against SM-2 spaced repetition intervals"
            >
              {/* Grid lines */}
              {[40, 90, 140, 180].map((y) => (
                <line
                  key={y}
                  x1="46"
                  y1={y}
                  x2="540"
                  y2={y}
                  stroke="#EDF2E7"
                  strokeWidth="1"
                />
              ))}
              {/* Axes */}
              <line x1="46" y1="20" x2="46" y2="180" stroke="#CBD8BE" strokeWidth="1.5" />
              <line x1="46" y1="180" x2="540" y2="180" stroke="#CBD8BE" strokeWidth="1.5" />

              {/* Y labels */}
              <text x="10" y="34" fontSize="11" fill="#64748B">
                100%
              </text>
              <text x="16" y="94" fontSize="11" fill="#64748B">
                60%
              </text>
              <text x="16" y="144" fontSize="11" fill="#64748B">
                30%
              </text>

              {/* Unreviewed decay curve */}
              <path
                d="M46,30 Q140,145 530,170"
                fill="none"
                stroke="#94A3B8"
                strokeWidth="2.2"
                strokeDasharray="5 5"
              />

              {/* Spaced repetition sawtooth rising stability */}
              <path
                d="M46,30 Q80,55 110,65 L110,30 Q170,50 230,60 L230,30 Q330,45 410,52 L410,30 Q475,38 532,42"
                fill="none"
                stroke="#2F855A"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Review nodes */}
              {[
                { x: 110, y: 30, label: 'Day 1' },
                { x: 230, y: 30, label: 'Day 6' },
                { x: 410, y: 30, label: 'Day 15' },
              ].map((pt) => (
                <g key={pt.label}>
                  <circle cx={pt.x} cy={pt.y} r="5" fill="#2F855A" stroke="#FFFFFF" strokeWidth="2" />
                  <text x={pt.x - 16} y="198" fontSize="11" fill="#4E5E4B">
                    {pt.label}
                  </text>
                </g>
              ))}
              <text x="42" y="198" fontSize="11" fill="#4E5E4B">
                Learn
              </text>
              <text x="505" y="198" fontSize="11" fill="#4E5E4B">
                Day 30
              </text>
            </svg>
          </div>
        </div>

        {/* 7-Day Review Forecast */}
        <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6 lg:col-span-5">
          <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
            7-Day Meadow Forecast
          </h2>
          <p className="mt-0.5 text-xs text-[#5A6B57]">
            Cards scheduled to sprout for review each day.
          </p>

          <div className="mt-6 flex h-44 items-end justify-between gap-2.5 border-b border-[#E6EEDF] pb-3">
            {forecast.map((day) => {
              const heightPct = Math.round((day.dueCount / maxDue) * 100);
              return (
                <div key={day.dayOffset} className="flex flex-1 flex-col items-center gap-2">
                  <span className="font-mono text-xs font-medium text-[#2C3A2B] tabular-nums">
                    {day.dueCount}
                  </span>
                  <div className="flex h-28 w-full items-end justify-center">
                    <div
                      className={`w-full max-w-[34px] rounded-t-lg transition-all ${
                        day.dayOffset === 0 ? 'bg-[#2F855A]' : 'bg-[#A7D397]'
                      }`}
                      style={{ height: `${Math.max(day.dueCount > 0 ? 14 : 4, heightPct)}%` }}
                    />
                  </div>
                  <span className="text-xs text-[#5A6B57]">{day.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scientific Principles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: 'Active Recall',
            desc: 'Retrieving from memory strengthens synaptic recall far more than passive re-reading.',
          },
          {
            title: 'SM-2 Spacing',
            desc: 'Easy items stretch exponentially (1d → 6d → 15d+); tricky items return sooner.',
          },
          {
            title: 'Desirable Difficulty',
            desc: 'Typed recall and mixed modes induce productive effort that cements durable knowledge.',
          },
          {
            title: 'Zero-Penalty Lapses',
            desc: 'Missing a card gently re-queues it within the same session so encoding completes.',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-2xl border border-[#D8E3CE] bg-white/95 p-4"
          >
            <h3 className="font-display text-sm font-semibold text-[#1F2A1E]">
              {item.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[#4E5E4B]">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Card Memory Inspector Table */}
      <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
            Card Memory Schedule
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor="retention-deck-filter" className="text-xs text-[#5A6B57]">
              Deck
            </label>
            <select
              id="retention-deck-filter"
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className="rounded-xl border border-[#CBD8BE] bg-[#FCFDF9] px-3 py-1.5 text-xs font-medium text-[#1F2A1E] focus:border-[#2F855A] focus:outline-none"
            >
              <option value="all">All Decks ({decks.length})</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-y border-[#E6EEDF] text-xs font-semibold text-[#5A6B57]">
                <th className="py-2.5 pr-4">Concept / Prompt</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3 text-right">Interval</th>
                <th className="py-2.5 px-3 text-right">Ease</th>
                <th className="py-2.5 pl-3 text-right">Retention</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F5EA]">
              {allCards.map(({ deckTitle, card, retentionPct }) => (
                <tr key={card.id} className="hover:bg-[#FAFDF7]">
                  <td className="py-3 pr-4">
                    <p className="font-medium text-[#1F2A1E]">{card.prompt}</p>
                    <p className="text-xs text-[#5A6B57]">
                      {deckTitle} · {card.conceptTag}
                    </p>
                  </td>
                  <td className="py-3 px-3 text-xs font-medium capitalize text-[#2C3A2B]">
                    {card.state}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-[#2C3A2B] tabular-nums">
                    {card.interval > 0 ? formatInterval(card.interval) : 'Due now'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs text-[#2C3A2B] tabular-nums">
                    {card.easeFactor.toFixed(2)}
                  </td>
                  <td className="py-3 pl-3 text-right font-mono text-xs font-semibold text-[#2F855A] tabular-nums">
                    {card.lastReviewedAt ? `${retentionPct}%` : 'New'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
