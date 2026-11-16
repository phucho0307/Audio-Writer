'use client';

import { useState } from 'react';
import { mediaUrl, thumbUrl } from '@/lib/thumb';

export { thumbUrl };

/**
 * A cover for a grid: the 480 px thumbnail rather than the original, which
 * can be megabytes. If the thumbnail is missing - a cover added since the
 * script last ran - it falls back to the original once, and only then to
 * `onFail`.
 */
export default function CoverThumb({
  src,
  alt,
  className,
  onFail,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  onFail?: () => void;
  /** For the first row, which is on screen before anything is scrolled. */
  eager?: boolean;
}) {
  const small = thumbUrl(src);
  const [current, setCurrent] = useState(small);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt={alt}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => {
        if (current !== mediaUrl(src)) setCurrent(mediaUrl(src));
        else onFail?.();
      }}
    />
  );
}
