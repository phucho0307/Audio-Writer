# Audio Writer — auth & system design notes

Written to be talked through out loud. Every section is a decision, the reason
behind it, and the trap that makes it interesting. Nothing here is aspirational:
if it is in this file, it is in the repo and it runs.

Stack: NestJS + Postgres 16 (pgvector image) + Redis 7, Next.js App Router front
end, Prisma, in a workspace monorepo. Nine API modules: `auth`, `stories`,
`llm`, `tts`, `queue`, `throttler`, `redis`, `prisma`, `health`.

---

## 1. What the product is

A collaborative fiction platform for Vietnamese audio storytelling. Humans and
an LLM write chapters together; readers **fork** a story into their own version
the way you would fork a repo; finished branches get narrated to audio. The data
model is deliberately git-shaped, and that shape drives most of the interesting
engineering.

---

## 2. Authentication

### 2.1 Why OAuth only, no passwords

There is no password field anywhere in the schema. Google is the only identity
provider. That deletes an entire category of work and risk: no password hashing,
no reset-token flow, no breach-list checks, no credential-stuffing surface. The
cost is a hard dependency on Google, which for a consumer product in this market
is acceptable.

Consequence worth stating out loud in an interview: **the classic brute-force
threat does not exist here.** That changes what the rate limiter is actually
defending, and I designed it accordingly (§3.4) instead of copying a
login-throttle recipe.

### 2.2 Two tokens, different jobs

| | Access token | Refresh token |
|---|---|---|
| Format | JWT, signed HS256 | 48 bytes of CSPRNG output |
| Lifetime | 15 minutes | 30 days |
| Lives in | a JS module variable in the browser | httpOnly cookie |
| Stored server-side | not at all | SHA-256 digest in `sessions` |
| Sent as | `Authorization: Bearer` | automatically, by the browser |

The split exists because the two have opposite requirements. The access token is
presented on every request, so it must be cheap to verify — stateless JWT, no
database round trip. That makes it impossible to revoke, which is acceptable
because it dies in fifteen minutes. The refresh token is presented rarely, so it
can afford a database lookup, and that lookup is what makes revocation possible.

### 2.3 Where each token lives, and why

**Access token in a module variable, not `localStorage`.** `localStorage`
survives a tab close, which sounds like a feature and is exactly the problem:
anything that manages to execute script on the page can read it. Memory dies
with the tab. It is a module singleton rather than React context because the
fetch wrapper is a plain function, not a hook — React subscribes to it through
`useSyncExternalStore`.

**Refresh token in an httpOnly cookie.** Script cannot read it, so XSS cannot
exfiltrate it. Three attributes carry real weight:

- `httpOnly` — the point.
- `sameSite: 'lax'` — the cookie is not sent on cross-site POST, which is what
  makes `POST /auth/refresh` safe without a separate CSRF token.
- `path: '/api/auth'` — ordinary API traffic never carries it, so it is not
  riding in every request's headers waiting to be logged somewhere.

**Nothing in the URL.** After Google's callback the browser is redirected to the
web app carrying no token at all. A token in a query string lands in browser
history, in server access logs, and in the `Referer` header of the next outbound
request. The client trades the cookie for an access token on its first call
instead.

### 2.4 Rotation and reuse detection

Every refresh token is valid exactly **once**. `rotate()` revokes the presented
session and creates its replacement in the same transaction — both halves
together, because a crash between them either leaves the old token live or leaves
the user with no session at all.

If a token is presented that has *already been revoked*, two parties hold the
same value, which can only mean a copy exists. The response is to revoke **every**
session for that user and force a fresh sign-in. That is what makes a stolen
refresh token survivable: the thief and the victim cannot both use it, and
whichever goes second trips the alarm.

`rotatedFrom` on each session row records the chain, so the sequence is
reconstructible afterwards.

### 2.5 Why SHA-256 and not argon2

This reliably comes up, and the reflex answer ("always use a slow hash") is wrong
here.

Slow hashes exist to make *guessing* expensive. Guessing only matters when the
input has low entropy — a human-chosen password. A refresh token is 48 bytes
straight out of a CSPRNG. There is nothing to guess; no hardware brute-forces a
384-bit random value, so the work factor buys nothing.

It would also break the feature outright. Argon2 salts each hash, so the same
input produces a different digest every time and **cannot be looked up by
value** — I would have to scan every session row and verify one at a time. The
lookup here is `WHERE refreshHash = ?` against a unique index. It has to be
deterministic to be queryable.

