import type {
  ContinueRequest,
  Language,
  Pov,
  SeedRequest,
  StyleCard,
  StyleCardRequest,
  SuggestRequest,
} from '@aw/shared';

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

const POV_LABEL: Record<Pov, string> = {
  first: 'first person ("I")',
  third_limited: 'third person limited to one character',
  third_omniscient: 'third person omniscient',
};

function languageRule(language: Language): string {
  return language === 'vi'
    ? [
        'Write in Vietnamese.',
        'Write native Vietnamese prose, not Vietnamese that reads like a translation from English.',
        'Use natural Vietnamese sentence order, idiom, and the pronoun system (anh/em/cô/hắn/nàng and so on) appropriate to the characters and their relationship.',
        'Pronoun choice signals intimacy and power - keep it consistent, and change it only when the relationship changes.',
      ].join(' ')
    : 'Write in English.';
}

function styleRule(card?: StyleCard): string {
  if (!card) return '';
  return [
    '',
    'Imitate this voice:',
    `- Register: ${card.register}`,
    `- Sentence rhythm: ${card.sentenceRhythm}`,
    `- Dialogue: ${card.dialogueDensity}`,
    `- Pacing: ${card.pacing}`,
    `- Recurring motifs: ${card.motifs.join('; ')}`,
    `- Word choice: ${card.vocabularyNotes}`,
    card.exemplars.length
      ? `- Lines that typify the voice:\n${card.exemplars.map((e) => `  "${e}"`).join('\n')}`
      : '',
    'Imitate the voice and technique. Do not reuse the source plot, characters, or phrasing.',
  ]
    .filter(Boolean)
    .join('\n');
}

function continuityRule(notes?: string[]): string {
  if (!notes?.length) return '';
  return [
    '',
    'Established facts from earlier in the story. Do not contradict these:',
    ...notes.map((n) => `- ${n}`),
  ].join('\n');
}

/** Applies to every prose mode. The failure modes these prevent are all common. */
const PROSE_DISCIPLINE = [
  'Write only story prose. No preamble, no commentary, no headings, no summary of what you wrote.',
  'Do not resolve the story. End on a moment that invites the next scene.',
  'Prefer concrete sensory detail over stated emotion. Show the gesture, not the feeling behind it.',
  'Vary sentence length. Consecutive sentences of similar length read as machine-made.',
].join('\n');

/**
 * Length control. Asked for a word count a model will overrun it and keep
 * going; asked for a hard paragraph count it stops cleanly. The ceiling on
 * sentences matters just as much - otherwise "one paragraph" arrives as a
 * single three-hundred-word block.
 */
