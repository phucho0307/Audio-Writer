'use client';

import { useEffect, useState } from 'react';
import { api, type Story } from '@/lib/api';
import Hero from './_landing/Hero';
import Marquee from './_landing/Marquee';
import Features from './_landing/Features';
import Journey from './_landing/Journey';
import Bento from './_landing/Bento';
import { Faq, FinalCta } from './_landing/Closing';

/**
 * The front door.
 *
 * What Audio Writer is, in the voice of the people it is for, with the
 * product itself on the page rather than described: real covers in the hero,
 * working miniatures of each feature, and counts summed from the live
 * catalogue. The writer's own shelf, which used to live here, is at /cua-toi.
 *
 * Public and needs no account - the first visit is the one that decides
 * whether there is a second.
 */
export default function Home() {
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    api
      .listStories()
      .then((all) => setStories(all.filter((s) => s.contributionCount > 0)))
      // The page reads fine without the catalogue: the hero loses its covers
      // and the counters stay hidden, and nothing claims a number it lacks.
      .catch(() => {});
  }, []);

  return (
    <main className="overflow-x-clip">
      <Hero stories={stories} />
      <Marquee />
      <Features />
      <Journey />
      <Bento stories={stories} />
      <Faq />
      <FinalCta />
    </main>
  );
}
