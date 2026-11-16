import { Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  TtsError,
  type SpeechResult,
  type TtsDriver,
  type Voice,
} from './tts-driver';

/**
 * Microsoft Edge's read-aloud voices: free, no key, and the two Vietnamese
 * neural voices are good enough for fiction.
 *
 * Spoken through the `edge-tts` Python package rather than reimplemented here:
 * the service is unofficial and Microsoft changes its handshake from time to
 * time, and that package is where the fixes land. Upgrading it with pip is the
 * whole repair.
 *
 * The service hands back MP3. The pipeline expects WAV (it encodes to AAC
 * itself and measures duration from samples), so ffmpeg decodes it here.
 *
 * Unofficial means unsupported: no SLA, and nothing stops Microsoft from
 * shutting it off. Azure Speech sells the same voices with a free tier and is
 * the drop-in if that day comes.
 */

const SCRIPT = join(__dirname, '../../scripts/edge_speak.py');
const RATE = 24_000;

/** Id prefix keeps these apart from other engines' voices in the picker. */
const VOICES: (Voice & { name: string; rate: string })[] = [
  { id: 'edge:vi-VN-HoaiMyNeural', name: 'vi-VN-HoaiMyNeural', rate: '+0%', label: 'Hoài My · nữ' },
  { id: 'edge:vi-VN-NamMinhNeural', name: 'vi-VN-NamMinhNeural', rate: '+0%', label: 'Nam Minh · nam' },
  { id: 'edge:vi-VN-HoaiMyNeural@-15', name: 'vi-VN-HoaiMyNeural', rate: '-15%', label: 'Hoài My · nữ, chậm' },
  { id: 'edge:vi-VN-NamMinhNeural@-15', name: 'vi-VN-NamMinhNeural', rate: '-15%', label: 'Nam Minh · nam, chậm' },
];

function run(
  cmd: string,
  args: string[],
  input: Buffer | null,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      // UTF-8 both ways, whatever the console code page is.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new TtsError(`${cmd} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new TtsError(`${cmd} could not start: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out));
      const tail = Buffer.concat(err).toString('utf8').trim().split('\n').slice(-2).join(' ');
      reject(new TtsError(`${cmd} exited ${code}: ${tail.slice(0, 300)}`));
    });
    // A child that exits before reading all its input (ffmpeg failing, the
    // timeout kill) makes the pipe throw EPIPE/EOF. Unhandled, that error
    // takes down the whole API; the 'close' handler already reports the
    // failure, so here it only needs swallowing.
    child.stdin.on('error', () => undefined);
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
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

export class EdgeTtsDriver implements TtsDriver {
  readonly name = 'edge-tts';
  readonly voices: readonly Voice[] = VOICES.map(({ id, label }) => ({ id, label }));
  readonly defaultVoice = VOICES[0].id;
  readonly fingerprint = 'edge-tts:v1';

  private readonly logger = new Logger(EdgeTtsDriver.name);
  private ready = false;

  constructor(
    private readonly python: string,
    private readonly ffmpeg: string | null,
    private readonly timeoutMs = 300_000,
  ) {}

  /** Usable only if Python, the package and ffmpeg are all there. */
  async init(): Promise<void> {
    if (!this.ffmpeg) {
      this.logger.warn('edge-tts disabled: no ffmpeg to decode its MP3');
      return;
    }
    try {
      const v = await run(this.python, [SCRIPT, '--check'], null, 20_000);
      this.ready = true;
      this.logger.log(`edge-tts ready (package ${v.toString().trim()}, ${this.python})`);
    } catch (e) {
      this.logger.warn(
        `edge-tts disabled: ${(e as Error).message}. Install with: ${this.python} -m pip install edge-tts truststore`,
      );
    }
  }

  isConfigured(): boolean {
    return this.ready;
  }

  /** A 3,800-character chapter took about 50 s with four pieces in flight. */
  estimateMs(text: string): number {
    return Math.round(5_000 + text.length * 12);
  }

  async speak(text: string, voice: string): Promise<SpeechResult> {
    const v = VOICES.find((x) => x.id === voice);
    if (!v) throw new TtsError(`not an edge voice: ${voice}`);
    if (!this.ffmpeg) throw new TtsError('no ffmpeg available');

    const started = Date.now();
    const mp3 = await run(
      this.python,
      [SCRIPT, v.name, v.rate],
      Buffer.from(text, 'utf-8'),
      this.timeoutMs,
    );
    const pcm = await run(
      this.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), 'pipe:1'],
      mp3,
      120_000,
    );
    if (pcm.length === 0) throw new TtsError('edge-tts returned no audio');

    const durationMs = Math.round((pcm.length / 2 / RATE) * 1000);
    this.logger.log(
      `spoke ${text.length} chars -> ${Math.round(durationMs / 1000)}s (${voice}) in ${Date.now() - started} ms`,
    );
    return { wav: pcmToWav(pcm, RATE), durationMs, voice, provider: this.name };
  }
}
