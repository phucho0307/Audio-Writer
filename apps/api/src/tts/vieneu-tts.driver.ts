import { Logger } from '@nestjs/common';
import { TtsError, type SpeechResult, type TtsDriver, type Voice } from './tts-driver';

/**
 * VieNeu-TTS v3 Turbo, self-hosted, reached over HTTP (`tools/vieneu/sidecar.py`).
 *
 * Added for Northern women's voices: Edge has exactly one Vietnamese woman.
 * VieNeu's preset voices were recorded with consent and are Apache 2.0, so
 * they can stay if the site ever charges. They run on CPU at about 1.3x
 * realtime on the dev laptop - a long chapter takes minutes, against Edge's
 * one or two - which the player hides by narrating the next chapter while the
 * current one plays.
 *
 * Two things learned the hard way shape the protocol:
 * - A chapter goes over in pieces of a paragraph or so, and the PCM is joined
 *   here. Sent whole, a long chapter took the sidecar's only synthesis slot
 *   for eight minutes, and a reader's short chapter waited behind somebody's
 *   read-ahead. In pieces, chapters take turns a piece at a time.
 * - Each piece is submitted and then polled, never held open on one request,
 *   so no connection (or proxy in front of one) waits minutes for an answer.
 * - The sidecar is served by uvicorn. Its first version used Python's
 *   http.server, and fetch kept losing its responses part way (ECONNRESET,
 *   "terminated", "other side closed"). The protocol still assumes a response
 *   can be lost: a result is kept on the sidecar until it is collected in full
 *   and DELETEd, a broken download is fetched again, and a failed submit is
 *   retried.
 */

/** Ids are ASCII; the sidecar knows the voices by their Vietnamese names. */
const VOICES: (Voice & { name: string })[] = [
  { id: 'vieneu:truc-ly', name: 'Trúc Ly', label: 'Trúc Ly · nữ Bắc' },
  { id: 'vieneu:ngoc-huyen', name: 'Ngọc Huyền', label: 'Ngọc Huyền · nữ Bắc' },
];

/** About half a minute of synthesis each on the dev laptop. */
const PIECE_CHARS = 1_200;
/** Between pieces, which always end at a paragraph or a sentence. */
const GAP_SECONDS = 0.35;
const POLL_MS = 1_000;

/** Paragraphs packed up to `max`; a longer paragraph by sentence. */
export function vieneuPieces(text: string, max = PIECE_CHARS): string[] {
  const units: string[] = [];
  for (const raw of text.split(/\n\s*\n|\n/)) {
    const para = raw.trim();
    if (!para) continue;
    if (para.length <= max) units.push(para);
    else {
      for (const s of para.split(/(?<=[.!?…])\s+/)) {
        for (let i = 0; i < s.length; i += max) if (s.slice(i, i + max).trim()) units.push(s.slice(i, i + max));
      }
    }
  }
  const out: string[] = [];
  for (const u of units) {
    if (out.length && out[out.length - 1].length + 1 + u.length <= max) out[out.length - 1] += '\n' + u;
    else out.push(u);
  }
  return out;
}

