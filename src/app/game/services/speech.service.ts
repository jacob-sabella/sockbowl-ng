import {Injectable} from '@angular/core';

/**
 * Text-to-speech proctor. Wraps the browser Web Speech API so the proctorless
 * reader surfaces (solo, auto-judged) can read a tossup or bonus aloud while the
 * text reveals on screen. No backend, no key — the voice runs in the browser.
 *
 * The on/off preference is persisted; speaking rate is derived from each
 * surface's existing 1..10 reading-speed slider so audio tracks the visual read.
 */
@Injectable({providedIn: 'root'})
export class SpeechService {
  private static readonly ENABLED_KEY = 'tts_enabled';

  /** Whether the browser exposes speech synthesis at all. */
  readonly available = typeof window !== 'undefined' && 'speechSynthesis' in window;

  private _enabled = false;
  private voice?: SpeechSynthesisVoice;

  constructor() {
    const saved = this.available ? localStorage.getItem(SpeechService.ENABLED_KEY) : null;
    // Default on when supported (this IS the proctor for these modes), unless muted before.
    this._enabled = this.available && (saved === null ? true : saved === 'true');
    if (this.available) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(value: boolean): void {
    this._enabled = value && this.available;
    if (this.available) {
      localStorage.setItem(SpeechService.ENABLED_KEY, String(this._enabled));
    }
    if (!this._enabled) {
      this.cancel();
    }
  }

  toggle(): void {
    this.setEnabled(!this._enabled);
  }

  private loadVoices(): void {
    const voices = window.speechSynthesis.getVoices();
    this.voice =
      voices.find(v => /^en/i.test(v.lang) && v.default) ||
      voices.find(v => /^en[-_]US/i.test(v.lang)) ||
      voices.find(v => /^en/i.test(v.lang)) ||
      voices[0];
  }

  /** Map the shared 1..10 reading-speed slider to a natural utterance rate. */
  private rateFor(speed: number): number {
    return Math.max(0.6, Math.min(2, 0.6 + (speed - 1) * 0.14));
  }

  /**
   * Speak plain text at a rate derived from the reading-speed slider. Cancels any
   * in-flight utterance first. `onEnd` fires when speech finishes (or is skipped
   * because TTS is off/unavailable), so callers can chain reads.
   */
  speak(text: string, speed: number, onEnd?: () => void): void {
    if (!this.available || !this._enabled || !text || !text.trim()) {
      onEnd?.();
      return;
    }
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = this.rateFor(speed);
    utterance.lang = 'en-US';
    if (this.voice) {
      utterance.voice = this.voice;
    }
    if (onEnd) {
      utterance.onend = () => onEnd();
    }
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.available) {
      window.speechSynthesis.cancel();
    }
  }
}
