/* Read-only verification of the 500 imported works, native reader and covers. */
require('reflect-metadata');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const { resolve, join, dirname } = require('node:path');
const Module = require('node:module');
const root = resolve(__dirname, '../..');
require('dotenv').config({ path: join(root, '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const catalog = json('apps/web/lib/chinese-catalog.json');
const manifest = json('apps/api/prisma/chinese-stories/manifest.json');

async function main() {
  assert.equal(catalog.works.length, 500);
  assert.equal(manifest.keys.length, 500);
  const seen = new Set();
  let chapterCount = 0, wordCount = 0;
  for (const key of manifest.keys) {
    const work = json(`apps/api/prisma/chinese-stories/${key}.json`);
    const row = await prisma.story.findUniqueOrThrow({ where: { id: work.storyId }, include: {
      branches: { where: { id: work.branchId }, include: { contributions: { orderBy: { depth: 'asc' } } } },
    } });
    assert.equal(row.visibility, 'PUBLIC');
    assert.equal(row.status, 'COMPLETE');
    assert.equal(row.unlockPrice, 0);
    assert.equal(row.allowForks, false);
    assert.equal(row.textSource.authorName, work.authorName);
    assert.equal(row.textSource.collectionId, 'chinese-drama');
    assert.equal(row.freeChapters, work.chapters.length);
    assert.equal(row.contributionCount, work.chapters.length);
    assert.equal(row.mainBranchId, work.branchId);
    const branch = row.branches[0];
    assert.equal(branch.contributions.length, work.chapters.length);
    assert.equal(branch.headContributionId, branch.contributions.at(-1).id);
    for (const [depth, chapter] of branch.contributions.entries()) {
      assert.equal(chapter.depth, depth);
      assert.equal(chapter.parentId, depth ? branch.contributions[depth - 1].id : null);
      assert.equal(chapter.authorId, null);
      assert.equal(chapter.authorType, 'HUMAN');
      assert.equal(chapter.textPlain, work.chapters[depth].text);
      assert.equal(createHash('sha256').update(chapter.textPlain).digest('hex'), work.chapters[depth].sha256);
      assert(chapter.textPlain.length <= 12000);
      assert(!chapter.textPlain.includes('\uFFFD'));
      assert.equal(chapter.wordCount, chapter.textPlain.trim().split(/\s+/u).length);
      chapterCount++;
      wordCount += chapter.wordCount;
    }
    const fingerprint = createHash('sha256').update(work.chapters.map((c) => c.text).join(' ').replace(/\s+/gu, ' ')).digest('hex');
    assert(!seen.has(fingerprint), `Repeated complete story: ${key}`);
    seen.add(fingerprint);
    assert(row.coverUrl && existsSync(join(root, 'apps/web/public', row.coverUrl)));
  }
  assert.equal(chapterCount, manifest.counts.chapters);
  assert.equal(wordCount, manifest.counts.words);
  const oldNative = json('apps/web/lib/native-catalog.json').works;
  const oldCommunity = Object.keys(json('apps/web/lib/story-authors.json'));
  const protectedIds = [...oldNative.map((work) => work.nativeStoryId), ...oldCommunity];
  assert.equal(await prisma.story.count({ where: { id: { in: protectedIds } } }), protectedIds.length);

  // Render the actual cards and bylines. Prefer .ts over same-named .json,
  // matching Next's resolver rather than Node's extension ordering.
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children) };
    if (request === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    return load.call(this, request, parent, isMain);
  };
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    let target = request.startsWith('@/') ? join(root, 'apps/web', request.slice(2)) : request;
    if (parent?.filename.startsWith(join(root, 'apps/web')) && (target.startsWith('.') || target.startsWith(root)) && !/\.[a-z]+$/i.test(target)) {
      const base = target.startsWith('.') ? resolve(dirname(parent.filename), target) : target;
      target = ['.ts', '.tsx'].map((ext) => base + ext).find(existsSync) || target;
    }
    return originalResolve.call(this, target, parent, ...rest);
  };
  for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file);
  const Card = require(join(root, 'apps/web/app/kham-pha/ChineseWorkCard.tsx')).default;
  const Byline = require(join(root, 'apps/web/app/AuthorByline.tsx')).default;
  const { matchesChineseSearch } = require(join(root, 'apps/web/lib/chinese-catalog.ts'));
  const { FAMOUS_WORKS } = require(join(root, 'apps/web/lib/famous-catalog.ts'));
  assert.equal(FAMOUS_WORKS.filter((work) => work.videoId).length, 31);
  assert(!FAMOUS_WORKS.some((work) => catalog.works.some((cn) => cn.nativeStoryId === work.nativeStoryId)));
  for (const work of catalog.works) {
    const card = renderToStaticMarkup(React.createElement(Card, { work }));
    assert(card.includes(`href="/doc/${work.nativeStoryId}"`));
    assert(card.includes('Đọc &amp; nghe'));
    assert(!card.includes('ho_tan_phuc'));
    assert(matchesChineseSearch(work, work.title));
    const byline = renderToStaticMarkup(React.createElement(Byline, { branchId: work.branchId, handle: 'ho_tan_phuc' }));
    assert(byline.includes('href="/kham-pha?ke=truyen-trung"'));
    assert(!byline.includes('ho_tan_phuc'));
  }
  for (const source of ['monkeyd', 'metruyen']) {
    const work = catalog.works.find((w) => w.sourceId === source);
    assert(work, `Expected a complete work from ${source}`);
    const response = await fetch(`http://localhost:4000/api/stories/${work.nativeStoryId}`);
    assert.equal(response.status, 200);
    const story = await response.json();
    assert.equal(story.textSource.collectionId, 'chinese-drama');
    const readResponse = await fetch(`http://localhost:4000/api/branches/${work.branchId}`);
    assert.equal(readResponse.status, 200);
    const read = await readResponse.json();
    assert.equal(read.contributions.length, work.chapterCount);
    assert.equal(read.access.lockedCount, 0);
  }
  console.log(JSON.stringify({ stories: 500, chapters: chapterCount, words: wordCount, existingStoriesPreserved: protectedIds.length, cardsRendered: 500, nguyenNgocNganEmbeds: 31 }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
