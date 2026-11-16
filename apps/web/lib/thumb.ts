/** Folders that have a `thumbs/` copy made by scripts/make-thumbs.mjs. */
const THUMBED = /^\/(chinese-covers|author-covers|covers)\/([^/]+)\.(jpe?g|png|webp)$/i;

/**
 * The 480 px WebP made for a cover, or the cover itself if it has none.
 * Covers are never shown wider than about 240 px, and some originals are
 * megabytes. Uploaded covers (R2, /uploads) pass through unchanged.
 */
export function thumbUrl(url: string): string {
  const m = THUMBED.exec(url);
  return m ? `/${m[1]}/thumbs/${m[2]}.webp` : url;
}
