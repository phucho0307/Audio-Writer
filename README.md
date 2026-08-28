# Audio Writer

A collaborative fiction platform where readers can take someone else's story and
write their own version of it — then listen to the result.

Built for Vietnamese web fiction (*truyện*), where a reader who disagrees with
chapter 12 currently has no option but to write a whole new story. Here they
fork it: chapters 1–11 stay exactly as the original author wrote them, chapter
12 becomes theirs, and both versions exist side by side.

---

## The idea

Three things a reader can do with any story:

| | |
|---|---|
| **Read it** | Chapter list, reader view, prev/next |
| **Hear it** | Text-to-speech narration, per chapter or the whole story |
| **Fork it** | Diverge at any chapter and write your own continuation |

Writers get an AI collaborator that opens a story from a genre brief, continues
from where they stopped, or — when they're stuck — proposes several genuinely
different directions the plot could take. **Picking one of those suggestions
forks the story**, so the AI's job is to offer choices rather than to write the
book.

---

## Two decisions worth reading the code for

### Forking copies nothing

The obvious way to fork a 50-chapter story is to duplicate 50 rows. Ten forks
and you have 500 copies of the same prose, and a typo in chapter 3 has to be
fixed eleven times.

Instead, a fork writes **one row**:

```
branches.forkedAtDepth = 11      -- inherit everything up to chapter 12
branches.lineage       = [main]  -- ordered ancestors
```

Reading a branch resolves to *its ancestors' chapters up to the fork depth,
plus its own*. Forking costs a single `INSERT` whether the story is four
chapters or four hundred.

The key invariant: **`contributions` is immutable.** Nothing ever updates or
deletes a row. Corrections are new contributions, removals are new branches.
Fiction is append-mostly, which is why this works and why none of the hard
parts of a merge algorithm are needed.

See [`schema.prisma`](apps/api/prisma/schema.prisma) and
[`stories.service.ts`](apps/api/src/stories/stories.service.ts).

### The AI runs on free tiers, so everything is metered

There is no paid model key. That constraint shapes the whole generation path:

- **A `LlmDriver` port** with the provider behind it, so switching from Gemini
  to Groq, OpenRouter, or a paid model is configuration rather than a refactor.
- **Failover on 429 only.** A rate limit moves to the next driver; any other
  error propagates, because retrying a malformed request against a second
  provider just wastes its quota too.
- **Three AI turns per user per day.** As much a product decision as a cost one:
  unlimited generation turns a writing tool into a slot machine. Writing by hand
  is never metered.
- **Narration is cached** on `(contribution, voice)`, so asking twice costs one
  synthesis. With ~20 TTS requests a day across the whole project, re-narrating
  something already heard would spend a scarce resource on nothing.
- **Bring-your-own-key** as the pressure valve — a user spending their own quota
  costs nothing, so they aren't metered at all.

See [`llm.service.ts`](apps/api/src/llm/llm.service.ts),
[`ai-quota.service.ts`](apps/api/src/llm/ai-quota.service.ts) and
[`tts.service.ts`](apps/api/src/tts/tts.service.ts).

---

## Stack

**TypeScript** for the product, **Postgres** for the domain.

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 (App Router) | Story pages must be crawlable — organic search is how a content platform grows |
| API | NestJS | Modules, DI and guards; auth becomes configuration rather than plumbing |
| Database | PostgreSQL 16 + `pgvector` | The version graph is relational; `pgvector` is there for story-continuity retrieval |
| Cache | Redis 7 | Rate-limit windows and daily AI quotas |
| Text | Gemini Flash, behind a driver port | Free tier, strongest Vietnamese of the options |
| Speech | Gemini TTS → WAV | Returns headerless PCM; a 44-byte RIFF header is wrapped on server-side |
| Styling | Tailwind 4 | — |

Postgres and Redis run in Docker; everything else runs on the host.

---

## Running it

Needs **Node 22+** and **Docker**.

```bash
git clone https://github.com/phucho0307/Audio-Writer.git
cd Audio-Writer
npm install

cp .env.example .env          # then fill in the values below
npm run up                    # postgres + redis
npm run db:migrate            # create the schema
npm run db:seed               # six sample stories with covers

npm run dev:api               # http://localhost:4000/api
npm run dev:web               # http://localhost:3000
```

**Minimum config** in `.env`:

```bash
GEMINI_API_KEY="..."          # free at aistudio.google.com/apikey
JWT_ACCESS_SECRET="..."       # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_REFRESH_SECRET="..."
BYOK_ENCRYPTION_KEY="..."     # 32 bytes, same generator
```

Everything else has a working default. Without a Gemini key the app still runs —
reading, writing and forking all work; only the AI and narration endpoints
return "not configured".

### Scripts

| Command | Does |
|---|---|
| `npm run up` / `down` / `logs` | Docker services |
| `npm run dev:api` / `dev:web` | Watch mode |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Replace the sample stories |
| `npm run db:studio` | Browse the database |

---

## Layout

```
apps/api        NestJS — REST API, story graph, AI gateway, TTS
  prisma/       schema, migrations, sample stories + generated covers
  src/llm/      driver port, prompt construction, daily quota
  src/tts/      narration, PCM→WAV, per-chapter caching
  src/stories/  the branch model and the chapter paywall
apps/web        Next.js — library, reader, editor
packages/shared types crossing the API/web boundary
infra/          docker-compose
```

---

## Status

Working end to end: writing, AI assistance with a daily cap, forking, the
library and reader, chapter narration in four voices, and paid chapters with a
writer earnings ledger.

Not built yet: real authentication (there is a seam where it goes —
`CurrentUserService` returns a fixed dev user), payment processing, and the
video pipeline. Two dev-only endpoints grant credits without payment and are
marked in the code as such.

The sample stories under `@admin` are original, written for this project.

---

## Licence

Not yet licensed. All rights reserved for now.
