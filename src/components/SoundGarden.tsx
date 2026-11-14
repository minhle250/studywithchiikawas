import React, { useState } from 'react';
import { Music, Play, Sparkles, Volume2 } from 'lucide-react';
import type {
  AudioSettings,
  MascotId,
  MascotMood,
  SoundMilestone,
} from '../types/quiz';
import { soundEngine } from '../utils/soundEngine';
import { MASCOT_PROFILES, MascotAvatar, MascotStage } from './MascotStage';

interface SoundGardenProps {
  mascotId: MascotId;
  onSelectMascot: (id: MascotId) => void;
  audioSettings: AudioSettings;
  onUpdateAudio: (next: AudioSettings) => void;
}

const MILESTONE_PADS: Array<{
  id: SoundMilestone;
  label: string;
  desc: string;
  mood: MascotMood;
  message: string;
}> = [
  {
    id: 'correct_good',
    label: 'Good Recall',
    desc: 'Warm two-note meadow bell',
    mood: 'celebrate_good',
    message: 'Nice recall! Bright bell chime.',
  },
  {
    id: 'correct_easy',
    label: 'Easy Sparkle',
    desc: 'Four-note clover arpeggio',
    mood: 'celebrate_easy',
    message: 'Effortless answer! Starry jump!',
  },
  {
    id: 'streak_3',
    label: '3-Card Streak',
    desc: 'Trio bounce fanfare',
    mood: 'celebrate_streak',
    message: '3 in a row! Trio celebration!',
  },
  {
    id: 'streak_5',
    label: '5-Card Streak',
    desc: 'Rising xylophone flourish',
    mood: 'celebrate_streak',
    message: '5-card streak! Meadow cheer!',
  },
  {
    id: 'deck_complete',
    label: 'Deck Mastery',
    desc: 'Victory melody + warm chord',
    mood: 'celebrate_mastery',
    message: 'All cards reviewed! Flower crown!',
  },
  {
    id: 'encourage_again',
    label: 'Gentle Encourage',
    desc: 'Soft wooden marimba bounce',
    mood: 'encourage',
    message: 'No worries! Every retry helps memory.',
  },
];

