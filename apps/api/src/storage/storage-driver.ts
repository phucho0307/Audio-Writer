/** Injection token for whichever driver is configured. */
export const AUDIO_STORAGE = Symbol('AUDIO_STORAGE');

export interface StoredObject {
  /**
   * What goes into `AudioClip.url`.
   *
   * A path on disk-backed storage (`/audio/abc.m4a`) and an absolute URL on
   * object storage. The player only ever hands it to an `<audio src>`, so both
   * shapes work without the client knowing which is in use.
   */
  url: string;
  bytes: number;
}

/**
 * Where rendered audio goes.
 *
 * The interface exists because the local-disk implementation is the thing
 * blocking deployment, not because two backends are interesting in themselves.
 * The API currently writes files into the *web app's* `public/` directory,
 * which works only while both processes share a filesystem: separate them and
 * narration produces files nobody can serve, and a second API replica cannot
 * see what the first one wrote.
 *
 * Audio is immutable once rendered - the file is named by a hash of its own
 * content - so it is a perfect candidate for a far-future cache header, which
 * each driver sets in whatever way it can.
 */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  /**
   * Whether there is budget left to store more. Optional: only storage that
   * costs money past a free allowance has a budget. Checked before expensive
   * work (synthesis) so it is not done for a file that could not be kept.
   */
  hasRoom?(): Promise<boolean>;
}

/**
 * put() refused because the write would take storage past its budget. Not a
 * transient failure: retrying will not help until someone frees space or
 * raises the limit.
 */
export class StorageFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageFullError';
  }
}