Note: `argon2` is still in `package.json` from an earlier password-bearing
design. The right answer if asked is that it is unused and should be dropped.

### 2.6 The OAuth handshake: `state` and PKCE

This is the part where I found a real bug, which makes it the best story in the
file.

`@nestjs/passport`'s OAuth2 strategy defaults to a `NullStore` for the `state`
parameter — it generates a value, sends it, and then **accepts whatever comes
back**. That is a login-CSRF hole: an attacker completes half a sign-in flow with
their own Google account, captures the authorization code, and feeds it to a
victim's browser. The victim is silently signed in *as the attacker*, and
everything they then write goes into the attacker's account. I had read a claim
that "Passport handles this by default." It does not.

The fix is `auth/oauth-state.store.ts`, which replaces the null store with a
signed, short-lived cookie carrying both the `state` nonce and the PKCE verifier.

Two details worth knowing cold:

- The cookie must be `sameSite: 'lax'`, not `strict`. Google's callback is a
  cross-site **top-level navigation**, and `Strict` withholds the cookie on
  exactly that — every sign-in would fail state verification. This is one of the
  few places where the lax/strict distinction genuinely decides whether the
  feature works.
- Passport dispatches on function **arity**: `store()` with five parameters and
  `verify()` with three select different internal code paths. Get a signature
  wrong and it silently takes the other branch.

Because verification happens **inside the Passport guard**, before the controller
body runs, a `try/catch` in the handler cannot see the failure. That is why there
is an exception filter (`auth/oauth-failure.filter.ts`) — a user mid-redirect in
a browser needs a redirect back with an error flag, not a JSON body.

### 2.7 PKCE vs the client secret — different problems

The obvious objection: this is a server-side app with a client secret, so isn't
PKCE redundant? No, and the distinction is the whole point.

- The **client secret** proves *which application* is redeeming the code.
- **PKCE** proves *the code being redeemed is the one this browser started*.

The attack PKCE stops — authorization-code injection — is carried out **through a
legitimate client**. The attacker starts a real flow through my app, so my client
secret is used, correctly, on their behalf. The secret authenticates the app, and
the app genuinely is mine; it has nothing to say about which browser the code came
from. PKCE binds the code to a `code_verifier` that never left the originating
session, so a code lifted out of one flow is worthless in another.

`state` and PKCE are also not duplicates: `state` binds the *response* to the
session, PKCE binds the *code redemption* to it. RFC 9700 (OAuth 2.0 Security
Best Current Practice) recommends PKCE for confidential clients for this reason.

### 2.8 Request identity: `AsyncLocalStorage`

A middleware on every route reads the bearer token and stashes `{ userId }` in an
`AsyncLocalStorage` store. Any code at any depth calls `currentContext()`.

The alternative was Nest's request-scoped providers, which are viral: making one
service request-scoped forces every service that injects it to be request-scoped
too. That would have cascaded through four singletons and instantiated the whole
chain per request.

The middleware **never rejects** — it only records. Reading a public story while
signed out has to keep working, so authorization is enforced at the service layer
where the resource is known, not at the door.

### 2.9 Session cleanup

A scheduled job deletes session rows where `expiresAt < now`. Deliberately **not**
revoked rows — a revoked row is precisely what makes reuse detection work. Delete
it and a replayed token looks like an unknown token instead of a theft signal, and
the alarm never fires.

### 2.10 Known gaps — say these before you are asked

- **Multi-tab reuse false positive.** Restore a browser window with five tabs and
  all five call `/auth/refresh` with the same cookie. The first rotates it; the
  other four now present a revoked token and trip reuse detection, logging the
  user out. The client single-flights refreshes *within* a tab, but there is no
  cross-tab coordination. The fix is a short grace window on the immediately
  preceding token, or a `BroadcastChannel` / Web Lock so one tab refreshes for
  all. This is a known trade-off of strict rotation, not an oversight.
- **No audit trail.** The `OutboxEvent` table exists in the schema and is written
  by nothing. When something is destroyed there is no record of it.
- **No automated tests.** Everything here was verified by throwaway scripts
  against the running stack. Those scripts are most of a test suite; they just get
  deleted each time.

---

## 3. Rate limiting

### 3.1 The three questions

Every rate limiter is three decisions. Being able to name them is most of the
interview.

**Who is one caller?** Not the IP. A university, an office, or a mobile carrier
NATs hundreds of people behind one address — limit by IP and one heavy reader
locks out a whole campus, while anyone with a VPN sidesteps it entirely. So
**signed-in requests are keyed to the user id**, which follows a person across
networks and devices. IP is the fallback, because signed-out reading is most of
the traffic and still has to be bounded. The tracker reads the user id out of the
`AsyncLocalStorage` context from §2.8 — the two systems compose.

