import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorType, PrismaClient, Role, StoryStatus, Visibility } from '@prisma/client';

interface Manuscript {
  slug: string;
  title: string;
  genres: string[];
  synopsis: string;
  modelProvider: string;
  modelName: string;
  chapters: Array<{ title: string; text: string; modelName?: string }>;
}

const prisma = new PrismaClient();
const directory = join(__dirname, 'dark-stories');
const coversDirectory = join(__dirname, '../../web/public/covers');
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;

function stableId(name: string): string {
  const bytes = createHash('sha256').update(`audio-writer:dark-stories:v1:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadManuscripts(): Promise<Manuscript[]> {
  const briefs: Array<{ slug: string; title: string }> = JSON.parse(
    await readFile(join(directory, 'briefs.json'), 'utf8'),
  );
  if (briefs.length !== 50 || new Set(briefs.map((brief) => brief.slug)).size !== 50) {
    throw new Error('Expected 50 distinct stories in this collection.');
  }
  return Promise.all(briefs.map(async (brief) => {
    const story: Manuscript = JSON.parse(
      await readFile(join(directory, `${brief.slug}.json`), 'utf8'),
    );
    const counts = story.chapters?.map((chapter) => wordCount(chapter.text)) ?? [];
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (
      story.slug !== brief.slug || story.title !== brief.title || !story.synopsis?.trim() ||
      !story.genres?.length || counts.length !== 10 ||
      total < 10_000 || total > 15_000 ||
      story.chapters.some((chapter) =>
        !chapter.title?.trim() || !/[.!?…]["'”’»)*_\s]*$/u.test(chapter.text?.trim() ?? '') ||
        chapter.text.includes('\uFFFD') || /[\p{L}\p{N}]\?+[\p{L}\p{N}]/u.test(`${chapter.title} ${chapter.text}`),
      )
    ) {
      throw new Error(`Manuscript needs review before publication: ${brief.slug}`);
    }
    return story;
  }));
}

async function main() {
  const manuscripts = await loadManuscripts();
  const author = process.env.SEED_AUTHOR_EMAIL
    ? await prisma.user.findUnique({ where: { email: process.env.SEED_AUTHOR_EMAIL } })
    : await prisma.user.findFirst({ where: { role: Role.ADMIN }, orderBy: { createdAt: 'asc' } });
  if (!author) throw new Error('An existing author account is required to publish the collection.');

  const published = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audio-writer:dark-stories:v1'))`;
    let created = 0;
    for (const story of manuscripts) {
      const id = stableId(story.slug);
      if (await tx.story.findUnique({ where: { id }, select: { id: true } })) continue;
      const coverFile = `${story.slug}.jpg`;
      const branchId = stableId(`${story.slug}:main`);
      const contributions = story.chapters.map((chapter, depth) => ({
        id: stableId(`${story.slug}:chapter:${depth}`),
        branchId,
        parentId: depth ? stableId(`${story.slug}:chapter:${depth - 1}`) : null,
        depth,
        title: chapter.title,
        authorId: author.id,
        authorType: AuthorType.AI,
        modelProvider: story.modelProvider,
        modelName: chapter.modelName ?? story.modelName,
        content: { type: 'doc', text: chapter.text },
        textPlain: chapter.text,
        wordCount: wordCount(chapter.text),
      }));
      await tx.story.create({
        data: {
          id,
          ownerId: author.id,
          title: story.title,
          synopsis: story.synopsis,
          coverUrl: existsSync(join(coversDirectory, coverFile)) ? `/covers/${coverFile}` : null,
          genres: story.genres,
          language: 'vi',
          status: StoryStatus.COMPLETE,
          visibility: Visibility.PUBLIC,
          allowForks: true,
          freeChapters: contributions.length,
          unlockPrice: 0,
          contributionCount: contributions.length,
          wordCount: contributions.reduce((sum, chapter) => sum + chapter.wordCount, 0),
        },
      });
      await tx.branch.create({
        data: { id: branchId, storyId: id, ownerId: author.id, name: 'main', isRoot: true, lineage: [] },
      });
      await tx.contribution.createMany({ data: contributions });
      await tx.branch.update({
        where: { id: branchId },
        data: { headContributionId: contributions.at(-1)!.id, depth: contributions.length - 1 },
      });
      await tx.story.update({ where: { id }, data: { mainBranchId: branchId } });
      created += 1;
    }
    return created;
  }, { timeout: 120_000 });

  const rows = await prisma.story.findMany({
    where: { id: { in: manuscripts.map((story) => stableId(story.slug)) } },
    select: { id: true, title: true, wordCount: true, contributionCount: true, status: true, visibility: true },
  });
  if (rows.length !== 50) throw new Error('Publication verification failed.');
  console.log(JSON.stringify({ created: published, collection: rows.length, author: author.handle, stories: rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
