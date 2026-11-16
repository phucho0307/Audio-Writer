# Chinese fiction shelf

The owner explicitly confirmed rights to republish both text and audio from
MonkeyD (`www.monkeydd.com`) and Mê Truyện (`metruyen.fit`) on 2026-11-16.
This authorization is separate from the earlier three-author Vietnamese
collection. No account impersonating an author is created.

The shelf is named **Truyện Trung · Drama & Trùng sinh** and opens at
`/kham-pha?ke=truyen-trung`. Readers can filter by MonkeyD/Mê Truyện and actual
story genres such as trà xanh, trùng sinh, xuyên sách, hào môn and báo thù.

Selection retains genuine source rankings:

- Mê Truyện's public search results with `s=&post_type=wp-manga&m_orderby=views`.
  Completed works are retained in that order. The home page's `m_orderby`
  parameter alone does not sort its latest-update list.
- MonkeyD's public top-year/month/week/day tables. Duplicate appearances are
  merged. These period ranks are not presented as comparable global scores.

The two sources are interleaved, with the highest-ranked completed candidates
processed first. Identical full text is deduplicated, source errors are
excluded, and the importer continues until 500 complete works are available.
It caches responses under the OS temp directory `audio-writer-chinese-stories`
and uses at most two concurrent requests, at a shared 650 ms interval. Optional
`requests` sessions reuse TLS connections; optional `truststore` uses Windows'
certificate store without disabling HTTPS verification. Standard-library
urllib remains a fallback.

MonkeyD's public text renders some words through CSS `::before`; the importer
includes those visible words and rejects any unresolved styled word. It does
not use the incomplete raw `textContent` of those empty spans. Every source
chapter must download and validate before a work enters the manifest. Long
source pages are split at paragraph/sentence breaks, preserving every word,
to keep the existing Edge TTS jobs below their timeout.

Mê Truyện supplies text. MonkeyD's recording API is behind its advertisement
interaction gate; this importer does not bypass that gate or click ads. The
new native texts use Edge TTS through the same queue and reader as the rest of
the app. No source recording is claimed to have been imported.

From the repo root, run these stages sequentially:

```powershell
python tools/content/import-chinese-stories.py --target 500
python tools/content/clean-chinese-stories.py
python tools/content/finalize-chinese-stories.py
npm run db:seed:chinese --workspace=@aw/api
node --use-system-ca tools/content/queue-native-audio.cjs --chinese --smoke
node --use-system-ca tools/content/queue-chinese-audio.cjs
```

Full manuscripts, source metadata, hashes, authorization scope and failures
live in `apps/api/prisma/chinese-stories`. The lightweight frontend index is
`apps/web/lib/chinese-catalog.json`; it never bundles the manuscript text.
Native story/branch/chapter IDs use a stable, separate namespace. The seed
requires all 500 reviewed works, publishes free complete stories, and verifies
existing immutable text when rerun. Existing community stories, the previous
555 literary imports and the 31 Nguyễn Ngọc Ngạn embeds remain independent.

The collection producer validates the published chapter IDs, creates missing
durable render rows in database batches, then delivers them through the
existing narration queue with every opening first. Existing audio and running
job states are preserved; workers retain content deduplication and provider
limits. `--dry-run` validates the collection without creating jobs. Run
`node --use-system-ca tools/content/verify-chinese-library.cjs` to verify all
published text, chains, bylines, cards and existing collections.

Book covers are saved in `apps/web/public/chinese-covers`. Source URLs are
retained; missing covers get local typographic SVG jackets. Attribution and
translator names remain available in the reader. Unknown literary authors
are not replaced with invented usernames.

For Windows tool runs, PowerShell redirects stdout as UTF-16 unless configured
otherwise. The current progress logs are in the OS temp directory:
`audio-writer-chinese-discovery.log` and `audio-writer-chinese-import.log`.
The importer is resumable from its cached chapters/manuscripts.