**Where does the counter live?** Redis, not process memory. The default storage in
`@nestjs/throttler` is a `Map` on the instance, so two replicas behind a load
balancer each enforce their own limit and let through twice the traffic, and every
deploy hands everybody a fresh allowance. Neither is acceptable for a control that
exists to stop abuse.

**How many?** Not one number, because routes do not cost the same:

| Scope | Limit | Block | Reasoning |
|---|---|---|---|
| Everything | 120/min | 1 min | Reading is cheap. Generous enough that real users never see it. |
| `/api/auth/*` | 10/min | 5 min | Nobody legitimately signs in ten times a minute. |
| AI + narration | 6/min | 2 min | Each call costs shared LLM quota and ~28s of CPU. |

The **block duration** is the part people leave out. Without it, hitting the limit
just means waiting for the window to roll and blasting again — a limit in name
only. Sign-in costs five minutes of silence, four times longer than the window it
took to trip.

### 3.2 Algorithm: fixed window, chosen not defaulted

The storage does `PTTL` on a block key, then `INCR` + `PEXPIRE ... NX` + `PTTL` in
a `MULTI`, then `PSETEX` on the block key if the count went over. The `NX` is what
makes it a window rather than a key that lives forever: the first request of a
window sets the TTL, later ones leave it alone. Checking the block key *first*
means hammering while blocked cannot extend your own punishment.

| | State per caller | Redis ops | Burst behaviour |
|---|---|---|---|
| **Fixed window** (chosen) | one integer | 1 round trip | up to 2× the limit across a boundary |
| Sliding window log | sorted set of every timestamp | ZREMRANGEBYSCORE + ZADD + ZCARD | exact; memory grows with traffic |
| Sliding window counter | two integers | 2 reads + write | near-exact, cheap |
| Token bucket | tokens + last-refill timestamp | needs a Lua script | burst to capacity, then a steady drip |

Why fixed window:

1. **`INCR` is atomic for free.** One round trip, no scripting. Token bucket is
   read-modify-write — read the tokens, compute the refill, decide, write back — so
   two concurrent requests both read "one token left" and both pass. It *requires*
   a Lua script to be correct.
2. **The library's storage interface is shaped for a counter.**
   `increment(key, ttl, limit, blockDuration, name)` hands you a TTL and a limit.
   There is no refill-rate parameter and nowhere to put one. Implementing a bucket
   inside it means smuggling the rate in by reinterpreting `limit/ttl` and
   returning a fake `totalHits` — fighting the abstraction in order to reimplement
   it.
3. **The boundary flaw is covered by the block.** 120 requests at t=59 and 120
   more at t=61 is a real weakness. At the browsing tier it does not matter. At the
   tight tiers, exceeding the limit costs a multi-minute block, so the sustained
   average collapses well below the ceiling regardless of window shape.

Where fixed window is genuinely the wrong tool: the **costly tier**. It permits
all six AI requests *simultaneously* — six concurrent 28-second syntheses pinning
the box, which is exactly what the limit was meant to prevent. A token bucket with
capacity 2 and a 6/min refill would force spacing. That is queued work, not a
claim (§5).

### 3.3 The named-throttler trap

I first built this as three *named* throttlers — `auth`, `costly`, `default` —
assuming `@Throttle({ auth: {} })` would **select** the auth limiter.

It does not. In `@nestjs/throttler`, **every named limiter runs on every route.**
Naming one in a decorator overrides its options; it does not choose it. So a plain
"list stories" request was being checked against all three and the tightest one
won — **browsing was silently capped at six requests a minute.**

Caught because a test blocked at request 7 instead of 11. The fix is **one**
limiter with per-route overrides in `throttler/tiers.ts`. No route can now inherit
a limit meant for a different route.

Second trap in the same file: the tier numbers are hardcoded constants, not env
vars, because **decorators are evaluated at module import time — before
`ConfigModule` has read `.env`.** Reading `process.env` there returns `undefined`
and the limit silently falls back to the default. Only the 120/min baseline comes
from env, because it is read inside a module factory where config is ready.

### 3.4 Failure-scoped limiting on `/auth/refresh`

The interesting one, because it starts by asking what the limit is actually for.

