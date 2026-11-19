import {
  TtsError,
  type SpeechResult,
  type TtsDriver,
  type Voice,
} from './tts-driver';

/**
 * Several engines behind one driver, routed by voice.
 *
 * Exists so voices can be compared side by side in the reader instead of by
 * editing an env var and restarting - which is how a self-hosted voice got
 * judged against the cloud one without anyone being able to hear both.
 *
 * Voice ids already say which engine they belong to (`Kore` is Gemini,
 * `piper:...` is Piper), so routing is a lookup, and nothing stored under an
 * existing id changes meaning.
 *
 * Order matters: the first configured driver supplies the default voice, so
 * `TTS_DRIVER=gemini,piper` keeps everything that does not choose - pre-render
 * on publish, a reader who never opens the picker - on Gemini.
 */
export class MultiTtsDriver implements TtsDriver {
  readonly name = 'multi';

  constructor(private readonly drivers: TtsDriver[]) {}

  async init(): Promise<void> {
    await Promise.all(this.drivers.map((d) => d.init?.()));
  }

  private configured(): TtsDriver[] {
    return this.drivers.filter((d) => d.isConfigured());
  }

  isConfigured(): boolean {
    return this.configured().length > 0;
  }

  get voices(): readonly Voice[] {
    return this.configured().flatMap((d) =>
      d.voices.map((v) => ({ ...v, provider: v.provider ?? d.name })),
    );
  }

  /**
   * VieNeu's Trúc Ly whenever its sidecar is up, whatever order TTS_DRIVER
   * lists the engines in: it is the house voice. Otherwise the first engine
   * that is reachable, so a reader is never handed a voice that can only fail.
   */
  get defaultVoice(): string {
    const live = this.configured();
    return (live.find((d) => d.name === 'vieneu') ?? live[0] ?? this.drivers[0]).defaultVoice;
  }

  /** The driver that offers this voice, among those currently reachable. */
  private owner(voice: string): TtsDriver {
    const driver = this.configured().find((d) =>
      d.voices.some((v) => v.id === voice),
    );
    if (!driver) throw new TtsError(`no configured driver offers voice ${voice}`);
    return driver;
  }

  get fingerprint(): string {
    return this.fingerprintFor(this.defaultVoice);
  }

  // Delegated per voice, so each engine's cache depends only on its own model.
  // A Gemini clip hashes exactly as it did before this driver existed.
  fingerprintFor(voice: string): string {
    const d = this.owner(voice);
    return d.fingerprintFor?.(voice) ?? d.fingerprint;
  }

  estimateMs(text: string, voice: string): number {
    const d = this.owner(voice);
    return d.estimateMs?.(text, voice) ?? 45_000;
  }

  speak(text: string, voice: string): Promise<SpeechResult> {
    return this.owner(voice).speak(text, voice);
  }
}
