/** Folders of cover art that ship in public/ and are mirrored to R2. */
const STATIC = /^\/(chinese-covers|author-covers|covers)\/(.+)$/;
const THUMBED = /^\/(chinese-covers|author-covers|covers)\/([^/]+)\.(jpe?g|png|webp)$/i;

/**
 * Where the static cover art is served from. Empty means this app's own
 * public/ folder (development). Set to the R2 public URL in production, where
 * the images are uploaded by apps/api/scripts/upload-static-covers.ts and the
 * web image does not carry them.
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE ?? '').replace(/\/+$/, '');

/** A cover path as a URL that works wherever the images are hosted. */
export function mediaUrl(url: string): string {
  return MEDIA_BASE && STATIC.test(url) ? `${MEDIA_BASE}${url}` : url;
}

/**
 * The 480 px WebP made for a cover, or the cover itself if it has none.
 * Covers are never shown wider than about 240 px, and some originals are
 * megabytes. Uploaded covers (already absolute R2 URLs) pass through.
 */
export function thumbUrl(url: string): string {
  const m = THUMBED.exec(url);
  return mediaUrl(m ? `/${m[1]}/thumbs/${m[2]}.webp` : url);
}