export const SoundGarden: React.FC<SoundGardenProps> = ({
  mascotId,
  onSelectMascot,
  audioSettings,
  onUpdateAudio,
}) => {
  const [previewMood, setPreviewMood] = useState<MascotMood>('idle');
  const [previewMsg, setPreviewMsg] = useState(
    'Pick your study buddy or test any milestone chime!'
  );

  const handlePreviewSound = (pad: (typeof MILESTONE_PADS)[number]) => {
    soundEngine.playMilestone(pad.id, true);
    setPreviewMood(pad.mood);
    setPreviewMsg(pad.message);
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-[#1F2A1E] text-balance">
          Sound Garden & Companions
        </h1>
        <p className="mt-1 text-sm text-[#4E5E4B]">
          Customize soothing F-pentatonic meadow music, preview milestone sound effects, and
          choose your cheering study companion.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* Left: Companion Picker + Audio Mixer */}
        <div className="space-y-6 lg:col-span-7">
          {/* Music & Volume Box */}
          <div className="rounded-3xl border border-[#E6D5DC] bg-white/95 p-6">
            <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
              Soothing Meadow Audio
            </h2>
            <p className="mt-0.5 text-xs text-[#5A6B57]">
              Loops your uploaded Chiikawa BGM track with live volume control, paired with
              synthesized milestone chimes.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={audioSettings.musicEnabled}
                onClick={() =>
                  onUpdateAudio(
                    soundEngine.updateSettings({
                      musicEnabled: !audioSettings.musicEnabled,
                    })
                  )
                }
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                  audioSettings.musicEnabled
                    ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                    : 'border-[#E6D5DC] bg-[#FFF8FA] text-[#2C3A2B] hover:bg-[#FCEFF4]'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-semibold">
                  <Music className="h-4 w-4" />
                  Meadow BGM (.mp3)
                </span>
                <span className="font-mono text-xs font-medium">
                  {audioSettings.musicEnabled ? 'Playing' : 'Paused'}
                </span>
              </button>

              <button
                type="button"
                aria-pressed={audioSettings.sfxEnabled}
                onClick={() =>
                  onUpdateAudio(
                    soundEngine.updateSettings({
                      sfxEnabled: !audioSettings.sfxEnabled,
                    })
                  )
                }
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-colors ${
                  audioSettings.sfxEnabled
                    ? 'border-[#2F855A] bg-[#ECF8F0] text-[#1D593A]'
                    : 'border-[#D8E3CE] bg-[#FAFDF7] text-[#2C3A2B] hover:bg-[#EFF5E7]'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-semibold">
                  <Volume2 className="h-4 w-4" />
                  Milestone SFX
                </span>
                <span className="font-mono text-xs font-medium">
                  {audioSettings.sfxEnabled ? 'Active' : 'Muted'}
                </span>
              </button>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-[#4E5E4B]">
                <label htmlFor="audio-volume-slider">Master Volume</label>
                <span className="font-mono tabular-nums">
                  {Math.round(audioSettings.volume * 100)}%
                </span>
              </div>
              <input
                id="audio-volume-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(audioSettings.volume * 100)}
                onChange={(e) =>
                  onUpdateAudio(
                    soundEngine.updateSettings({
                      volume: Number(e.target.value) / 100,
                    })
                  )
                }
                className="mt-2 w-full accent-[#2F855A]"
              />
            </div>
          </div>

          {/* Milestone SFX Soundboard */}
          <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6">
            <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
              Milestone Sound Effects
            </h2>
            <p className="mt-0.5 text-xs text-[#5A6B57]">
              Tap any milestone to hear its custom chime and watch the celebration animation.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {MILESTONE_PADS.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  onClick={() => handlePreviewSound(pad)}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2ECD7] bg-[#FAFDF7] px-4 py-3 text-left transition-colors hover:border-[#8DC27E] hover:bg-[#F1F8EA]"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#1F2A1E]">{pad.label}</p>
                    <p className="text-xs text-[#5A6B57]">{pad.desc}</p>
                  </div>
                  <Play className="h-4 w-4 shrink-0 text-[#2F855A]" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Companion Picker & Live Preview */}
        <div className="space-y-5 lg:col-span-5">
          <MascotStage
            mascotId={mascotId}
            mood={previewMood}
            message={previewMsg}
          />

          <div className="rounded-3xl border border-[#D8E3CE] bg-white p-6">
            <h2 className="font-display text-lg font-semibold text-[#1F2A1E]">
              Choose Study Companion
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(['mochi', 'pip', 'bramble'] as const).map((id) => {
                const profile = MASCOT_PROFILES[id];
                const selected = mascotId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onSelectMascot(id);
                      setPreviewMood('celebrate_good');
                      setPreviewMsg(`Hi! ${profile.name} is ready to study with you!`);
                      soundEngine.playMilestone('correct_good', true);
                    }}
                    className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-[#2F855A] bg-[#ECF8F0]'
                        : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                    }`}
                  >
                    <MascotAvatar variant={id} size={46} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1F2A1E]">{profile.name}</p>
                      <p className="truncate text-xs text-[#5A6B57]">{profile.role}</p>
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => {
                  onSelectMascot('trio');
                  setPreviewMood('celebrate_streak');
                  setPreviewMsg('All three meadow friends will cheer on every card!');
                  soundEngine.playMilestone('streak_3', true);
                }}
                className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                  mascotId === 'trio'
                    ? 'border-[#2F855A] bg-[#ECF8F0]'
                    : 'border-[#E2ECD7] bg-[#FAFDF7] hover:bg-[#F2F9EA]'
                }`}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E8F4DD] text-[#2F855A]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1F2A1E]">All Trio</p>
                  <p className="truncate text-xs text-[#5A6B57]">Full squad cheer</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
