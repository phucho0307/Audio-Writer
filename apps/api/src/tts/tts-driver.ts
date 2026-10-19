/**
 * What a text-to-speech provider has to offer.
 *
 * Gemini is the only implementation today. The interface exists now rather
 * than later because the provider choice is genuinely open: the free tier
 * allows roughly twenty requests a day across the whole project, which is a
 * hard ceiling on how much narration can ever exist. The likely answer is a
 * self-hosted CPU model (Piper has Vietnamese voices and an MIT licence) for
 * bulk work, with a paid cloud voice kept for single chapters.
 *
 * Behind a queue that swap is invisible: nobody is waiting on the request, so
 * a slower local model costs no user-facing latency.
 */
export interface Voice {
  id: string;
  label: string;
  /** Which engine speaks it, so a picker can group a mixed list. */
  provider?: string;
}

export interface SpeechResult {
  /** Playable WAV bytes. */
  wav: Buffer;
  durationMs: number;
  voice: string;
  provider: string;
}

export interface TtsDriver {
  readonly name: string;
  /**
   * Identifies exactly what produced a clip, e.g. `gemini-tts:gemini-2.5-flash-preview-tts`.
   *
   * Part of the content hash, so changing model or provider yields new audio
   * rather than silently reusing the old voice under a new one.
   */
  readonly fingerprint: string;
  /**
   * The fingerprint for one voice, when a driver's voices do not all come from
   * the same weights.
   *
   * A driver with one model per voice (Piper) or several engines behind it (the
   * composite) cannot answer with a single string without making every voice's
   * cache depend on every other voice's model. Falls back to `fingerprint`.
   */
  fingerprintFor?(voice: string): string;
  /**
   * Rough wall-clock time to synthesise this text, for a progress bar.
   *
   * An estimate, not a promise: it shapes how fast the bar moves, and the bar
   * never reaches the end on the estimate alone.
   */
  estimateMs?(text: string, voice: string): number;
  readonly voices: readonly Voice[];
  readonly defaultVoice: string;
  isConfigured(): boolean;
  speak(text: string, voice: string): Promise<SpeechResult>;
  /**
   * Discover whatever the driver cannot know without asking, once, at boot.
   *
   * Optional because a driver holding an API key knows everything about itself
   * synchronously. A self-hosted one does not: the model it will actually use
   * lives in another process, and `fingerprint` has to answer before any audio
   * is requested because it is read while computing a content hash. Resolving
   * that lazily would hash the first clips of a deploy differently from every
   * clip after them, quietly splitting one voice's cache in two.
   *
   * A driver that fails here must report `isConfigured()` false rather than
   * throw: an unreachable synthesiser should disable narration, not the app.
   */
  init?(): Promise<void>;
}

/**
 * Thrown on 429 so callers can distinguish "out of quota" from "broken".
 *
 * The worker treats this differently from every other failure: it pauses the
 * whole pool for `retryAfterMs` and puts the job back without spending an
 * attempt. A rate limit means "not yet", not "this job is bad", and counting
 * it as a failed attempt would burn the retry budget on a queue that only
 * needed to wait.
 */
export class TtsRateLimitedError extends Error {
  constructor(public readonly retryAfterMs?: number) {
    super('TTS provider is rate limited');
    this.name = 'TtsRateLimitedError';
  }
}

export class TtsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'TtsError';
  }
}
