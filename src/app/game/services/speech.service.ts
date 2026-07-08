import {Injectable} from '@angular/core';

/**
 * Text-to-speech reader. Wraps the browser Web Speech API so a designated device
 * can read a tossup or bonus aloud.
 *
 * The on-screen text always reveals at a fixed rate; speech never drives the reveal
 * (per-client speech can't stay in sync across devices). Instead a single device
 * opts in to be the "reader" — a shared TV in the room or a Discord stream — and
 * that device speaks aloud for everyone. Callers decide when to speak; this service
 * just does it.
 */
@Injectable({providedIn: 'root'})
export class SpeechService {
  /** Whether the browser exposes speech synthesis at all. */
  readonly available = typeof window !== 'undefined' && 'speechSynthesis' in window;

  private voice?: SpeechSynthesisVoice;

  constructor() {
    if (this.available) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
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

  /** Whether an utterance is currently being spoken. */
  isSpeaking(): boolean {
    return this.available && window.speechSynthesis.speaking;
  }

  /**
   * Speak plain text at a rate derived from the reading-speed slider. Cancels any
   * in-flight utterance first. `onEnd` fires when speech finishes (or is skipped
   * because TTS is unavailable / the text is empty).
   */
  speak(text: string, speed: number, onEnd?: () => void): void {
    if (!this.available || !text || !text.trim()) {
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
    utterance.onend = () => onEnd?.();
    window.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if (this.available) {
      window.speechSynthesis.cancel();
    }
  }
}