The 10/min throttler on `/api/auth/*` has to stay loose, because **my own client
lives on those routes**: every page load fires `refresh` and `/auth/me`, and a
proactive renew lands every fifteen minutes. A single budget shared between the
app's own boot traffic and an attack gets tuned for the app, and is therefore
close to useless against the attack.

So there is a second, much tighter limiter that counts **only failures**: **5 per
10 minutes, then a 30-minute lock**, keyed by IP — a failed refresh has by
definition no authenticated user, since that is what failed.

The asymmetry is what makes so low a threshold safe. Someone guessing refresh
tokens produces *nothing but* failures, so five is all they ever get. A real user
produces essentially none, so they never encounter it.

Four decisions inside it worth defending:

- **A missing cookie is not a failure.** That is what every signed-out visitor
  sends on page load — the client cannot know whether a session exists until it
  asks. Counting it would lock out ordinary browsing within seconds.
- **A server error is not a failure.** Only `UnauthorizedException` counts. If
  Postgres goes down every refresh rejects, and counting those would turn a blip
  into an outage with a thirty-minute tail.
- **`REFRESH_REUSED` is deliberately excluded**, even though it is the theft
  signal. It already triggers the strongest response available — every session for
  that user is revoked — so a rate limit adds nothing on top. And it is the one
  failure an honest user can produce in a burst, via the multi-tab race in §2.10.
  Counting it would lock people out for restoring their browser window. What *is*
  counted is `INVALID_REFRESH` and `REFRESH_EXPIRED`: a token we never issued, or
  one long dead.
- **Success clears the counter**, because a valid rotation proves whoever is on
  that address holds a real token, so the tally so far was noise — an expired
  cookie, a stale tab.

**Which keys it counts on.** Large platforms count a login on several axes at
once — address, account, device, subnet — because any single axis is cheap for
an attacker to change. Two of those axes do not exist here, and inventing them
would be cargo-culting: there is no password, and **a refresh request names no
account**, so an attacker has nothing to target and there is no account
dimension to count. What is left is the network, and that is worth splitting
properly, because IPv4 and IPv6 need opposite treatment:

| Caller | Buckets | Limit |
|---|---|---|
| IPv4 | the address | 5 |
| | its `/24` | 20 |
| IPv6 | its `/64` — **not** the address | 5 |

An IPv4 address is roughly one customer, with the `/24` above it as a looser
ceiling on the whole organisation — far below the 254 × 5 that an attacker
holding the range would otherwise get. An IPv6 `/64` is what a single customer
is normally delegated, and the addresses inside it are free and effectively
unlimited: counting the full address would hand an attacker eighteen quintillion
fresh buckets, so the `/64` *is* the identity.

Any bucket going over locks the caller. A success clears only the personal
bucket — wiping the `/24` too would let one valid session inside a network reset
the ceiling for everyone else in it, which is the ceiling the `/24` exists to
impose.

Verified end to end against the running stack: five garbage tokens return `401
INVALID_REFRESH` and the sixth returns `429 TOO_MANY_ATTEMPTS` with `Retry-After:
1800`; eight cookie-less calls in a row count zero; three failures followed by a
real refresh clears the counter to nothing.

### 3.5 How the two door-side layers interact

The failure limiter trips at 5 and the traffic throttler at 10, so **against an
actual attacker the failure limiter always fires first** — and buys a 30-minute
lock instead of a 5-minute one. The throttler remains the backstop for everything
the failure limiter deliberately ignores: cookie-less calls, `/auth/me` floods,
server errors.

They return different codes — `TOO_MANY_ATTEMPTS` vs `RATE_LIMITED` — so the
client can distinguish "you are locked out" from "you are going too fast."

### 3.6 `trust proxy` — the setting that decides whether any of this works

Express only populates `req.ips` when `trust proxy` is set, and both limiters key
on the caller's address. It is wrong in opposite directions depending on the
deployment:

- **Off, behind a load balancer:** every request appears to come from the
  balancer, so the entire site shares one bucket.
- **On, with no proxy in front:** anyone can set `X-Forwarded-For` and choose
  their own bucket — worse than no limit, because it looks like one.

So it is opt-in via `TRUST_PROXY`, set to the number of proxy hops actually in
front of the API, and empty in local development.

### 3.7 The third limiter: the provider, enforced at the worker

The two limiters above protect *us* — our database, our CPU. This one protects
a resource we do not own: the TTS provider's quota, which on the free tier is
roughly **twenty requests a day across the whole project**. Exceed it and
narration stops working for everybody until tomorrow.

**The key idea: it is enforced where the work happens, not at the door.**

