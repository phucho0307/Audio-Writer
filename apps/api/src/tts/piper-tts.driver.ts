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

/** Human labels for the voices worth offering; the sidecar is the source of truth. */
const LABELS: Record<string, string> = {
  'vi_VN-vais1000-medium': 'Vais1000 · nữ, kể chuyện',
  'vi_VN-25hours_single-low': '25hours · nữ, nhẹ',
  'vi_VN-vivos-x_low': 'VIVOS · nhiều giọng',
};

interface Health {
  ok: boolean;
  available: string[];
  loaded: string[];
  default: string;
  fingerprints: Record<string, string>;
  maxConcurrency: number;
  lengthScale: number;
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
    private readonly voice: string,
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

      if (!health.available.includes(this.voice)) {
        this.logger.error(
          `voice ${this.voice} is not on the sidecar (has: ${health.available.join(', ')})`,
        );
        return;
      }
      this.health = health;
      this.logger.log(
        `piper ready at ${this.baseUrl} | voice=${this.voice} ` +
          `| model=${health.fingerprints[this.voice] ?? 'unloaded'} ` +
          `| pace=${health.lengthScale} | concurrency=${health.maxConcurrency}`,
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
    const ids = this.health?.available ?? [this.voice];
    return ids.map((id) => ({ id, label: LABELS[id] ?? id }));
  }

  get defaultVoice(): string {
    return this.voice;
  }

  /**
   * Identifies the weights rather than the filename.
   *
   * The sidecar reports a digest of the `.onnx` itself, so swapping a model in
   * place - same name, different weights - produces new audio instead of
   * silently serving the old voice from cache under the new one. A version in a
   * filename would not survive that, because nobody remembers to bump it.
   */
  get fingerprint(): string {
    const digest = this.health?.fingerprints[this.voice];
    const pace = this.health?.lengthScale;
    if (!digest || pace === undefined) {
      // Unreachable in practice: nothing hashes content while unconfigured,
      // because an unconfigured driver refuses to queue. Loud rather than
      // silently poisoning every hash with a placeholder.
      throw new TtsError('piper fingerprint requested before init()');
    }
    // Pace belongs in here with the weights. It changes the audio, so two
    // clips of the same words at different speeds are different recordings -
    // and leaving it out would mean re-tuning the pace silently served every
    // listener the old one forever, out of a cache nothing could invalidate.
    return `piper:${this.voice}:${digest}:l${pace}`;
  }

  async speak(text: string, voice: string): Promise<SpeechResult> {
    if (!this.health) throw new TtsError('piper sidecar is not available');

    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/speak?voice=${encodeURIComponent(voice)}`,
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
      provider: `piper:${this.voice}`,
    };
  }
}
