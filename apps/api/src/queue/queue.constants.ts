/** One queue for now. Narration is the only work heavy enough to leave the request. */
export const NARRATION_QUEUE = 'narration';

/** The job name inside that queue, so a second kind can be added later. */
export const NARRATE_CHAPTER = 'narrate-chapter';

export interface NarrationJob {
  /** What to read. The worker has no request context, so this is by id. */
  contributionId: string;
  /** Only for logging and for the RenderJob row - the text comes from the contribution. */
  branchId: string;
  voice: string;
  /** The durable record this job reports into. */
  renderJobId: string;
}

/**
 * Lower is sooner. Always set one explicitly: BullMQ treats an unset priority
 * as its own class, and mixing prioritised and unprioritised jobs in one queue
 * makes the ordering depend on which kind arrived, not on what matters.
 *
 * The split exists because one click on "narrate this story" can enqueue two
 * hundred jobs. Without it, the next reader who wants a single chapter waits
 * behind all two hundred.
 */
export const PRIORITY = {
  /** A premium reader waiting on this exact chapter: ahead of everyone. */
  PREMIUM: 1,
  /** Somebody is looking at a spinner for this exact chapter. */
  INTERACTIVE: 2,
  /** The chapter after the one a premium reader is listening to. Behind
   * anyone actually waiting, ahead of bulk work. */
  PREMIUM_PREFETCH: 5,
  /** Whole-branch narration, and later the prefetch of the next chapter. */
  BULK: 10,
} as const;