A limiter at the door counts *requests accepted*. That is now the wrong
quantity. Since narration moved onto a queue, accepting a request costs almost
nothing — it writes a row and returns in under 100ms — and one click on
"narrate this story" legitimately accepts two hundred of them. What has to be
bounded is the rate at which the **worker pool calls the provider**, and that is
a different number from the rate at which requests arrive. Once the request and
the outbound call stop being the same event, no limiter at the door can express
the constraint.

So the ceiling lives on the BullMQ worker:

```ts
new Worker(NARRATION_QUEUE, handler, {
  concurrency,                              // how many at once
  limiter: { max: rpm, duration: 60_000 },  // how many per minute
});
```

**Concurrency and rate are two different controls**, and conflating them is the
usual mistake. Concurrency bounds how many syntheses run *simultaneously* —
that protects our own box. The limiter bounds how many *start per minute* —
that protects someone else's quota. Concurrency 2 with no limiter still hammers
a provider that answers quickly; a limiter with unbounded concurrency lets two
hundred jobs start in the same second of a fresh window.

**A 429 is not a failed attempt.** This is the subtlest decision in the queue.
The driver throws `TtsRateLimitedError` carrying the provider's own
`retryDelay`, and the worker treats it unlike every other error:

```ts
if (err instanceof TtsRateLimitedError) {
  await this.worker.rateLimit(err.retryAfterMs ?? 60_000);
  throw Worker.RateLimitError();
}
```

`Worker.RateLimitError()` returns the job to the queue **without spending an
attempt**, and `rateLimit()` pauses the whole pool for as long as the provider
asked. Counting it as an ordinary failure would burn all three attempts on a
queue that only needed to wait — and would burn them fastest exactly when the
provider is most overloaded, since the backoff is measured in seconds and the
quota window in hours.

Three failure classes, three treatments, and naming them is the point:

| Failure | Treatment | Why |
|---|---|---|
| Provider 429 | pause the pool, no attempt spent | not this job's fault, and it will work later |
| Transient error | retry, exponential backoff from 5s | may succeed on its own |
| Chapter deleted | `UnrecoverableError`, no retry | retrying cannot make it exist |

**Fairness, which a rate limit alone does not give you.** A global ceiling makes
starvation *worse*: one reader queuing two hundred chapters holds the entire
pool's throughput, and the tighter the ceiling the longer everyone else waits.
So jobs carry an explicit priority — `INTERACTIVE` for a chapter somebody is
watching a spinner for, `BULK` for whole-branch narration. Set explicitly on
every job, never left unset: BullMQ treats an absent priority as its own class,
so mixing prioritised and unprioritised jobs makes ordering depend on which kind
happened to arrive.

**What it looked like on real traffic**, which is worth telling because it is
the retry logic working rather than a test of it:

```
02:20:37  queued
02:22:37  attempt 1 FAILED - provider hung, hit the 120s timeout
02:24:02  re-queued, exponential backoff
02:24:31  spoke 4081 chars -> 349s of audio
02:24:32  COMPLETE
```

The provider hung on the first attempt and answered in **29 seconds** on the
second. Before the queue, that request would have held an HTTP connection open
until a proxy killed it, and the work would have been lost.

That exposed two gaps, both now closed:

- **No timeout on the provider call.** A hang held a worker slot indefinitely:
  the job never failed, so it never retried, and the reader polled a status that
  would never change. 120s is about four times the longest synthesis observed.
- **A worker dying mid-render left its row `RUNNING` with nothing behind it.**
  The sweeper reconciles rows against the queue, and the two cases need opposite
  treatment: `QUEUED` with no job is **re-queued**, because nothing was spent;
  `RUNNING` with no job is **failed**, because the provider may already have
  billed us and the daily quota is measured in tens. Silently re-spending is
  worse than saying so. That sweeper is the cheap stand-in for a transactional
  outbox — the outbox makes the write and the publish atomic, instead of
  detecting afterwards that they were not.

**So there are three limiters, doing three jobs:**

| Layer | Protects | Counts | Enforced |
|---|---|---|---|
| Throttler (§3.1) | our CPU and database | requests accepted | at the door |
| Failure limiter (§3.4) | our session store | failed refreshes | at the door |
| Queue limiter (§3.7) | **someone else's quota** | provider calls made | **at the worker** |

The first two answer "is this caller asking too often". The third answers "are
we, collectively, calling out too often".

### 3.8 What large platforms do, and what of it applies

Useful to be able to compare against, and more useful to say which parts you
deliberately did *not* copy.

