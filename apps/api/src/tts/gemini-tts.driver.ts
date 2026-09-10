import { Logger } from '@nestjs/common';
import {
  TtsError,
  TtsRateLimitedError,
  type SpeechResult,
  type TtsDriver,
  type Voice,
} from './tts-driver';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Re-exported so the rest of the module keeps importing errors from wherever
// it already did. The definitions live with the interface, because the worker
// catches TtsRateLimitedError without knowing which driver produced it.
export { TtsError, TtsRateLimitedError };
export type { SpeechResult };

/**
 * Gemini's prebuilt voices, filtered to ones that carry Vietnamese narration
 * without sounding like an announcement. Names are the provider's.
 */
export const VOICES: readonly Voice[] = [
  { id: 'Kore', label: 'Kore · nữ, trầm ấm' },
  { id: 'Aoede', label: 'Aoede · nữ, nhẹ' },
  { id: 'Charon', label: 'Charon · nam, trầm' },
  { id: 'Puck', label: 'Puck · nam, linh hoạt' },
];

export const DEFAULT_VOICE = 'Kore';

/**
 * Wraps raw PCM in a WAV container.
 *
 * The API returns `audio/L16` - headerless 16-bit little-endian samples, which
 * no browser will play. A 44-byte RIFF header is the whole difference between
 * unusable bytes and an <audio> element that works, so it is done here rather
 * than pulling in ffmpeg for a header.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** The rate is announced in the mime type and has differed between models. */
function parseRate(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? '');
  return m ? Number(m[1]) : 24000;
}

export class GeminiTtsDriver implements TtsDriver {
  readonly name = 'gemini-tts';
  readonly voices = VOICES;
  readonly defaultVoice = DEFAULT_VOICE;

  get fingerprint(): string {
    return `${this.name}:${this.model}`;
  }

  private readonly logger = new Logger(GeminiTtsDriver.name);

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 300_000,
  ) {}

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async speak(text: string, voice = DEFAULT_VOICE): Promise<SpeechResult> {
    const res = await fetch(`${BASE}/${this.model}:generateContent`, {
      method: 'POST',
      // Without this a hung provider holds a worker slot for ever: the job
      // never fails, so it never retries, and the reader polls a status that
      // will not change.
      //
      // Generous on purpose. Two minutes was inherited from when a reader sat
      // on the open request, and it aborted chapters that were slow rather
      // than stuck - a six minute narration has been observed taking anywhere
      // from 29 seconds to over two minutes depending on the provider's mood.
      // Nobody is waiting now, so the cost of being patient is nothing, while
      // the cost of being impatient is a wasted attempt and a re-billed
      // synthesis. This is a deadman switch, not a latency budget.
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        // Steering the delivery matters more than the voice choice: without it
        // the model reads fiction like a news bulletin.
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Đọc đoạn truyện sau bằng giọng kể chuyện tự nhiên, chậm rãi, có cảm xúc. Ngắt nghỉ đúng chỗ. Không đọc thêm bất kỳ lời dẫn nào:\n\n${text}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429) {
        const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(detail);
        throw new TtsRateLimitedError(
          m ? Math.ceil(Number(m[1]) * 1000) : undefined,
        );
      }
      throw new TtsError(detail.slice(0, 300) || res.statusText, res.status);
    }

    const body = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
        };
      }>;
    };

    const part = body.candidates?.[0]?.content?.parts?.find(
      (p) => p.inlineData?.data,
    );
    if (!part?.inlineData?.data) {
      throw new TtsError('no audio in response');
    }

    const pcm = Buffer.from(part.inlineData.data, 'base64');
    const rate = parseRate(part.inlineData.mimeType);
    const durationMs = Math.round((pcm.length / 2 / rate) * 1000);

    this.logger.log(
      `spoke ${text.length} chars -> ${Math.round(durationMs / 1000)}s (${voice})`,
    );

    return {
      wav: pcmToWav(pcm, rate),
      durationMs,
      voice,
      provider: this.name,
    };
  }
}