function lengthRule(paragraphs: number): string {
  const n = Math.min(3, Math.max(1, paragraphs));
  return [
    `Write exactly ${n} paragraph${n > 1 ? 's' : ''}. No more.`,
    'Each paragraph is three to five sentences.',
    'Stop when you reach that limit, even mid-scene. The writer continues from there.',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Mode: seed
// ---------------------------------------------------------------------------

export function buildSeedPrompt(req: SeedRequest): {
  system: string;
  user: string;
} {
  const system = [
    'You are a skilled fiction writer opening a new story that someone else will continue.',
    languageRule(req.language),
    '',
    PROSE_DISCIPLINE,
    'You are writing an opening, so establish a voice, a situation, and at least one person worth following.',
    'Leave concrete threads unresolved - a question asked and not answered, an object unexplained, someone not yet arrived.',
    styleRule(req.styleCard),
  ].join('\n');

  const user = [
    `Genres: ${req.genres.join(' + ')}.`,
    `Point of view: ${POV_LABEL[req.pov]}.`,
    req.hint ? `The writer's idea to build on: ${req.hint}` : '',
    lengthRule(req.paragraphs ?? 1),
    'Where the genres pull in different directions, let the tension between them drive the scene rather than picking one.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

// ---------------------------------------------------------------------------
// Mode: continue
// ---------------------------------------------------------------------------

export function buildContinuePrompt(req: ContinueRequest): {
  system: string;
  user: string;
} {
  const system = [
    'You are continuing a story someone else is writing. You are a collaborator, not the author.',
    languageRule(req.language),
    '',
    PROSE_DISCIPLINE,
    'Match the existing voice, tense, and point of view exactly. If the writer uses short paragraphs, use short paragraphs.',
    'Pick up mid-momentum from the last line. Do not re-establish the scene or recap what just happened.',
    'Advance the story by one beat. Do not skip ahead or cover large spans of time.',
    styleRule(req.styleCard),
    continuityRule(req.continuityNotes),
  ].join('\n');

  const user = [
    `Point of view: ${POV_LABEL[req.pov]}.`,
    '',
    'The story so far:',
    '---',
    req.storySoFar,
    '---',
    '',
    `Continue from the final line. ${lengthRule(req.paragraphs ?? 1)}`,
  ].join('\n');

  return { system, user };
}

// ---------------------------------------------------------------------------
// Mode: suggest
// ---------------------------------------------------------------------------

/**
 * The writer is stuck. They want directions, not prose - so this returns
 * pitches they choose between, and the chosen one forks the branch.
 *
 * The hard part is divergence. Asked for four options, a model will happily
 * return four rewordings of the most obvious next beat, which is worse than
 * useless to someone already stuck. Hence the explicit axis instruction.
 */
export function buildSuggestPrompt(req: SuggestRequest): {
  system: string;
  user: string;
} {
  const system = [
    'You are a story editor helping a writer who has run out of ideas.',
    languageRule(req.language),
    '',
    'Propose genuinely different directions the story could take next.',
    'Each option must differ from the others in kind, not in wording. Vary them along different axes:',
    '- whose choice drives the next scene',
    '- whether the tension escalates, releases, or redirects',
    '- whether something is revealed, concealed, or reversed',
    '- whether the story stays in this scene or cuts elsewhere',
    'At least one option should be something the writer is unlikely to have already considered.',
    'Every option must be reachable from where the story actually is. Do not introduce characters or facts that contradict the text.',
    'Write pitches, not prose. The writer will do the writing.',
    styleRule(req.styleCard),
    continuityRule(req.continuityNotes),
  ].join('\n');

  const user = [
    'The story so far:',
    '---',
    req.storySoFar,
    '---',
    '',
    `Give exactly ${req.count} distinct directions.`,
    'For each: a short title, a one or two sentence pitch, its tone, and one opening line the writer could start from.',
  ].join('\n');

  return { system, user };
}

/** Response schema for `suggest`. Providers enforce this server-side. */
export const PLOT_OPTIONS_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          pitch: { type: 'string' },
          tone: { type: 'string' },
          firstLine: { type: 'string' },
        },
        required: ['title', 'pitch', 'tone', 'firstLine'],
      },
    },
  },
  required: ['options'],
} as const;

// ---------------------------------------------------------------------------
// Mode: style card
// ---------------------------------------------------------------------------

/**
 * Runs once per pasted source, not once per generation. The result is small,
 * cacheable, and injected into later prompts - which is why this does not need
 * vector retrieval to carry voice.
 */
export function buildStyleCardPrompt(req: StyleCardRequest): {
  system: string;
  user: string;
} {
  const system = [
    'You are a literary analyst. Describe how this text is written, so another writer can imitate its technique.',
    'Describe craft only: rhythm, register, structure, pacing, recurring images.',
    'Do not summarise the plot. Do not describe the characters or what happens.',
    req.language === 'vi'
      ? 'Write your analysis in Vietnamese.'
      : 'Write your analysis in English.',
    'For exemplars, quote at most three short lines - a sentence each - chosen because they typify the voice.',
  ].join('\n');

  const user = ['Source text:', '---', req.sourceText, '---'].join('\n');

  return { system, user };
}

/** Response schema for `style_card`. */
export const STYLE_CARD_SCHEMA = {
  type: 'object',
  properties: {
    register: { type: 'string' },
    sentenceRhythm: { type: 'string' },
    dialogueDensity: { type: 'string' },
    pacing: { type: 'string' },
    motifs: { type: 'array', items: { type: 'string' } },
    vocabularyNotes: { type: 'string' },
    exemplars: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'register',
    'sentenceRhythm',
    'dialogueDensity',
    'pacing',
    'motifs',
    'vocabularyNotes',
    'exemplars',
  ],
} as const;