| Their practice | Here |
|---|---|
| The limiter runs at the **edge** (Cloudflare, AWS WAF) before reaching an origin | Adopt at deploy. The app-level limiter is the last line, not the first. |
| **Multi-dimensional keys** — IP, account, device, subnet, ASN, all at once | Adopted, minus the axes that do not exist (§3.4). |
| **Weighted cost per endpoint** — GitHub's API points, Shopify's leaky bucket | Skipped. Two limiters with distinct jobs read more clearly than one weighted budget. |
| **Escalate rather than block** — CAPTCHA, device-confirmation email, step-up 2FA | Not applicable. Google owns the login screen, and a refresh request has no step-up to offer: you either hold a token or you do not. |
| **Account lockout is avoided** — it hands an attacker a denial of service against a named victim | Structurally impossible here; nothing in the request names an account. |
| Credential stuffing defence, breach-password lists, impossible-travel scoring | Not applicable. No passwords. |
| **Explicit fail-open / fail-closed policy** | Adopted (§6). |

The pattern in that table is the point: most published guidance on auth rate
limiting is really guidance on *password* rate limiting. Applying it unchanged to
an OAuth-only system produces machinery that defends nothing.

---

## 4. The data model

### 4.1 Git-shaped, on purpose

`Story` → `Branch` → `Contribution`. A contribution is one chapter-sized chunk
with an author (`HUMAN` or `AI`), a ProseMirror document, and a `depth`. Reading a
branch is one indexed query ordered by `depth`.

### 4.2 Copy-on-write forking

Forking copies **zero rows**. A branch stores:

- `lineage String[]` — the ordered ancestor branch ids, root first, excluding
  self, with a **GIN index** so "everything descended from X" is one query.
- `forkedAtDepth` — how far into the parent the fork was taken.

Reading a forked branch means its own contributions plus each ancestor's up to
`forkedAtDepth`. A fork of a 200-chapter story is one row.

The GIN index is the detail to mention: array containment (`@>`) is exactly what a
generalized inverted index is for, and it is what keeps lineage queries from
degenerating into recursive CTEs.

### 4.3 Contributions are immutable

Never `UPDATE`, never `DELETE`. Corrections are new contributions; removals are
new branches. `@@unique([branchId, depth])` makes the ordering a database
guarantee rather than an application convention.

Immutability is what makes the copy-on-write read safe: ancestors cannot change
under a fork, so `forkedAtDepth` stays meaningful forever. Mutable ancestors would
mean a fork's content silently changing when someone edited upstream.

Audio is kept in a separate `AudioClip` table for the same reason — it is derived
data that can be regenerated, deleted, or produced in several voices without the
chapter itself changing. Unique on (contribution, voice), so asking twice costs
one synthesis.

### 4.4 Publish freezes; revise-and-promote unfreezes

Product rule: **a published story cannot be edited in place.** Readers who
followed chapter 7 must still find chapter 7 there. To change it, the author forks
their own story into a private draft branch (`Branch.isDraft`), edits freely, and
**promotes** it — which repoints `Story.mainBranchId` at the new branch.

Two consequences showing the design is coherent rather than bolted on:

- `Story.mainBranchId` is `@unique` with `onDelete: SetNull`, so a story has at
  most one canonical branch and deleting it degrades rather than corrupts.
- Counters and the contents page follow the **main branch**, not the root — the
  story's identity stays stable while its canonical content moves.

A branch also does not exist until its first chapter is **saved**. Clicking "fork"
creates nothing, so abandoning the idea leaves no orphan row.

### 4.5 Permissions

Enforced in the service layer, where the resource is known, not in a guard:
`ownedStory`, `isMain`, `listVisibility`, `assertReadable`,
`assertNobodyBuiltOn`. Roles are `USER` and `ADMIN`.

The rules that took iteration:

- Anonymous users read public stories; branching, or opening "truyện của tôi",
  requires sign-in.
- Stories are `PRIVATE` by default. Fork policy is declared **at publish time** —
  a private story is never asked whether it allows branching, because the question
  is meaningless.
- A branch can be deleted or unpublished only while it is private **or** nobody
  has forked it. Someone else's work must not vanish from under them.
- Branch deletion is gated on **branch** ownership, not story ownership. Gating on
  the story locked forkers out of their own forks.

Two bugs from this area worth telling, because both were caught by attacking the
running app rather than by reading code:

- `update()` shipped with **no ownership check at all**. Demonstrated by retitling
  another user's story with an unauthenticated request.
