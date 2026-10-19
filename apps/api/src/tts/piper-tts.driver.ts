import { Logger } from '@nestjs/common';
import {
  TtsError,
  TtsRateLimitedError,
  type SpeechResult,
  type TtsDriver,
  type Voice,
} from './tts-driver';

/**
 * Self-hosted Piper, reached over HTTP.
 *
 * The process on the other end holds the voice in memory, which is the entire
 * reason it is a server rather than a subprocess: loading the model costs five
 * to seven seconds and synthesising the first sentence costs 0.11, so a process
 * per job would spend ~98% of its latency budget loading a file it is about to
 * discard. Measured through this driver, first sound arrives in under a second
 * against the cloud provider's 29-195.
 *
 * See `tools/piper/sidecar.py` and `docs/piper-hls-stage.md`.
 */

/**
 * What is offered, as model x speaker x pace.
 *
 * Pace is part of the voice rather than a setting beside it. It changes the
 * audio, and the row-level cache is keyed on (chapter, voice) - so a pace that
 * lived anywhere else would keep serving the old speed out of that cache after
 * it was changed. As part of the id, a different pace is simply a different
 * recording.
 *
 * Measured on vais1000: pace 1.0 reads at ~276 words/min, 1.5 at ~220, 2.0 at
 * ~180. Audiobooks sit near 160. The spread is here to be listened to, not
 * because all of it is expected to survive.
 */
const PRESETS: {
  model: string;
  name: string;
  speaker?: number;
  pace: number;
}[] = [
  { model: 'vi_VN-vais1000-medium', name: 'Vais1000', pace: 1.0 },
  { model: 'vi_VN-vais1000-medium', name: 'Vais1000', pace: 1.5 },
  { model: 'vi_VN-vais1000-medium', name: 'Vais1000', pace: 2.0 },
  { model: 'vi_VN-25hours_single-low', name: '25hours', pace: 1.0 },
  { model: 'vi_VN-25hours_single-low', name: '25hours', pace: 1.5 },
  { model: 'vi_VN-25hours_single-low', name: '25hours', pace: 2.0 },
  // VIVOS is 65 people reading for speech recognition. Three spread across the
  // set, since there is no metadata saying which of them sound like a narrator.
  { model: 'vi_VN-vivos-x_low', name: 'VIVOS 1', speaker: 0, pace: 1.3 },
  { model: 'vi_VN-vivos-x_low', name: 'VIVOS 2', speaker: 20, pace: 1.3 },
  { model: 'vi_VN-vivos-x_low', name: 'VIVOS 3', speaker: 40, pace: 1.3 },
];

const PACE_LABEL: Record<string, string> = {
  '1': 'tự nhiên',
  '1.3': 'vừa',
  '1.5': 'chậm vừa',
  '2': 'chậm',
};

/** `piper:<model>[#speaker]@<pace>` - everything the sidecar needs, in the id. */
function voiceId(p: { model: string; speaker?: number; pace: number }): string {
  const speaker = p.speaker === undefined ? '' : `#${p.speaker}`;
  return `piper:${p.model}${speaker}@${p.pace}`;
}

