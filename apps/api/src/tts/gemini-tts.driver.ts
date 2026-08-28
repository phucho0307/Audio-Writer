import { Logger } from '@nestjs/common';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface SpeechResult {
  /** Playable WAV bytes. */
  wav: Buffer;
  durationMs: number;
  voice: string;
  provider: string;
}

/** Thrown on 429 so callers can distinguish "out of quota" from "broken". */
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

/**
 * Gemini's prebuilt voices, filtered to ones that carry Vietnamese narration
 * without sounding like an announcement. Names are the provider's.
 */
export const VOICES = [
  { id: 'Kore', label: 'Kore · nữ, trầm ấm' },
  { id: 'Aoede', label: 'Aoede · nữ, nhẹ' },
  { id: 'Charon', label: 'Charon · nam, trầm' },
  { id: 'Puck', label: 'Puck · nam, linh hoạt' },
] as const;

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

export class GeminiTtsDriver {
  readonly name = 'gemini-tts';
  private readonly logger = new Logger(GeminiTtsDriver.name);

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async speak(text: string, voice = DEFAULT_VOICE): Promise<SpeechResult> {
    const res = await fetch(`${BASE}/${this.model}:generateContent`, {
      method: 'POST',
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
