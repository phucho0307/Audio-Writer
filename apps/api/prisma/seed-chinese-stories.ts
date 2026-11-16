import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorType, Prisma, PrismaClient, Role, StoryStatus, Visibility } from '@prisma/client';

type Manuscript = {
  key: string; storyId: string; branchId: string; title: string; synopsis: string;
  sourceId: 'monkeyd' | 'metruyen'; sourceUrl: string; genres: string[]; coverUrl: string;
  wordCount: number; textSource: Prisma.InputJsonObject;
  rights: { basis: string; confirmedAt: string };
  cleanupVersion: number;
  chapters: Array<{ title: string; text: string; sha256: string; sourceUrl: string }>;
};
const prisma = new PrismaClient();
const directory = join(__dirname, 'chinese-stories');
const words = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
function stableId(key: string): string {
  const bytes = createHash('sha256').update(`audio-writer:chinese-stories:v1:${key}`).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main() {
  const manifest: { keys: string[]; target: number } = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.target !== 500 || manifest.keys.length !== 500 || new Set(manifest.keys).size !== 500) {
    throw new Error('Expected 500 complete, distinct Chinese stories.');
  }
  const owner = await prisma.user.findFirst({ where: { role: Role.ADMIN }, orderBy: { createdAt: 'asc' } });
  if (!owner) throw new Error('An existing library administrator is required.');
  let created = 0, verified = 0;
  for (const key of manifest.keys) {
    const work: Manuscript = JSON.parse(await readFile(join(directory, `${key}.json`), 'utf8'));
    const url = new URL(work.sourceUrl);
    if (work.key !== key || work.storyId !== stableId(key) || work.branchId !== stableId(`${key}:main`)
      || !['monkeyd', 'metruyen'].includes(work.sourceId) || url.protocol !== 'https:'
      || !['www.monkeydd.com', 'monkeydd.com', 'metruyen.fit'].includes(url.hostname)
      || work.rights.basis !== 'OWNER_AUTHORIZATION' || work.rights.confirmedAt !== '2026-11-16'
      || work.cleanupVersion !== 1
      || work.textSource.collectionId !== 'chinese-drama' || !work.chapters.length || !work.coverUrl
      || work.wordCount !== work.chapters.reduce((n, c) => n + words(c.text), 0)
      || work.chapters.some((c) => !c.title || !c.text.trim() || c.text.length > 12000 || c.text.includes('\uFFFD')
        || createHash('sha256').update(c.text).digest('hex') !== c.sha256)) {
      throw new Error(`Unreviewed or damaged manuscript ${key}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audio-writer:chinese-stories:v1'))`;
      const existing = await tx.story.findUnique({ where: { id: work.storyId } });
      if (existing) {
        const rows = await tx.contribution.findMany({ where: { branchId: work.branchId }, orderBy: { depth: 'asc' } });
        if (rows.length !== work.chapters.length || rows.some((c, i) => c.textPlain !== work.chapters[i].text)) {
          throw new Error(`Published immutable text differs: ${key}`);
        }
        verified++;
        return;
      }
      const chapters = work.chapters.map((c, depth) => ({
        id: stableId(`${key}:chapter:${depth}`), branchId: work.branchId,
        parentId: depth ? stableId(`${key}:chapter:${depth - 1}`) : null,
        depth, title: c.title, authorId: null, authorType: AuthorType.HUMAN,
        content: { type: 'doc', text: c.text }, textPlain: c.text, wordCount: words(c.text),
      }));
      await tx.story.create({ data: {
        id: work.storyId, ownerId: owner.id, title: work.title, synopsis: work.synopsis,
        textSource: work.textSource, coverUrl: work.coverUrl, genres: work.genres,
        language: 'vi', status: StoryStatus.COMPLETE, visibility: Visibility.PUBLIC,
        allowForks: false, unlockPrice: 0, freeChapters: chapters.length,
        contributionCount: chapters.length, wordCount: work.wordCount,
      } });
      await tx.branch.create({ data: { id: work.branchId, storyId: work.storyId, ownerId: owner.id, name: 'main', isRoot: true, lineage: [] } });
      await tx.contribution.createMany({ data: chapters });
      await tx.branch.update({ where: { id: work.branchId }, data: { headContributionId: chapters.at(-1)!.id, depth: chapters.length - 1 } });
      await tx.story.update({ where: { id: work.storyId }, data: { mainBranchId: work.branchId } });
      created++;
    }, { timeout: 30_000 });
  }
  const rows = await prisma.story.findMany({ where: { id: { in: manifest.keys.map(stableId) } }, select: { wordCount: true, contributionCount: true } });
  console.log(JSON.stringify({ created, verified, stories: rows.length, chapters: rows.reduce((n, w) => n + w.contributionCount, 0), words: rows.reduce((n, w) => n + w.wordCount, 0) }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
