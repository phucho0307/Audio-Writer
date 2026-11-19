'use client';

import { useEffect, useState } from 'react';

type Choice = 'light' | 'dark' | null;

/**
 * Night and day.
 *
 * Night unless the reader picks day: the boot script in the document head
 * stamps one or the other before first paint (see layout.tsx). The toggle
 * reads the current state from the DOM rather than keeping its own copy.
 */
export default function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setChoice(attr === 'light' || attr === 'dark' ? attr : null);
    setReady(true);
  }, []);

  // What the button would switch to: the opposite of what is on screen now,
  // including when that came from the system rather than from a choice.
  function flip() {
    const dark =
      choice === null
        ? !window.matchMedia('(prefers-color-scheme: light)').matches
        : choice === 'dark';
    const next: Exclude<Choice, null> = dark ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);
    setChoice(next);
    try {
      localStorage.setItem('aw-theme', next);
    } catch {
      // Private mode, or storage switched off. The choice still applies for
      // this page view, which is the useful half.
    }
  }

  return (
    <button
      onClick={flip}
      // Until the effect has run, the label would be a guess at the system
      // setting, so it says nothing rather than something wrong.
      aria-label={ready ? 'Đổi nền sáng / tối' : 'Đổi nền'}
      title="Đổi nền sáng / tối"
      className="btn btn-quiet px-2 py-1.5"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden
      >
        {/* A crescent: the app's resting state is night, so the icon shows
            what you are in rather than what you would get. */}
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}
