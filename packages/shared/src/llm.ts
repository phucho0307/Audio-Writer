/**
 * The three ways a writer asks the AI for help. Each has a different shape of
 * output, which is why they are separate modes rather than one "generate" call.
 */
export type GenerationMode =
  /** Cold start. Genres in, opening passage out. */
  | 'seed'
  /** Writer asked the AI to carry on from where they stopped. */
  | 'continue'
  /** Writer is stuck. Reads the whole story, returns plot options - not prose. */
  | 'suggest'
  /** Analyse pasted source material into a reusable style card. */
  | 'style_card';

export type Language = 'vi' | 'en';

/** Point of view, kept explicit because it is the thing models drift on most. */
export type Pov = 'first' | 'third_limited' | 'third_omniscient';

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

/**
 * Derived once from whatever source material the writer pasted, then injected
 * into every later generation.
 *
 * This exists because retrieval is a poor way to carry voice - pulling
 * superficially similar chunks gives the model examples without telling it what
 * to imitate. A structured description is cheaper, more consistent, and does
 * not grow with the corpus.
 */
export interface StyleCard {
  /** e.g. "trang trọng, cổ điển" / "casual, modern, wry" */
  register: string;
  /** e.g. "short declaratives broken by long subordinate runs" */
  sentenceRhythm: string;
  /** roughly what share of the text is spoken, and how it is punctuated */
  dialogueDensity: string;
  /** how quickly scenes turn over, where the author lingers */
  pacing: string;
  /** recurring images, settings, or preoccupations */
  motifs: string[];
  /** word choice tendencies worth copying, and ones worth avoiding */
  vocabularyNotes: string;
  /** two or three short verbatim lines that typify the voice */
  exemplars: string[];
}

// ---------------------------------------------------------------------------
// Plot suggestions
// ---------------------------------------------------------------------------

/**
 * One way the story could go next. Deliberately a pitch rather than prose: the
 * writer picks a direction and then writes it themselves, which is the whole
 * point of the product. Accepting an option forks the branch.
 */
export interface PlotOption {
  id: string;
  /** Four or five words, for the card header. */
  title: string;
  /** One or two sentences describing where this takes the story. */
  pitch: string;
  /** e.g. "leans into the horror" / "quiet, character-driven" */
  tone: string;
  /** An opening line the writer can start from, or discard. */
  firstLine: string;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * How much prose the AI produces in one turn.
 *
 * Paragraphs rather than a word count, because that is the unit a writer
 * actually thinks in - and short turns matter here: this is a collaboration,
 * and a model that writes four hundred words has taken the story somewhere
 * before the writer got a say.
 */
export type Paragraphs = 1 | 2 | 3;

export interface SeedRequest {
  mode: 'seed';
  genres: string[];
  language: Language;
  pov: Pov;
  /** Optional nudge from the writer: a premise, a character, a setting. */
  hint?: string;
  styleCard?: StyleCard;
  paragraphs?: Paragraphs;
}

export interface ContinueRequest {
  mode: 'continue';
  language: Language;
  pov: Pov;
  /** The story so far. May be summarised upstream if it is very long. */
  storySoFar: string;
  /** Passages retrieved for continuity - names, established facts, callbacks. */
  continuityNotes?: string[];
  styleCard?: StyleCard;
  paragraphs?: Paragraphs;
}

export interface SuggestRequest {
  mode: 'suggest';
  language: Language;
  storySoFar: string;
  continuityNotes?: string[];
  styleCard?: StyleCard;
  /** How many directions to offer. Three to five reads well as cards. */
  count: number;
}

export interface StyleCardRequest {
  mode: 'style_card';
  language: Language;
  /** Raw source material the writer pasted in. */
  sourceText: string;
}

export type LlmRequest =
  | SeedRequest
  | ContinueRequest
  | SuggestRequest
  | StyleCardRequest;

// ---------------------------------------------------------------------------
// Driver contract
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface DriverResult<T> {
  value: T;
  provider: string;
  model: string;
  usage?: TokenUsage;
}

/**
 * Implemented once per provider. Everything above this line is provider-neutral
 * so that swapping a rate-limited free tier for a paid model is configuration
 * rather than a rewrite.
 */
export interface LlmDriver {
  readonly name: string;
  readonly model: string;

  /** False when the provider has no key configured; the chain skips it. */
  isConfigured(): boolean;

  /** Prose, streamed token by token so the editor can render as it arrives. */
  streamProse(
    req: SeedRequest | ContinueRequest,
    signal?: AbortSignal,
  ): AsyncIterable<string>;

  /** Structured output. Used for plot options and style cards. */
  generateJson<T>(
    req: SuggestRequest | StyleCardRequest,
    signal?: AbortSignal,
  ): Promise<DriverResult<T>>;
}

/** Thrown on 429 so the chain knows to try the next driver rather than fail. */
export class RateLimitedError extends Error {
  constructor(
    public readonly provider: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`${provider} is rate limited`);
    this.name = 'RateLimitedError';
  }
}

/** Thrown when a provider is configured but rejected the request outright. */
export class DriverError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'DriverError';
  }
}
