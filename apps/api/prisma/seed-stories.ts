/**
 * Seeds the sample stories and writes a cover for each.
 *
 * This is the cold-start fix: forking needs stories to fork, and an empty shelf
 * tells a new visitor nothing about what the product is for.
 *
 * Covers are drawn as SVG rather than generated, because the free image tier
 * allows ~20 requests per day and a seed run must not depend on quota.
 * `coverUrl` is only a path, so swapping in generated art later changes nothing
 * else.
 *
 *   npm run db:seed
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorType, PrismaClient, Visibility } from '@prisma/client';
import { SAMPLE_STORIES, type SampleStory } from './sample-stories';
import { COVER_ART } from './cover-art';

const prisma = new PrismaClient();
const COVERS = join(__dirname, '../../web/public/covers');

/** Deterministic, so re-seeding produces identical covers and view counts. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function drawCover(story: SampleStory): string {
  const art = COVER_ART[story.slug];
  if (!art) throw new Error(`No cover art defined for "${story.slug}"`);

  const rand = rng(story.slug);
  const { bg, accent } = art.palette;

  // Grain stops large flat fills reading as a default gradient.
  const grain = Array.from({ length: 260 }, () => {
    const x = (rand() * 600).toFixed(1);
    const y = (rand() * 1080).toFixed(1);
    const r = (rand() * 1.2).toFixed(2);
    const o = (rand() * 0.055).toFixed(3);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1080" viewBox="0 0 600 1080">
  <defs>
    <radialGradient id="vig" cx="0.5" cy="0.44" r="0.78">
      <stop offset="0.55" stop-color="${bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0.85"/>
    </radialGradient>
    <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0.92"/>
    </linearGradient>
  </defs>
${art.body(art.palette)}
  ${grain}
  <rect width="600" height="1080" fill="url(#vig)"/>
  <rect y="820" width="600" height="260" fill="url(#foot)"/>
  <rect x="42" y="972" width="58" height="3" fill="${accent}"/>
</svg>`;
}

async function seedOne(story: SampleStory, authorId: string) {
  await mkdir(COVERS, { recursive: true });
  const file = `${story.slug}.svg`;
  await writeFile(join(COVERS, file), drawCover(story), 'utf8');

  const words = story.chapters.reduce(
    (n, c) => n + c.text.split(/\s+/).length,
    0,
  );

  const row = await prisma.story.create({
    data: {
      ownerId: authorId,
      title: story.title,
      synopsis: story.synopsis,
      coverUrl: `/covers/${file}`,
      genres: story.genres,
      language: 'vi',
      visibility: Visibility.PUBLIC,
      freeChapters: 2,
      unlockPrice: 0,
      contributionCount: story.chapters.length,
      wordCount: words,
      viewCount: Math.floor(rng(story.slug)() * 900) + 80,
    },
  });

  const branch = await prisma.branch.create({
    data: {
      storyId: row.id,
      ownerId: authorId,
      name: 'main',
      isRoot: true,
      lineage: [],
    },
  });

  let parentId: string | null = null;
  for (const [depth, chapter] of story.chapters.entries()) {
    const c: { id: string } = await prisma.contribution.create({
      data: {
        branchId: branch.id,
        parentId,
        depth,
        title: chapter.title,
        authorId,
        authorType: AuthorType.HUMAN,
        content: { type: 'doc', text: chapter.text },
        textPlain: chapter.text,
        wordCount: chapter.text.split(/\s+/).length,
      },
    });
    parentId = c.id;
  }

  await prisma.branch.update({
    where: { id: branch.id },
    data: { headContributionId: parentId, depth: story.chapters.length - 1 },
  });

  console.log(
    `  ${story.title.padEnd(38)} ${story.chapters.length} ch · ${words} words · cover`,
  );
}

async function main() {
  const author = await prisma.user.upsert({
    where: { handle: 'admin' },
    update: {},
    create: {
      handle: 'admin',
      email: 'admin@audiowriter.local',
      displayName: 'Admin',
      locale: 'vi',
    },
  });

  // Idempotent: re-running replaces the samples rather than duplicating them.
  const removed = await prisma.story.deleteMany({ where: { ownerId: author.id } });
  if (removed.count) console.log(`Replacing ${removed.count} existing samples\n`);

  for (const story of SAMPLE_STORIES) {
    await seedOne(story, author.id);
  }

  console.log(`\n${SAMPLE_STORIES.length} sample stories seeded as @admin.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
