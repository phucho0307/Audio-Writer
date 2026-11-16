import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AuthorType, Prisma, PrismaClient, Role, StoryStatus, Visibility } from '@prisma/client';

type Chapter = { title: string; text: string; sha256: string; sourceUrl: string };
type Manuscript = {
  key: string; storyId: string; branchId: string; title: string; synopsis: string;
  authorName: string; authorId: string; genres: string[]; coverUrl: string | null;
  wordCount: number; textSource: Prisma.InputJsonObject; chapters: Chapter[];
  rights: { basis: string };
};

const prisma = new PrismaClient();
const directory = join(__dirname, 'native-texts');
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
function stableId(key: string): string {
  const bytes = createHash('sha256').update(`audio-writer:native-texts:v1:${key}`).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main() {
  const manifest: { keys: string[] } = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const owner = await prisma.user.findFirst({ where: { role: Role.ADMIN }, orderBy: { createdAt: 'asc' } });
  if (!owner) throw new Error('A library administrator account is required.');
  const authorized = new Set(['nguyen-nhat-anh', 'nguyen-ngoc-tu', 'nguyen-huy-thiep']);
  if (new Set(manifest.keys).size !== manifest.keys.length) throw new Error('Duplicate manifest entries.');
  let created = 0;
  let verified = 0;
  for (const key of manifest.keys) {
    const work: Manuscript = JSON.parse(await readFile(join(directory, `${key}.json`), 'utf8'));
    if (work.key !== key || work.storyId !== stableId(key) || work.branchId !== stableId(`${key}:main`) || !work.chapters.length
      || !['OWNER_AUTHORIZATION', 'PUBLIC_DOMAIN_CC_BY_SA'].includes(work.rights.basis)
      || (work.rights.basis === 'OWNER_AUTHORIZATION' && !authorized.has(work.authorId))
      || (work.rights.basis === 'PUBLIC_DOMAIN_CC_BY_SA' && work.authorId !== 'thach-lam')
      || work.wordCount !== work.chapters.reduce((n, c) => n + wordCount(c.text), 0)
      || work.chapters.some((c) => !c.title || !c.text.trim() || c.text.includes('\uFFFD')
        || createHash('sha256').update(c.text).digest('hex') !== c.sha256)) {
      throw new Error(`Invalid or unreviewed manuscript ${key}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audio-writer:native-texts:v1'))`;
      const existing = await tx.story.findUnique({ where: { id: work.storyId } });
      if (existing) {
        // Contributions are immutable. Re-running the seed verifies the text
        // rather than overwriting a published work or its narration cache.
        const chapters = await tx.contribution.findMany({ where: { branchId: work.branchId }, orderBy: { depth: 'asc' } });
        if (chapters.length !== work.chapters.length || chapters.some((c, i) => c.textPlain !== work.chapters[i].text)) {
          throw new Error(`Published text differs from the reviewed import: ${key}`);
        }
        verified++;
        return;
      }
      const contributions = work.chapters.map((chapter, depth) => ({
        id: stableId(`${key}:chapter:${depth}`), branchId: work.branchId,
        parentId: depth ? stableId(`${key}:chapter:${depth - 1}`) : null,
        depth, title: chapter.title,
        // The administrator imports the record; the literary author is
        // credited separately in textSource. No fictitious login is created.
        authorId: null, authorType: AuthorType.HUMAN,
        content: { type: 'doc', text: chapter.text }, textPlain: chapter.text,
        wordCount: wordCount(chapter.text),
      }));
      await tx.story.create({ data: {
        id: work.storyId, ownerId: owner.id, title: work.title, synopsis: work.synopsis,
        coverUrl: work.coverUrl, textSource: work.textSource,
        genres: work.genres, language: 'vi', status: StoryStatus.COMPLETE,
        visibility: Visibility.PUBLIC, allowForks: false, unlockPrice: 0,
        freeChapters: contributions.length, contributionCount: contributions.length,
        wordCount: work.wordCount,
      } });
      await tx.branch.create({ data: { id: work.branchId, storyId: work.storyId, ownerId: owner.id, name: 'main', isRoot: true, lineage: [] } });
      await tx.contribution.createMany({ data: contributions });
      await tx.branch.update({ where: { id: work.branchId }, data: { headContributionId: contributions.at(-1)!.id, depth: contributions.length - 1 } });
      await tx.story.update({ where: { id: work.storyId }, data: { mainBranchId: work.branchId } });
      created++;
    }, { timeout: 30_000 });
  }
  const rows = await prisma.story.findMany({ where: { id: { in: manifest.keys.map(stableId) } }, select: { wordCount: true, contributionCount: true } });
  console.log(JSON.stringify({ created, verified, works: rows.length, chapters: rows.reduce((n, w) => n + w.contributionCount, 0), words: rows.reduce((n, w) => n + w.wordCount, 0) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