function parseVoice(
  id: string,
): { model: string; speaker: number; pace: number } | null {
  const m = /^piper:([^#@]+)(?:#(\d+))?@([\d.]+)$/.exec(id);
  if (!m) return null;
  return { model: m[1], speaker: Number(m[2] ?? 0), pace: Number(m[3]) };
}

interface Health {
  ok: boolean;
  available: string[];
  loaded: string[];
  default: string;
  fingerprints: Record<string, string>;
  maxConcurrency: number;
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class PiperTtsDriver implements TtsDriver {
  readonly name = 'piper';
  private readonly logger = new Logger(PiperTtsDriver.name);
  private health: Health | null = null;
  private warned = false;

  constructor(
    private readonly baseUrl: string,
    /** The model the default voice uses. */
    private readonly model: string,
    private readonly defaultPace: number,
    private readonly timeoutMs = 300_000,
  ) {}

  /**
   * Ask the sidecar what it is running, once, at boot.
   *
   * This exists because `fingerprint` has to be synchronous - it is read while
   * computing a content hash, before any audio is requested - but the thing it
   * identifies lives in another process. Discovering it lazily would mean the
   * first few clips of a deploy hash under a different fingerprint than every
   * clip after them, which silently splits one voice's cache in two.
   *
   * So the driver reports itself unconfigured until this succeeds, and an
   * unconfigured driver queues nothing.
   */
  async init(): Promise<void> {
    await this.probe();
    if (this.health) return;

    // Keep trying, quietly, forever.
    //
    // The sidecar spends five to seven seconds loading the model before it
    // binds, so an API that boots alongside it loses the race about as often as
    // it wins - and a single failed check at boot would leave narration dead
    // until somebody restarted the API, for a dependency that came up two
    // seconds later. The same loop covers a sidecar that is restarted or
    // redeployed underneath a running API.
    //
    // Unref'd so it never holds the process open, and it stops on first success.
    const timer = setInterval(() => {
      void this.probe().then(() => {
        if (this.health) clearInterval(timer);
      });
    }, 15_000);
    timer.unref();
  }

  private async probe(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`health returned ${res.status}`);
      const health = (await res.json()) as Health;

      if (!health.available.includes(this.model)) {
        this.logger.error(
          `model ${this.model} is not on the sidecar (has: ${health.available.join(', ')})`,
        );
        return;
      }
      this.health = health;
      this.logger.log(
        `piper ready at ${this.baseUrl} | ${this.voices.length} voices from ` +
          `${health.available.length} models | concurrency=${health.maxConcurrency}`,
      );
    } catch (err) {
      // Not fatal, and not shouted about on every retry. The driver stays
      // unconfigured, narration reports itself unavailable, and the rest of the
      // app serves stories as normal - the same thing that happens when a cloud
      // key is missing.
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `piper sidecar not reachable at ${this.baseUrl} (${(err as Error).message}); retrying every 15s`,
        );
      }
    }
  }

  isConfigured(): boolean {
    return this.health !== null;
  }

  get voices(): readonly Voice[] {
    const have = new Set(this.health?.available ?? []);
    return PRESETS.filter((p) => have.has(p.model)).map((p) => ({
      id: voiceId(p),
      label: `${p.name} · ${PACE_LABEL[String(p.pace)] ?? `×${p.pace}`}`,
      provider: 'piper',
    }));
  }

  get defaultVoice(): string {
    return voiceId({ model: this.model, pace: this.defaultPace });
  }

  /**
   * Identifies the weights rather than the filename.
   *
   * The sidecar reports a digest of each `.onnx`, so swapping a model in place -
   * same name, different weights - produces new audio instead of silently
   * serving the old voice from cache. Pace and speaker are not in here because
   * they are already in the voice id, which the content hash also covers.
   */
  get fingerprint(): string {
    return this.fingerprintFor(this.defaultVoice);
  }

  fingerprintFor(voice: string): string {
    const parsed = parseVoice(voice);
    const digest = parsed && this.health?.fingerprints[parsed.model];
    if (!digest) {
      // Unreachable in practice: nothing hashes content for a voice that is not
      // offered, and nothing is offered before init(). Loud rather than
      // poisoning a hash with a placeholder.
      throw new TtsError(`no piper fingerprint for voice ${voice}`);
    }
    return `piper:${digest}`;
  }

  /**
   * Seconds of speech, divided by how much faster than realtime the box runs.
   *
   * ~276 words/min at pace 1.0, stretched sub-linearly by pace (the silences
   * between words do not stretch). The divisor is 5 rather than the 10x measured
   * alone because the worker runs jobs side by side, plus a few seconds of AAC
   * encoding at the end.
   */
  estimateMs(text: string, voice: string): number {
    const pace = parseVoice(voice)?.pace ?? 1;
    const words = text.split(/\s+/).filter(Boolean).length;
    const speechSec = (words / 276) * 60 * (1 + 0.55 * (pace - 1));
    return Math.round((speechSec / 5 + 3) * 1000);
  }

  async speak(text: string, voice: string): Promise<SpeechResult> {
    if (!this.health) throw new TtsError('piper sidecar is not available');
    const parsed = parseVoice(voice);
    if (!parsed) throw new TtsError(`not a piper voice: ${voice}`);

    const query = new URLSearchParams({
      voice: parsed.model,
      length: String(parsed.pace),
      speaker: String(parsed.speaker),
    });

    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/speak?${query.toString()}`,
        {
          method: 'POST',
          // Explicit UTF-8. Vietnamese that crosses this boundary as anything
          // else arrives as lone surrogates and dies inside the phonemizer, and
          // it presents as a broken voice rather than as a broken pipe.
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body: Buffer.from(text, 'utf-8'),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (err) {
      throw new TtsError(`piper unreachable: ${(err as Error).message}`);
    }

    // The sidecar returns 503 when every synthesis slot is busy. That is the
    // same shape as the cloud provider's 429 and gets the same treatment: the
    // worker pauses the pool and requeues without spending an attempt, because
    // "everyone is busy" is not a reason to believe the job is bad.
    if (res.status === 503) {
      const retryAfter = Number(res.headers.get('retry-after') ?? '5');
      throw new TtsRateLimitedError(retryAfter * 1000);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new TtsError(
        `piper returned ${res.status}: ${detail.slice(0, 200)}`,
        res.status,
      );
    }

    const sampleRate = Number(res.headers.get('x-sample-rate') ?? '22050');
    const channels = Number(res.headers.get('x-channels') ?? '1');
    const pcm = Buffer.from(await res.arrayBuffer());

    if (pcm.length === 0) {
      // A truncated chunked response arrives here as a clean empty body. Storing
      // it would cache silence forever under this chapter's content hash.
      throw new TtsError('piper returned no audio');
    }

    return {
      wav: pcmToWav(pcm, sampleRate, channels),
      durationMs: Math.round((pcm.length / 2 / channels / sampleRate) * 1000),
      voice,
      provider: `piper:${parsed.model}`,
    };
  }
}
