/* Read-only integration verification of the imported library and its UI index. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const Module = require('node:module');
const root = resolve(__dirname, '../..');
require('dotenv').config({ path: join(root, '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const json = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const manifest = json('apps/api/prisma/native-texts/manifest.json');
const catalog = json('apps/web/lib/native-catalog.json');

async function main() {
  assert.equal(catalog.works.length, manifest.keys.length);
  let chapters = 0, words = 0;
  for (const key of manifest.keys) {
    const work = json(`apps/api/prisma/native-texts/${key}.json`);
    const row = await prisma.story.findUniqueOrThrow({ where: { id: work.storyId }, include: {
      branches: { where: { id: work.branchId }, include: { contributions: { orderBy: { depth: 'asc' } } } },
    } });
    assert.equal(row.visibility, 'PUBLIC');
    assert.equal(row.status, 'COMPLETE');
    assert.equal(row.unlockPrice, 0);
    assert.equal(row.freeChapters, work.chapters.length);
    assert.equal(row.allowForks, false);
    assert.equal(row.textSource.authorName, work.authorName);
    assert.equal(row.mainBranchId, work.branchId);
    const branch = row.branches[0];
    assert.equal(branch.contributions.length, work.chapters.length);
    assert.equal(branch.headContributionId, branch.contributions.at(-1).id);
    for (const [index, chapter] of branch.contributions.entries()) {
      assert.equal(chapter.depth, index);
      assert.equal(chapter.parentId, index ? branch.contributions[index - 1].id : null);
      assert.equal(chapter.authorType, 'HUMAN');
      assert.equal(chapter.authorId, null);
      assert.equal(chapter.textPlain, work.chapters[index].text);
      assert.equal(createHash('sha256').update(chapter.textPlain).digest('hex'), work.chapters[index].sha256);
      assert(!chapter.textPlain.includes('\uFFFD'));
      assert(chapter.textPlain.length <= 12_000);
      assert.equal(chapter.wordCount, chapter.textPlain.trim().split(/\s+/u).length);
      words += chapter.wordCount;
      chapters++;
    }
    assert.equal(row.wordCount, branch.contributions.reduce((n, c) => n + c.wordCount, 0));
    assert(row.coverUrl && existsSync(join(root, 'apps/web/public', row.coverUrl)));
  }
  assert.equal(chapters, manifest.counts.chapters);
  assert.equal(words, manifest.counts.words);
  // Existing community content and its persisted bylines remain present.
  const originalIds = Object.keys(json('apps/web/lib/story-authors.json'));
  assert.equal(await prisma.story.count({ where: { id: { in: originalIds } } }), originalIds.length);

  // Render actual cards/bylines with inert navigation, checking that imported
  // work opens the native reader and credits the author rather than the admin.
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const load = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'next/link') return { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children) };
    if (request === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    return load.call(this, request, parent, isMain);
  };
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    let target = request.startsWith('@/') ? join(root, 'apps/web', request.slice(2)) : request;
    if (parent?.filename.startsWith(join(root, 'apps/web')) && (target.startsWith('.') || target.startsWith(root)) && !/\.[a-z]+$/i.test(target)) {
      const base = target.startsWith('.') ? resolve(dirname(parent.filename), target) : target;
      target = ['.ts', '.tsx'].map((extension) => base + extension).find(existsSync) || target;
    }
    return resolveFilename.call(this, target, parent, ...rest);
  };
  for (const extension of ['.ts', '.tsx']) Module._extensions[extension] = (module, filename) => {
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    module._compile(compiled, filename);
  };
  const { FAMOUS_WORKS, matchesCatalogSearch } = require(join(root, 'apps/web/lib/famous-catalog.ts'));
  const official = json('apps/web/lib/famous-catalog.json').works.filter((w) => w.videoId);
  assert.equal(official.length, 31);
  assert.deepEqual(FAMOUS_WORKS.filter((w) => w.videoId), official);
  assert(FAMOUS_WORKS.every((w) => w.videoId || w.nativeStoryId));
  const Card = require(join(root, 'apps/web/app/kham-pha/FamousWorkCard.tsx')).default;
  const Byline = require(join(root, 'apps/web/app/AuthorByline.tsx')).default;
  for (const work of catalog.works) {
    const card = renderToStaticMarkup(React.createElement(Card, { work }));
    assert(card.includes(`href="/doc/${work.nativeStoryId}"`));
    assert(card.includes('Đọc &amp; nghe'));
    const byline = renderToStaticMarkup(React.createElement(Byline, { branchId: work.branchId, handle: 'ho_tan_phuc' }));
    assert(byline.includes(work.textSource.authorName));
    assert(!byline.includes('ho_tan_phuc'));
    assert(matchesCatalogSearch(work, work.textSource.authorName));
  }
  for (const author of catalog.authors) {
    const query = author.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
    assert(FAMOUS_WORKS.filter((w) => matchesCatalogSearch(w, query)).every((w) => w.authorId === author.id));
  }

  // Anonymous API reads verify actual access/serialization, including a long
  // work, a short story and the attributed public-domain collection.
  const samples = [catalog.works.find((w) => w.chapterCount > 30), catalog.works.find((w) => w.chapterCount === 1), catalog.works.find((w) => w.authorId === 'thach-lam')].filter(Boolean);
  for (const work of samples) {
    const response = await fetch(`http://localhost:4000/api/stories/${work.nativeStoryId}`);
    assert.equal(response.status, 200);
    const story = await response.json();
    assert.equal(story.textSource.authorName, work.textSource.authorName);
    const readResponse = await fetch(`http://localhost:4000/api/branches/${work.branchId}`);
    assert.equal(readResponse.status, 200);
    const read = await readResponse.json();
    assert.equal(read.contributions.length, work.chapterCount);
    assert.equal(read.access.lockedCount, 0);
  }
  console.log(JSON.stringify({ verifiedWorks: catalog.works.length, verifiedChapters: chapters, words, officialEmbedsUnchanged: official.length, existingStoriesPreserved: originalIds.length, nativeCardsRendered: catalog.works.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
