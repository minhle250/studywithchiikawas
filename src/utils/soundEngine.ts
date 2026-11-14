import type { AudioSettings, SoundMilestone } from '../types/quiz';

export const MEADOW_BGM_PATH =
  '/assets/aistudio/______________BGM________80KDZh7avqc__d304f868.mp3';

/**
 * Hybrid audio engine:
 * - Loops the uploaded Chiikawa BGM .mp3 track via HTMLAudioElement
 * - Synthesizes instant custom chimes & fanfares for every milestone via Web Audio API
 */
class MeadowSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmAudio: HTMLAudioElement | null = null;

  private settings: AudioSettings = {
    musicEnabled: false,
    sfxEnabled: true,
    volume: 0.55,
  };

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.settings.volume;
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.72;
      this.sfxGain.connect(this.masterGain);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    return this.ctx;
  }

  private ensureBgmAudio(): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
    if (!this.bgmAudio) {
      const audio = new Audio(MEADOW_BGM_PATH);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = Math.min(1, Math.max(0, this.settings.volume * 0.65));
      this.bgmAudio = audio;
    }
    return this.bgmAudio;
  }

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<AudioSettings>): AudioSettings {
    this.settings = { ...this.settings, ...partial };
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.settings.volume, this.ctx.currentTime, 0.05);
    }
    if (this.bgmAudio) {
      this.bgmAudio.volume = Math.min(1, Math.max(0, this.settings.volume * 0.65));
    }
    if (partial.musicEnabled !== undefined) {
      if (partial.musicEnabled) {
        this.startMusic();
      } else {
        this.stopMusic();
      }
    }
    return this.getSettings();
  }

  public startMusic(): void {
    const audio = this.ensureBgmAudio();
    if (!audio) return;

    this.settings.musicEnabled = true;
    audio.volume = Math.min(1, Math.max(0, this.settings.volume * 0.65));

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Ignore browser autoplay rejection gracefully; user toggle remains interactive
      });
    }
  }

  public stopMusic(): void {
    this.settings.musicEnabled = false;
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  public playMilestone(milestone: SoundMilestone, forcePreview = false): void {
    if (!forcePreview && !this.settings.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxGain) return;

    const now = ctx.currentTime;
    const dest = this.sfxGain;

    switch (milestone) {
      case 'card_flip': {
        this.scheduleTone(523.25, now, 0.12, 'triangle', 0.14, dest);
        this.scheduleTone(659.25, now + 0.04, 0.14, 'sine', 0.12, dest);
        break;
      }
      case 'correct_good': {
        this.scheduleTone(523.25, now, 0.22, 'sine', 0.24, dest);
        this.scheduleTone(659.25, now + 0.09, 0.32, 'sine', 0.26, dest);
        this.scheduleTone(1318.5, now + 0.09, 0.2, 'triangle', 0.06, dest);
        break;
      }
      case 'correct_easy': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.07, 0.34, 'sine', 0.22, dest);
        });
        break;
      }
      case 'streak_3': {
        const notes = [587.33, 739.99, 880.0, 1174.66];
        notes.forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.08, 0.38, 'triangle', 0.2, dest);
          this.scheduleTone(n * 2, now + i * 0.08, 0.18, 'sine', 0.07, dest);
        });
        break;
      }
      case 'streak_5': {
        const notes = [523.25, 587.33, 659.25, 783.99, 1046.5];
        notes.forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.075, 0.42, 'sine', 0.24, dest);
        });
        this.scheduleTone(523.25, now + 0.32, 0.65, 'sine', 0.14, dest);
        break;
      }
      case 'streak_10': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
        notes.forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.065, 0.5, 'sine', 0.22, dest);
          this.scheduleTone(n * 0.5, now + i * 0.065, 0.4, 'triangle', 0.09, dest);
        });
        break;
      }
      case 'deck_complete': {
        const melody = [523.25, 659.25, 783.99, 659.25, 1046.5];
        melody.forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.11, 0.55, 'sine', 0.25, dest);
        });
        [261.63, 329.63, 392.0].forEach((n) => {
          this.scheduleTone(n, now + 0.44, 1.1, 'sine', 0.12, dest, 0.08);
        });
        break;
      }
      case 'encourage_again': {
        this.scheduleTone(329.63, now, 0.16, 'sine', 0.18, dest);
        this.scheduleTone(293.66, now + 0.1, 0.26, 'sine', 0.16, dest);
        break;
      }
      case 'quiz_generated': {
        [440.0, 554.37, 659.25, 880.0].forEach((n, i) => {
          this.scheduleTone(n, now + i * 0.09, 0.36, 'sine', 0.2, dest);
        });
        break;
      }
    }
  }

  private scheduleTone(
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType,
    peakGain: number,
    destination: AudioNode,
    attack = 0.015
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }
}

export const soundEngine = new MeadowSoundEngine();
