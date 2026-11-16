# Famous-author catalog

Run `python tools/content/crawl-famous-catalog.py` from the repo root to refresh
the imported shelf. It uses only Python's standard library. Public HTML and
thumbnail responses are cached under the OS temp folder in
`audio-writer-famous-catalog` to avoid repeated requests.

The importer collects titles, author attribution, cover thumbnails, source URLs
and official YouTube video IDs. It does **not** download book text, transcripts,
audio files or video files. Audio on the work pages plays through the official
YouTube embed; publisher and Fonos entries link to their source pages.

Sources:

- Nguyễn Ngọc Ngạn's official YouTube channel and its story playlists. Each
  imported recording is checked against public oEmbed channel metadata.
- NXB Trẻ's author catalogs and public search pagination. Each book's author
  link is verified on its publisher detail page. Reprints and binding variants
  are deduplicated by normalized title.
- Fonos book and author pages for the additional literary classics.

The result is `apps/web/lib/famous-catalog.json`, with local thumbnails in
`apps/web/public/author-covers/`. Every work retains its discovery page, original
source title and thumbnail URL for review. The snapshot is written atomically
after import and is independent of user-created stories and their ownership.

On `/kham-pha`, the shelf supports source, author, genre and accent-insensitive
title/author search. `?tacgia=nguyen-ngoc-ngan` opens that author's filter directly.
The metadata snapshot is retained for provenance and old links. The active
famous-author shelf now contains native full-text imports plus the existing
official Nguyễn Ngọc Ngạn YouTube embeds. Publisher/Fonos metadata without a
native text is no longer offered as a readable book on the shelf.

## Native full texts

The owner explicitly confirmed full-text republication rights for Nguyễn Nhật
Ánh, Nguyễn Ngọc Tư and Nguyễn Huy Thiệp on 2026-11-15. This allowlist does not
grant rights to other authors. `import-native-texts.py` reads their publicly
accessible text pages on Việt Nam Thư Quán, including author-list pagination
and every contents page. It does not log in, bypass access controls, download
third-party audio, or turn previews into full books. Requests are cached in
the OS temp directory and limited to two concurrent requests.

`import-thach-lam.py` separately imports existing prose works on Vietnamese
Wikisource. These retain the original author, permanent revision links and
CC BY-SA 4.0 attribution for the source transcription/formatting. No modern
translation is imported under an assumption about the original author's age.

From the repository root:

```powershell
python tools/content/import-native-texts.py
python tools/content/import-thach-lam.py
python tools/content/finalize-native-texts.py
npm run db:seed:native --workspace=@aw/api
node --use-system-ca tools/content/queue-native-audio.cjs --smoke
node --use-system-ca tools/content/queue-native-audio.cjs
```

Finish the downloads before finalizing and seeding. `native-texts/manifest.json`
contains only reviewed, complete downloads; source errors and duplicate works
are excluded. Exact duplicated source chapters require explicit review. The
finalizer divides pages over 12,000 characters at paragraph/sentence breaks,
verifies that every word remains in order, and records source chapter titles
and part numbers. This keeps Edge narration below the normal job timeout.

The seed is idempotent and checks hashes, counts, authorization scope and the
published immutable chapter chain. An administrator owns the library record;
`Story.textSource` credits the actual literary author. It creates no account
impersonating an author. All imported text is public and free, with forking
disabled. Re-running verifies existing text instead of overwriting it.

`apps/web/lib/native-catalog.json` is a lightweight index, not the manuscript
bundle. Imported cards open `/doc/:id` directly, and matching old `/tac-pham`
links redirect there. The all-content shelf deduplicates these native stories
against the author cards. Book-cover images retain their source URLs; missing
covers use local typographic SVG jackets. Source and license details are
available in the reader without requiring navigation away to read the work.

The audio producer uses the existing `TtsService`, idempotent cache and BullMQ
queue with the Edge Hoài My voice. It starts no extra worker and changes no
shared rate/concurrency settings. Existing workers render the collection in
the background, with first chapters queued before the remaining chapters.