- New stories came out `PUBLIC` despite the schema default, because the migration
  was run with `--skip-generate` and the stale Prisma client was still sending the
  old default explicitly.

---

## 5. Deliberately deferred, with reasons

Being able to say why something *is not* built is worth as much as the rest.

- **Dead-lettering, properly.** The narration queue itself is built (§3.7), and
  a failure already lands in three places: BullMQ's `failed` set (with payload
  and stack, evicted after 24h), the `render_jobs` row (permanent, but only the
  fact and a message), and the worker log. So most of a DLQ exists; what is
  missing is not a queue but four smaller things.

  A separate BullMQ queue as a graveyard would be duplicated state - the
  `failed` set already holds the payload and `job.retry()` already replays it,
  and for anything meant to be *kept*, Postgres is the better store: queryable,
  joinable to stories and users, and it survives a Redis flush. The right
  framing is that **`render_jobs` is the dead-letter store and BullMQ's failed
  set is a short-lived detail view of it**.

  What is actually missing:

  1. **A bug, not a design choice.** `narration.worker.ts` decides a failure is
     terminal with `job.attemptsMade >= attempts`. That is unreliable:
     `bullmq/dist/cjs/classes/job.js:450` returns `[false, 0]` for an
     `UnrecoverableError` *without bumping `attemptsMade`*, so a permanently
     failed job has `attemptsMade` of 1 out of 3, the row is never marked
     FAILED, and the reader polls a stale RUNNING until the sweeper catches it
     five minutes later - recording the sweeper's generic message instead of
     the real reason. A stall-out behaves the same way, which is exactly what
     was observed. The fix is to ask rather than infer:
     `(await job.getState()) === 'failed'`.
  2. **Retention.** `removeOnFail: { age: 24 * 3600 }` means a Friday-night
     failure has lost its payload and stack by Monday. Should be about a week.
  3. **A failure taxonomy.** Every terminal failure looks identical on the row.
     Provider outage, deleted chapter and bad voice want different responses,
     and recording a kind (`PROVIDER` / `GONE` / `INTERNAL`) is what makes the
     counts in §5's metrics entry worth looking at.
  4. **Operator replay.** Replay *by a reader* already works - asking again
     reopens a FAILED row through `findOrOpenJob`. There is no way to say
     "re-run everything that failed with this error".

  Where a second queue would genuinely earn its place is not as a graveyard but
  as a **fallback lane**: when the cloud provider fails permanently, route the
  job to a queue served by a different driver - a self-hosted CPU model with no
  quota - so the reader gets some narration rather than none. That is the reason
  the `TtsDriver` interface went in during the first stage, and it is not worth
  building until there is a second driver to fall back to.
- **Transactional outbox relay.** The table exists, the relay does not. It is what
  makes "write the row and publish the event" atomic without a distributed
  transaction, and it doubles as the audit trail §2.10 is missing. Today the
  sweeper in §3.7 detects that gap after the fact instead of closing it.
- **Kafka — deliberately not.** It is a distributed log built for throughput and
  replay across independent consumer groups; narration is a job queue with
  per-job retry, which is what a log is worst at. Its honest slot is as the
  outbox relay's *sink*, if a second consumer of the same event stream ever
  appears — and because the outbox decouples the write from the transport, that
  would be a sink swap rather than a rewrite.
- **Audio still ships as WAV to local disk.** About 2.9 MB per minute, written
  into the web app's `public/` directory by the API process — which works only
  because both run on one machine, and is the hard blocker on deploying at all.
  Opus plus object storage is roughly a 10-20x cut in bytes on every play.
- **`prom-client` + Prometheus/Grafana.** No metrics at all today.
- **Account control and a second provider.** Active-sessions list with revoke
  (every field it needs is already written on the session row and nothing reads
  it), editable display name, and account deletion — which is a schema problem
  rather than a form, because contributions are immutable and other people's
  forks depend on them, so deleting a user has to anonymise the author while
  preserving the chain. Then Zalo as a second OAuth provider, since the coverage
  gap in this market is not people without a Google account but people whose
  identity lives on Zalo — and because one suspended Google client currently
  locks out every user.
