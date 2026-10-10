/**
 * Speech engine abstraction. The web app uses the browser's free
 * SpeechSynthesis voices; a future native iOS app can provide an engine backed
 * by AVSpeechSynthesizer or an offline neural model with background audio,
 * without changing the narrator or the UI.
 */
export interface VoiceInfo {
  id: string;
  name: string;
  lang: string;
  local: boolean;
  isDefault: boolean;
  quality: 'premium' | 'enhanced' | 'standard' | 'novelty';
}

export interface SpeakOptions {
  voiceId: string | null;
  rate: number;
  pitch: number;
}

export type SpeechErrorCode = 'not-allowed' | 'interrupted' | 'synthesis-failed' | 'voice-unavailable' | 'network' | 'unknown';

export interface SpeakHandlers {
  onStart(): void;
  /** charIndex is relative to the text passed to speak(). */
  onBoundary(charIndex: number): void;
  onEnd(): void;
  onError(code: SpeechErrorCode, detail?: string): void;
}

export interface SpeechEngine {
  readonly id: string;
  isSupported(): boolean;
  getVoices(): VoiceInfo[];
  onVoicesChanged(cb: () => void): () => void;
  speak(text: string, opts: SpeakOptions, handlers: SpeakHandlers): void;
  cancel(): void;
  /** True while the engine believes it is producing audio. */
  isSpeaking(): boolean;
}
