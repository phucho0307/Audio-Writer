import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const run = promisify(execFile);

export interface EncodedAudio {
  body: Buffer;
  /** File extension, without the dot. Part of the storage key. */
  ext: string;
  contentType: string;
}

/**
 * Turns the provider's raw PCM into something worth sending over a phone
 * network.
 *
 * Gemini returns 24 kHz 16-bit mono, which is 384 kbit/s - about 2.9 MB per
 * minute, so a six minute chapter is roughly 17 MB. That is ten to twenty times
 * more than speech needs, on every single play, and bandwidth is the cost that
 * grows with listeners rather than with chapters.
 *
 * AAC rather than Opus, despite Opus winning on quality per bit. Opus is
 * excellent and its container support in Safari is not, and this is a
 * mobile-heavy Vietnamese audience where an unplayable file is worse than a
 * larger one. Opus can be added later as a second rendition behind a `<source>`
 * element; the storage layer already keys by content, so both can coexist.
 */
@Injectable()
export class AudioEncoder {
  private readonly logger = new Logger(AudioEncoder.name);
  private readonly bin: string | null;
  private readonly bitrate: string;

  constructor(config: ConfigService) {
    // An explicit path wins, then the bundled binary, then whatever is on PATH.
    // The bundled one is what makes a fresh clone work with no system install.
    this.bin =
      config.get<string>('FFMPEG_PATH') || (ffmpegStatic as string | null) || null;
    this.bitrate = config.get<string>('AUDIO_BITRATE', '64k');

    if (!this.bin) {
      this.logger.warn(
        'no ffmpeg available - audio will be stored as uncompressed WAV',
      );
    }
  }

  get available(): boolean {
    return this.bin !== null;
  }

  /**
   * Encode, or pass the WAV through untouched.
   *
   * Never throws for want of an encoder: narration that ships a large file is
   * worth far more than narration that fails. A broken encode is a different
   * matter and does propagate, because silently storing the wrong bytes under a
   * content hash would poison every future lookup of that hash.
   */
  async encode(wav: Buffer): Promise<EncodedAudio> {
    if (!this.bin) {
      return { body: wav, ext: 'wav', contentType: 'audio/wav' };
    }

    // Files rather than pipes: the MP4 muxer needs to seek back to write its
    // index, and piping it means fragmented MP4, which seeks worse in a plain
    // <audio> element.
    const dir = await mkdtemp(join(tmpdir(), 'aw-tts-'));
    const src = join(dir, 'in.wav');
    const out = join(dir, 'out.m4a');

    try {
      await writeFile(src, wav);
      await run(this.bin, [
        '-y',
        '-loglevel', 'error',
        '-i', src,
        '-c:a', 'aac',
        '-b:a', this.bitrate,
        '-ac', '1',
        // Moves the index to the front so a player can start before the whole
        // file has arrived.
        '-movflags', '+faststart',
        out,
      ]);

      const body = await readFile(out);
      this.logger.log(
        `encoded ${Math.round(wav.length / 1024)} KB WAV -> ${Math.round(body.length / 1024)} KB m4a`,
      );
      return { body, ext: 'm4a', contentType: 'audio/mp4' };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