- **Username and password — deliberately never.** The hash is an afternoon;
  attached to it are an email provider, a verification flow, a reset flow that is
  the most-attacked surface in any consumer app, user-enumeration defence,
  breach-list checks, and the whole credential-stuffing threat model this system
  does not currently have — which would also flip the fail-open policy in §6 to
  fail-closed. If "sign in with just an email" is ever wanted, a magic link buys
  it with none of that. Revisit only if accounts are needed that are not tied to
  a third-party identity, such as a shared editorial login.

  The interesting consequence of a *second provider* is **pre-account-takeover**.
  An attacker registers first on the weaker provider using a victim's email
  address; the victim later signs in with Google; a system that links accounts on
  matching email hands the attacker an account they planted before the victim
  existed. The rule is: link only on a *provably verified* address, and require
  re-authentication to link. Which is precisely why email verification is not the
  step that can be skipped.
- **Token bucket on the costly tier** (§3.2), as its own guard rather than inside
  the throttler storage — the storage receives an opaque key and a throttler name
  that is `default` for everything, so it cannot cleanly tell which route it is
  serving.
- **Hybrid RAG** — pgvector plus Postgres `tsvector`, fused with Reciprocal Rank
  Fusion. The pgvector image and the `vector` extension are already declared.
- **Yjs CRDT co-editing.** Nothing is broken without it, so it is last.
- **Deployment.** Never deployed. Everything above is local-stack verified, which
  is the honest framing — and it is why no scale numbers appear anywhere in this
  file.

---

## 6. Questions to expect

**"Why not just use a session cookie for everything?"**
Then every API call needs a database lookup, and the API stops being stateless and
horizontally scalable. The split gives stateless verification on the hot path and
revocability on the cold one.

**"Your access token cannot be revoked. Isn't that a problem?"**
Yes, for up to fifteen minutes. That is the trade: statelessness saves a database
round trip per request and costs a bounded revocation delay. If instant revocation
were a requirement, the answer is a denylist of revoked JWT ids in Redis checked
per request — which is buying the round trip back, so only do it if the
requirement is real.

**"Why is the rate limiter in Redis and not in memory?"**
Two replicas each enforce their own limit and let through double; a deploy resets
everyone. Same reason session state does not live in process memory.

**"What happens when Redis goes down?"**
Everything fails **open**, loudly logged, and that is deliberate — note it is the
opposite of the usual advice, which is worth being able to defend.

Fail-closed is right for a *password* endpoint: if you cannot count guesses, do
not allow guesses, because a password is guessable. Nothing here is. Sign-in
belongs to Google, and the only grindable secret in the system is 48 bytes of
CSPRNG output, so an unmetered window costs database load rather than accounts.
Failing closed would instead turn a cache outage into a total outage — nobody
browses, nobody refreshes, every signed-in user is logged out. Availability wins
that trade, and an edge limiter in front of a deployed instance is the backstop.

The answer flips the moment a password exists anywhere in the system. Verified by
stopping the Redis container: browsing still returns 200 and a bad refresh still
returns its normal 401 rather than a 500.

**"How would you scale reads on a forked story?"**
The read is already one indexed query per branch ordered by `depth`, with GIN on
lineage. The next step is caching rendered chapter content in Redis keyed by
contribution id — safe precisely because contributions are immutable (§4.3), so
the cache never needs invalidating.

**"You already had a rate limiter. Why did the queue need another one?"**
Because they bound different quantities. The throttler counts requests
accepted, which stopped being the interesting number once accepting a request
got cheap — it writes a row and returns in under 100ms, and one click can
legitimately accept two hundred. What has to be bounded is how fast the worker
pool calls the provider, and after the work left the request those are no
longer the same event. So the ceiling sits on the worker, not the door (§3.7).

**"How do you keep one user from starving the queue?"**
A global rate limit alone makes that worse — one reader queuing two hundred
chapters holds the whole pool. Jobs carry an explicit priority: interactive for
a chapter somebody is waiting on, bulk for whole-branch narration. Explicit on
every job, because BullMQ treats an unset priority as its own class and mixing
the two makes ordering depend on which kind arrived.

**"A job fails. What happens?"**
It depends which kind of failure, and that distinction is most of the design. A
provider 429 pauses the entire pool for the retry delay the provider asked for
and returns the job **without spending an attempt** — counting it would exhaust
the retry budget on a queue that only needed to wait. A transient error retries
with exponential backoff. A deleted chapter throws `UnrecoverableError`,
because no number of retries makes it exist. And a worker that dies mid-render
leaves a row claiming RUNNING with nothing behind it, which the sweeper
reconciles — re-queueing if nothing was spent, failing if the provider may
already have billed us.

**"What would you do differently?"**
Write the tests as tests instead of throwaway scripts, and deploy earlier. Every
number I could quote about this system is a local one, and that limits what I can
honestly claim about it.
