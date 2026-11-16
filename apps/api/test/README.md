# Story cover checks

Run `npm run test:covers -w @aw/api` for image validation, ownership, search caching,
candidate binding, Pexels integration and remote URL validation tests. Provider
requests in this suite are mocked.

With the API and web app running locally and migrations applied, run
`npm run test:covers:smoke -w @aw/api` for HTTP checks including one real Gemini
request. The script creates and removes its own two users and private story;
it does not edit existing stories. It requires the local `.env` credentials.

Writers open the cover frame on `/cua-toi` or `/stories/:id`. They can upload
JPG/PNG/WebP (up to 8 MB, minimum 256 px in each dimension), preview the 3:4 crop,
choose an AI suggestion, replace the cover, or remove it. Uploads are re-encoded
as 900 × 1200 JPEGs without EXIF and stored through the existing local/R2 setup.

`GEMINI_API_KEY` enables AI recommendations. `COVER_AI_MODEL` defaults to
`gemini-3.1-flash-lite`. The AI ranks the licensed photos recorded in
`apps/web/public/covers/sources.json`. Adding `PEXELS_API_KEY` also enables new
Pexels searches; the existing library remains the fallback during an outage.
Source and photographer credit are retained with the selected cover and linked
from the reading and story pages. This is photo search, not image generation.

`COVER_AI_DAILY_LIMIT` defaults to 20 fresh requests per user per UTC day.
Recommendations and their search plans are cached for an hour; pagination and
reopening the same search reuse the plan. These turns are separate from prose
generation credits. Uploading and publishing never automatically trigger AI.
# Narration priority

After building the API, run `node --test test/narration-priority.test.cjs` from
`apps/api`. It uses Redis queues with unique `test-narration-priority-*` names
and removes only those test queues. It verifies that pressing play promotes an
already queued background chapter, prefetch cannot demote it, and an active
synthesis is retained without restarting. No production narration is consumed.

