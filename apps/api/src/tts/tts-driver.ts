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
  readonly voices: readonly Voice[];
  readonly defaultVoice: string;
  isConfigured(): boolean;
  speak(text: string, voice: string): Promise<SpeechResult>;
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
