import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Retrieval is asymmetric: a question and the passage that answers it are not
 * the same kind of text, and the model is told which it is looking at. Getting
 * this backwards is a quiet quality loss rather than an error.
 */
export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Fixed in the column type, so changing it means a migration and a reindex. */
export const EMBED_DIMENSIONS = 768;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly key: string;
  readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.key = this.config.get<string>('GEMINI_API_KEY', '');
    // embedding-2: newer, and its free quota is separate from 001's, which
    // the retired chapter index used to spend.
    this.model = this.config.get<string>('EMBED_MODEL', 'gemini-embedding-2');
  }

  get available(): boolean {
    return this.key.length > 0;
  }

  /** The name stored beside each vector, so stale rows are identifiable. */
  get fingerprint(): string {
    return `${this.model}@${EMBED_DIMENSIONS}`;
  }

  async embedOne(text: string, task: EmbedTask): Promise<number[]> {
    const [v] = await this.embed([text], task);
    return v;
  }

  /**
   * Embed a batch.
   *
   * Batched because the index is built a few hundred passages at a time and one
   * request per passage would spend the whole run on round trips. Chunked at
   * 100, which is the API's limit per call.
   */
  async embed(texts: string[], task: EmbedTask): Promise<number[][]> {
    if (!this.available) throw new Error('GEMINI_API_KEY is not set');
    if (texts.length === 0) return [];

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      out.push(...(await this.call(batch, task)));
    }
    return out;
  }

  private async call(texts: string[], task: EmbedTask): Promise<number[][]> {
    const body = {
      requests: texts.map((text) => ({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        taskType: task,
        outputDimensionality: EMBED_DIMENSIONS,
      })),
    };

    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(
        `${BASE}/${this.model}:batchEmbedContents?key=${this.key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        },
      );

      if (res.ok) {
        const json = (await res.json()) as {
          embeddings: { values: number[] }[];
        };
        return json.embeddings.map((e) => normalise(e.values));
      }

      lastError = `${res.status} ${(await res.text()).slice(0, 180)}`;
      // 429 and 5xx are worth waiting out; a 400 will fail the same way forever.
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }

    throw new Error(`embedding failed: ${lastError}`);
  }
}

/**
 * Scale to unit length.
 *
 * Gemini normalises its full-width output, but a truncated one (we ask for 768
 * of 3072) comes back unnormalised - and cosine distance on unnormalised
 * vectors ranks by magnitude as much as by direction, which silently favours
 * longer passages. One pass here keeps the index honest.
 */
function normalise(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const length = Math.sqrt(sum);
  return length > 0 ? values.map((v) => v / length) : values;
}