interface Health {
  ok: boolean;
  voices: string[];
  fingerprint: string;
  sampleRate: number;
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VieneuTtsDriver implements TtsDriver {
  readonly name = 'vieneu';
  readonly defaultVoice = VOICES[0].id;
  private readonly logger = new Logger(VieneuTtsDriver.name);
  private health: Health | null = null;
  private warned = false;

  constructor(
    private readonly baseUrl: string,
    /** One piece, from submitting it to its audio, queue included. */
    private readonly timeoutMs = 30 * 60_000,
  ) {}

  /**
   * Keep checking, for the life of the API, not just until the first answer.
   *
   * The sidecar holds several GB of RAM and is stopped when the machine needs
   * it back. While it is down its voices leave the picker and Edge becomes the
   * default, instead of readers picking a voice that can only fail; when it
   * comes back, so do they.
   */
  async init(): Promise<void> {
    await this.probe();
    setInterval(() => void this.probe(), 15_000).unref();
  }

  private async probe(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`health returned ${res.status}`);
      const health = (await res.json()) as Health;
      const missing = VOICES.filter((v) => !health.voices.includes(v.name));
      if (missing.length) {
        if (this.health) this.logger.error(`sidecar lacks voices: ${missing.map((v) => v.name).join(', ')}`);
        this.health = null;
        return;
      }
      if (!this.health) this.logger.log(`vieneu ready at ${this.baseUrl} (${health.fingerprint})`);
      this.health = health;
      this.warned = false;
    } catch (err) {
      if (this.health) this.logger.warn(`vieneu sidecar went away (${(err as Error).message}); its voices are hidden until it is back`);
      else if (!this.warned) {
        this.logger.warn(
          `vieneu sidecar not reachable at ${this.baseUrl} (${(err as Error).message}); checking every 15s`,
        );
      }
      this.warned = true;
      this.health = null;
    }
  }

  isConfigured(): boolean {
    return this.health !== null;
  }

  get voices(): readonly Voice[] {
    return VOICES.map(({ id, label }) => ({ id, label, provider: 'vieneu' }));
  }

  get fingerprint(): string {
    if (!this.health) throw new TtsError('vieneu sidecar is not available');
    return this.health.fingerprint;
  }

  /** About 19 characters per second of speech, made at ~1.3x realtime. */
  estimateMs(text: string): number {
    return Math.round(5_000 + text.length * 42);
  }

  async speak(text: string, voice: string): Promise<SpeechResult> {
    if (!this.health) throw new TtsError('vieneu sidecar is not available');
    const v = VOICES.find((x) => x.id === voice);
    if (!v) throw new TtsError(`not a vieneu voice: ${voice}`);

    const pieces = vieneuPieces(text);
    if (!pieces.length) throw new TtsError('nothing to speak');
    const pcm: Buffer[] = [];
    let sampleRate = this.health.sampleRate;
    for (const piece of pieces) {
      const got = await this.piece(piece, v.name);
      sampleRate = got.sampleRate;
      if (pcm.length) pcm.push(Buffer.alloc(Math.round(GAP_SECONDS * sampleRate) * 2));
      pcm.push(got.pcm);
    }

    const all = Buffer.concat(pcm);
    return {
      wav: pcmToWav(all, sampleRate),
      durationMs: Math.round((all.length / 2 / sampleRate) * 1000),
      voice,
      provider: this.name,
    };
  }

  /** Submit one piece, then ask for it until it is ready. A sidecar restart in between loses the job, so it is resubmitted, once. */
  private async piece(text: string, name: string): Promise<{ pcm: Buffer; sampleRate: number }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = await this.submit(text, name);
      const deadline = Date.now() + this.timeoutMs;
      let misses = 0;
      let broken = 0;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        let res: Response;
        try {
          res = await fetch(`${this.baseUrl}/jobs/${id}`, { signal: AbortSignal.timeout(60_000) });
        } catch (err) {
          // A dropped poll costs nothing: the job is still on the sidecar.
          if (++misses > 30) throw new TtsError(`vieneu unreachable: ${(err as Error).message}`);
          continue;
        }
        misses = 0;
        if (res.status === 202) {
          await res.body?.cancel();
          continue;
        }
        if (res.status === 404) break; // forgotten: the sidecar restarted
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          void this.forget(id);
          throw new TtsError(`vieneu failed: ${detail.slice(0, 200)}`, res.status);
        }
        const expected = Number(res.headers.get('content-length') ?? -1);
        let pcm: Buffer;
        try {
          pcm = Buffer.from(await res.arrayBuffer());
        } catch (err) {
          // Cut off part way ("other side closed"). The sidecar keeps the
          // result until told otherwise, so just fetch it again.
          if (++broken > 5) throw new TtsError(`vieneu download kept failing: ${(err as Error).message}`);
          continue;
        }
        if (pcm.length === 0) throw new TtsError('vieneu returned no audio');
        if (expected >= 0 && pcm.length !== expected) {
          if (++broken > 5) throw new TtsError('vieneu download kept coming back short');
          continue;
        }
        void this.forget(id);
        return { pcm, sampleRate: Number(res.headers.get('x-sample-rate') ?? this.health?.sampleRate ?? 24_000) };
      }
      if (Date.now() >= deadline) throw new TtsError('vieneu did not finish in time');
    }
    throw new TtsError('vieneu lost the job twice');
  }

  /** Tell the sidecar the audio has arrived. If this is lost, it expires on its own. */
  private async forget(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/jobs/${id}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
      .then((r) => r.body?.cancel())
      .catch(() => undefined);
  }

  private async submit(text: string, name: string): Promise<string> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.submitOnce(text, name);
      } catch (err) {
        last = err;
        await sleep(1_000);
      }
    }
    throw last;
  }

  private async submitOnce(text: string, name: string): Promise<string> {
    const url = new URL(`${this.baseUrl}/jobs`);
    url.searchParams.set('voice', name);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: Buffer.from(text, 'utf-8'),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new TtsError(`vieneu unreachable: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (res.status !== 202 || !body?.id) {
      throw new TtsError(`vieneu refused: ${body?.error ?? res.status}`, res.status);
    }
    return body.id;
  }
}
