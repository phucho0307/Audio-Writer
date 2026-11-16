import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The provider said "slow down" - out of quota for now, not a broken request. */
export class GeminiBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiBusyError';
  }
}

/**
 * The request can never succeed as configured - unknown or retired model,
 * malformed request, bad key. Stop, do not retry: retrying spends the budget
 * on calls that will fail the same way.
 */
export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiConfigError';
  }
}

/** The model is overloaded (5xx) even after retrying. Try again later. */
export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiUnavailableError';
  }
}

/**
 * Structured output from a small, cheap model.
 *
 * Search makes three kinds of call - describe a story, read a reader's
 * request, say why a result fits - and all three want JSON in a fixed shape,
 * not prose. The response schema is enforced by the API, so the result parses
 * or the call fails; there is no "mostly JSON" to repair.
 *
 * A separate model from the one that writes prose (DISCOVERY_MODEL, default
 * Flash-Lite): this is classification and summary, and on the free tier each
 * model has its own daily quota, so search does not eat the writing quota.
 */
@Injectable()
export class GeminiJson {
  private readonly logger = new Logger(GeminiJson.name);
  private readonly key: string;
  readonly model: string;
  /** Used when the primary model is overloaded, for requests a reader is waiting on. */
  private readonly fallback: string;

  constructor(config: ConfigService) {
    this.key = config.get<string>('GEMINI_API_KEY', '');
    // 2.5 Flash-Lite was closed to new users in 2026; Google points to 3.5.
    this.model = config.get<string>('DISCOVERY_MODEL', 'gemini-3.5-flash-lite');
    // The newest Flash-Lite answers 503 "overloaded" often enough to matter.
    // A different model has its own capacity and its own free quota.
    this.fallback = config.get<string>('DISCOVERY_FALLBACK_MODEL', 'gemini-2.5-flash');
  }

  get available(): boolean {
    return this.key.length > 0;
  }

  async generate<T>(opts: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    temperature?: number;
    maxOutputTokens?: number;
    /**
     * Background work can wait out an overload (4s, then 12s). A reader
     * watching a spinner cannot: one quick retry, then fall back.
     */
    patient?: boolean;
  }): Promise<T> {
    if (!this.available) throw new Error('GEMINI_API_KEY is not set');
    // 503 "overloaded" is common on the newest models and clears in seconds.
    const waits = opts.patient ? [4000, 12000] : [1500];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(opts, this.model);
      } catch (err) {
        if (!(err instanceof GeminiUnavailableError)) throw err;
        if (attempt >= waits.length) {
          // Background work waits for the next pass; a reader gets the
          // fallback model rather than a degraded answer.
          if (opts.patient || !this.fallback || this.fallback === this.model) throw err;
          return this.once<T>(opts, this.fallback);
        }
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  }

  private async once<T>(
    opts: {
      system: string;
      prompt: string;
      schema: Record<string, unknown>;
      temperature?: number;
      maxOutputTokens?: number;
    },
    model: string,
  ): Promise<T> {
    const res = await fetch(`${BASE}/${model}:generateContent?key=${this.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
          temperature: opts.temperature ?? 0.2,
          maxOutputTokens: opts.maxOutputTokens ?? 1024,
          // 2.5 models think by default, and thinking is billed against the
          // output budget; none is needed for a JSON classification.
          ...(model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });
    if (res.status === 429) {
      throw new GeminiBusyError(`${model} is rate limited`);
    }
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      throw new GeminiConfigError(`${model} ${res.status}: ${(await res.text()).slice(0, 240)}`);
    }
    if (res.status >= 500) {
      throw new GeminiUnavailableError(`${model} ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.warn(`unparseable JSON from ${model}: ${text.slice(0, 120)}`);
      throw new Error('model returned invalid JSON');
    }
  }
}
