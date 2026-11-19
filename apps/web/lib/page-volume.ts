/**
 * True on iPhone and iPad, where Safari (and every iOS browser, which are all
 * Safari underneath) ignores a page setting `audio.volume`: the element plays
 * at full level and only the hardware buttons change it. `muted` still works.
 *
 * iPadOS asks for desktop sites and reports itself as a Mac, so a Mac with a
 * touch screen is counted too - no real Mac has one.
 */
export function pageVolumeIgnored(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
