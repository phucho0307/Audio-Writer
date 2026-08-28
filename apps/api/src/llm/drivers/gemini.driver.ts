import {
  DriverError,
  RateLimitedError,
  type ContinueRequest,
  type DriverResult,
  type LlmDriver,
  type SeedRequest,
  type StyleCardRequest,
  type SuggestRequest,
} from '@aw/shared';
import {
  PLOT_OPTIONS_SCHEMA,
  STYLE_CARD_SCHEMA,
  buildContinuePrompt,
  buildSeedPrompt,
  buildStyleCardPrompt,
  buildSuggestPrompt,
} from '../prompts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/**
 * Gemini expects an OpenAPI 3.0 subset where type names are upper case, not the
 * lower-case JSON Schema spelling our shared schemas are written in. Converting
 * here keeps the schemas provider-neutral - the OpenAI-compatible drivers
 * (Groq, OpenRouter) consume them unchanged.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'type' && typeof value === 'string') {
      out[key] = value.toUpperCase();
    } else {
      out[key] = toGeminiSchema(value);
    }
  }
  return out;
}

export class GeminiDriver implements LlmDriver {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
  ) {}

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // -------------------------------------------------------------------------

  async *streamProse(
    req: SeedRequest | ContinueRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    const { system, user } =
      req.mode === 'seed' ? buildSeedPrompt(req) : buildContinuePrompt(req);

    const res = await this.post(
      `${this.model}:streamGenerateContent?alt=sse`,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.9,
          topP: 0.95,
          maxOutputTokens: 8192,
          // Gemini 2.5 models reason before answering unless told not to, and
          // reasoning is billed against maxOutputTokens. On a prose request it
          // consumed ~3.6k of a 4k budget and truncated the story to a
          // sentence. Creative continuation needs no chain of thought, so turn
          // it off here and keep the whole budget for the writing itself.
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      signal,
    );

    if (!res.body) {
      throw new DriverError(this.name, 'empty response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line - but Gemini sends CRLF, so
        // splitting on "\n\n" matches nothing and swallows the whole stream as
        // a single frame. Keep the trailing partial frame for the next read.
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const line = frame
            .split(/\r?\n/)
            .find((l) => l.startsWith('data:'))
            ?.slice(5)
            .trim();
          if (!line || line === '[DONE]') continue;

          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(line) as GeminiChunk;
          } catch {
            continue; // a partial frame we can safely skip
          }

          const text = chunk.candidates?.[0]?.content?.parts
            ?.map((p) => p.text ?? '')
            .join('');
          if (text) yield text;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // -------------------------------------------------------------------------

  async generateJson<T>(
    req: SuggestRequest | StyleCardRequest,
    signal?: AbortSignal,
  ): Promise<DriverResult<T>> {
    const { system, user } =
      req.mode === 'suggest'
        ? buildSuggestPrompt(req)
        : buildStyleCardPrompt(req);

    const schema =
      req.mode === 'suggest' ? PLOT_OPTIONS_SCHEMA : STYLE_CARD_SCHEMA;

    const res = await this.post(
      `${this.model}:generateContent`,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          // Lower than prose: we want structural variety across options, not
          // wild variance inside any one of them.
          temperature: 0.8,
          // Thinking stays on here - unlike prose, working out how four plot
          // directions differ from each other is genuine reasoning, and it is
          // what stops the model returning four rewordings of one idea. The
          // budget is generous because thinking is billed against it.
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
        },
      },
      signal,
    );

    const body = (await res.json()) as GeminiChunk;
    const text = body.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('');

    if (!text) {
      throw new DriverError(this.name, 'no content in response');
    }

    let value: T;
    try {
      value = JSON.parse(text) as T;
    } catch {
      throw new DriverError(
        this.name,
        `response was not valid JSON: ${text.slice(0, 200)}`,
      );
    }

    return {
      value,
      provider: this.name,
      model: this.model,
      usage: {
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  // -------------------------------------------------------------------------

  private async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const res = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (res.ok) return res;

    const detail = await res.text();

    // The chain catches this and moves to the next driver rather than failing
    // the user's request - free tiers hit this constantly.
    if (res.status === 429) {
      throw new RateLimitedError(this.name, parseRetryDelay(detail));
    }

    throw new DriverError(
      this.name,
      detail.slice(0, 300) || res.statusText,
      res.status,
    );
  }
}

/** Gemini returns a RetryInfo detail like `"retryDelay": "27s"` on 429. */
function parseRetryDelay(body: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}
