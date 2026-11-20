'use client';

import { useEffect, useState } from 'react';

/**
 * Music under the narration: on by default with "Bóng lá rơi", at a level of
 * its own, separate from the voice's. The listener can pick another track or
 * switch the music off; switching it off keeps the chosen track for when it
 * comes back on.
 *
 * The site owner's own tracks, stored on R2 (`background-music/`). Listed here
 * rather than fetched, so the picker shows at once and costs no request.
 */
export interface MusicTrack {
  id: string;
  title: string;
  url: string;
}

export const TRACKS: MusicTrack[] = [
  { id: "LNJOOOfa88A", title: "Asphyxia", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/LNJOOOfa88A/08c6680ec1b9af6fb25def48c6a415c05f9f22a8f60590197c52159e161669ee.m4a" },
  { id: "zWbpgD8m4RM", title: "Bóng lá rơi", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/zWbpgD8m4RM/ca0505204736722ce8fedb0ce84bb30512d559c182876951e3b0e50083171b4f.m4a" },
  { id: "2sMz0Y8iTkI", title: "Cry For Me", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/2sMz0Y8iTkI/c9e94825c0a39d586e54da223edd2fda02103aefb3cb8bb9ca9ea1668583b405.m4a" },
  { id: "IIEOJGk91u4", title: "Despair", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/IIEOJGk91u4/0af0643be3ec8725d8feba33c604bcb3b8f4dc4c382ee220f184c9f077f6703d.m4a" },
  { id: "ixF-_KG4ZpE", title: "Fallin' Flower", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/ixF-_KG4ZpE/875aa7561d007df97598553cbdb3fcd87edfb69646481779f7d142058c71aee9.m4a" },
  { id: "_39fRCoiJws", title: "Fiction", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/_39fRCoiJws/c906f031a19a180a9c24c9a40fedb352c480991d5c2e6ae87a43c2a814bcf0fc.m4a" },
  { id: "hZ-V8eK6QaY", title: "Illusionary Daytime", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/hZ-V8eK6QaY/92e2fabb1892c0c0db5d07410b7c8dd2dda8822706322792bb5a3a0e9b658147.m4a" },
  { id: "bub7wCXC-AU", title: "Inner Peace", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/bub7wCXC-AU/803ea86ad457f4a5dded1e496d706d3e4046ec22e6d97998fd5f701c7fad75b7.m4a" },
  { id: "lr58aA91Sv0", title: "Late Night Melancholy", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/lr58aA91Sv0/bc50deb52607545422f5fc177ab2a9511f3420b3c5523d590ae54549d458714c.m4a" },
  { id: "DK23U3sJrYg", title: "Người yêu bỏ lỡ", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/DK23U3sJrYg/b613fe6b5e0d770e6790858ad7a3d40b969d935f01e58c441039d561677726fc.m4a" },
  { id: "vV0K5RkpSnE", title: "Paris", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/vV0K5RkpSnE/09ba2834021221a87c3bf0a07a844ca311ddcdda3098f35ef520f6d2e681b443.m4a" },
  { id: "keAjkl-iyHk", title: "Run", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/keAjkl-iyHk/9497d9e4f6146067869eb4721330e540e108162aa2bcfe76624381602e4cc3e8.m4a" },
  { id: "BgASlEX40B8", title: "Shiverr", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/BgASlEX40B8/66ef1b00a9e6442c098d3ac1632625b3066d2e540c3b7060e2fe41b259b21e50.m4a" },
  { id: "UDhE5RGn3Tw", title: "Star Sky", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/UDhE5RGn3Tw/5b8da4f6202e0071733c9aa82075716852da71d4ddb002e7db396c784384269c.m4a" },
  { id: "TCNpBpY75SQ", title: "Take Me Hand", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/TCNpBpY75SQ/a657f6512d318827426d31b384215b066b063012ff2662b133e70636d14ef1d1.m4a" },
  { id: "8yWYiMP2ZYU", title: "The Conductors", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/8yWYiMP2ZYU/46d25d48c60dec25e9f1a9d25fd29cc0fa4d2b6b5441c6103460909a8a51058a.m4a" },
  { id: "Etmz0TKscuw", title: "Thiếu niên hoa hồng", url: "https://pub-615b99a389944041a7970ec6d76d46a3.r2.dev/background-music/youtube/Etmz0TKscuw/c426e61d637de48deb2995f5b6a05846be9239eda593ea5843e97f02f4e84cf3.m4a" },
];

const TRACK_KEY = 'aw-music';
const LEVEL_KEY = 'aw-music-volume';
/** '0' when the listener has switched music off. Absent means on. */
const ON_KEY = 'aw-music-on';
/** What plays until the listener picks something else. */
export const DEFAULT_TRACK_ID = 'zWbpgD8m4RM'; // Bóng lá rơi
const EVENT = 'aw-music-change';
/** Under a voice, music wants to be heard, not listened to. A reader who has
 * moved the slider keeps their own level; this is only where it starts. */
export const DEFAULT_MUSIC_LEVEL = 0.15;

export interface MusicChoice {
  /** What is playing: the chosen track while music is on, otherwise null. */
  track: MusicTrack | null;
  /** The chosen track, kept while music is off. */
  chosen: MusicTrack;
  on: boolean;
  level: number;
}

const fallback = (): MusicTrack => TRACKS.find((t) => t.id === DEFAULT_TRACK_ID) ?? TRACKS[0];

function read(): MusicChoice {
  let id: string | null = null;
  let level = DEFAULT_MUSIC_LEVEL;
  let on = true;
  try {
    id = localStorage.getItem(TRACK_KEY);
    on = localStorage.getItem(ON_KEY) !== '0';
    const kept = Number(localStorage.getItem(LEVEL_KEY) ?? NaN);
    if (kept >= 0 && kept <= 1) level = kept;
  } catch {}
  const chosen = TRACKS.find((t) => t.id === id) ?? fallback();
  return { track: on && chosen ? chosen : null, chosen, on, level };
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function chooseTrack(id: string): void {
  write(TRACK_KEY, id);
}

/** Music on or off. Off is remembered; on is the default, so it clears the flag. */
export function setMusicOn(on: boolean): void {
  write(ON_KEY, on ? null : '0');
}

export function chooseMusicLevel(level: number): void {
  write(LEVEL_KEY, String(Math.max(0, Math.min(1, level))));
}

/** The current choice, kept in step across every component and tab that shows it. */
export function useMusicChoice(): MusicChoice {
  const [choice, setChoice] = useState<MusicChoice>(() => ({ track: null, chosen: fallback(), on: true, level: DEFAULT_MUSIC_LEVEL }));
  useEffect(() => {
    const sync = () => setChoice(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return choice;
}
