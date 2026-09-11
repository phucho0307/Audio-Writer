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

The store is per-request and is supposed to vanish with it. It does not quite:
it follows async execution across awaits and microtasks, which is what makes it
work at all and is also how an identity once leaked into a background job that
had no business having one. That story is §3.11, and it is the sharpest thing
to know about this mechanism.

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

## 3. Rate limiting, and the narration queue

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

### 3.8 Job identity, and what the queue is not

Three systems are involved in narration and they know nothing about each other.
The code is what joins them, and confusing them is the fastest way to reason
wrongly about this.

| | Holds | Role |
|---|---|---|
| **Redis / BullMQ** | jobs | a to-do list of work not yet done |
| **Disk** (later object storage) | the `.wav` bytes | where audio actually lives |
| **Postgres** | `audio_clips` rows | the source of truth about what audio exists |

**Serving audio never touches the queue.** A reader asking for chapter 42 is a
Postgres lookup that yields a path. The queue exists only to control the
one-time work of *creating* audio that does not exist yet. Redis could be
flushed tomorrow and every existing narration would still play.

### Deterministic job ids

Jobs are identified by what they are, not by when they were asked for:

```
audio:<contributionId>:<voice>      e.g. audio:8e28f78c-…:Kore
```

The point is deduplication. Three impatient clicks produce the same id, and
BullMQ collapses them into one job rather than three calls to a provider whose
free tier is measured in tens of requests a day.

### The quirk that cost an afternoon

**`queue.add()` with an id that already exists does nothing, and says nothing.**
No error, no warning, a successful return, and no job. That is how BullMQ
implements "do not queue the same thing twice", and it is correct behaviour -
but it interacts badly with the fact that **finished jobs keep their ids until
they are evicted.**

Retention here is set in `narration.queue.ts`:

```ts
removeOnComplete: { age: 3600, count: 500 },   // an hour, or 500 jobs
removeOnFail:     { age: 24 * 3600 },          // a day
```

So for an hour after a success, and a day after a failure, that id is occupied
by a record doing nothing except existing. Add a job with the same id in that
window and it is silently dropped. The row is set to QUEUED, the reader polls,
and the status never changes - because there is no job.

### Why a completed job blocks exactly as hard as a failed one

This is the part that reads as surprising, and the word "retry" is what makes
it confusing. Nothing is being retried. A **new** job is being created that
happens to carry the same deterministic id as one that already finished. That
the previous job succeeded is irrelevant; what matters is that the id is
occupied.

**And the id does not include the content hash.** A clip is addressed by
`sha256(fingerprint + voice + text)` (§3.7 and the data model), but a job is
addressed by contribution and voice only. Change `TTS_MODEL` and every hash
changes - so the content check correctly misses and every chapter genuinely
needs re-synthesising - while every *job id* stays exactly what it was. A
regeneration pass over two hundred chapters would report complete success and
produce nothing at all.

That is the scenario that makes the fix load-bearing rather than theoretical.

### The fix

Evict the ghost, but never disturb live work:

```ts
const previous = await this.queue.getJob(jobId);
if (previous) {
  const state = await previous.getState();
  if (state === 'completed' || state === 'failed') {
    await previous.remove();          // a finished record squatting on the id
  } else {
    return jobId;                     // genuinely waiting or running
  }
}
await this.queue.add(NARRATE_CHAPTER, job, { jobId, priority });
```

Waiting, delayed or active means a job is really in progress, and two callers
watching one piece of work is the intended behaviour. Completed or failed means
the id is held by a record with no future, and it goes.

### The two paths, kept apart

```
READ  (frequent, cheap, no queue)
  request -> Postgres: clip for (contribution, voice)? -> path -> bytes

CREATE (rare, expensive, queued)
  request -> clip for this contribution?          -> no
          -> clip with this content hash anywhere? -> no
          -> queue.add
             worker -> provider -> write bytes -> insert clip row
```

Both short-circuits happen in the request, before anything is queued, which is
why a promoted revision queues zero jobs rather than two hundred that each wake
up and discover they are redundant.

**In one sentence:** audio is tracked by Postgres and stored as files; jobs live
in Redis and only govern the one-time work of creating audio, and because
finished jobs keep their ids, a new job with a reused id has to evict the old
record first or it is silently dropped.

### 3.9 Delivering the audio: codec and storage

Two problems that share one write path, and the second one is what blocked
deployment entirely.

### Where the file goes

The API was writing `.wav` files into **the web app's** `public/` directory.
That works only while both processes share a filesystem, which stops being true
the moment either is containerised or replicated: the API produces files nobody
can serve, a second replica cannot see what the first one wrote, and a deploy
replaces the container and takes the files with it.

Storage is now an interface with two implementations, `LocalDiskStorage` and
`R2Storage`, chosen by **whether `R2_BUCKET` is set** rather than by
`NODE_ENV`. That distinction is deliberate: `NODE_ENV` is a label anybody can
set, and a developer setting it to `production` to test something should not
cause uploads to a bucket that does not exist. Configuration should be decided
by what actually exists, not by what an environment claims to be.

The half-configured case is the dangerous one - `R2_BUCKET` set but credentials
missing - because it fails inside a worker, one upload at a time, long after
the mistake was made. It is checked at **boot**, logged as an error naming the
missing variables, and falls back to disk.

**R2 rather than S3**, for one reason that dominates every other
consideration: audio is almost entirely egress, and R2 charges none of it. At
any real number of listeners the bandwidth bill exceeds the synthesis bill, and
audio is the one kind of content where that is true early.

### What a codec is, and why one is needed here

Gemini returns raw PCM: 24 kHz, 16-bit, mono. That is 384 kbit/s, about
**2.9 MB per minute**, so a six minute chapter shipped **16 MB** - on every
single play, to a phone, on a mobile network.

A codec exploits the fact that hearing is imperfect: frequencies too high to
resolve, quiet sounds masked by loud ones nearby. Discard what cannot be heard
and the file shrinks by an order of magnitude with no audible difference. It is
compression shaped around the ear rather than around the bytes.

| | AAC | Opus |
|---|---|---|
| Standardised | 1997 | 2012 |
| Quality per byte | good | roughly twice as good |
| Playback from a file | universal | patchy, Safari and iOS especially |
| Live / WebRTC | fine | excellent, very low latency |
| Containers | `.m4a`, `.mp4` | `.opus`, `.ogg`, `.webm` |
| Typical home | music, video, podcasts | voice chat, calls |

**AAC was chosen, and Opus is the better codec.** Opus at 32 kbit/s sounds like
AAC at 64 - about half the bytes for the same thing. The reason it lost is not
technical merit:

> The audience is mobile-heavy and Vietnamese, which means a lot of iOS. Opus
> is excellent over WebRTC on Safari and unreliable as a *file* handed to an
> `<audio>` element there. A file half the size that sometimes will not play is
> far worse than one that always does.

If the problem were live two-way voice, the answer would be Opus without
hesitation. It is a different problem, so it gets a different answer - and that
is the part worth being able to explain, rather than the codec names.

Measured across five chapters:

```
WAV   58.4 MB   ->   m4a   10.2 MB      5.7x smaller
```

and the result verified rather than assumed: brand `ftypM4A`, AAC-LC, 24 kHz
mono at 66 kbit/s, with **faststart confirmed** - the `moov` index sits before
`mdat`, so a player can begin before the file finishes arriving. Without that
flag the index lands at the end and playback waits for the whole download.

Opus can still be added later as a second rendition behind a `<source>`
element. Storage is keyed by content hash, so both can coexist without either
overwriting the other.

### ffmpeg, without making anyone install ffmpeg

Encoding needs ffmpeg, and requiring a system install on every machine and in
every image is friction that gets skipped. The binary comes from the
`ffmpeg-static` package instead, resolved in order: `FFMPEG_PATH` if set, then
the bundled binary, then whatever is on `PATH`.

If none exists the encoder **passes the WAV through untouched** rather than
failing. Narration that ships a large file is worth more than narration that
does not ship, and this is a degradation a reader can live with. A *broken*
encode is different and does propagate, because silently storing wrong bytes
under a content hash would poison every future lookup of that hash.

### A timeout that was measuring the wrong thing

The provider call had a 120 second limit. A chapter failed against it twice and
then succeeded at **195 seconds**, so the timeout was killing work that was
slow rather than stuck - and every abort still cost a synthesis against a quota
measured in tens per day.

The number was not wrong when it was written. It came from the era when a
reader sat on the open HTTP request, where two minutes genuinely was the limit
of what a person would tolerate. Once the work moved onto a queue that premise
disappeared and nobody rechecked the number.

It is now 300 seconds and configurable, with the intent recorded in the code so
the next person does not tune it back down:

> **This is a deadman switch, not a latency budget.**

Patience costs nothing when nobody is waiting; impatience costs a wasted
attempt and a re-billed synthesis.

### The near miss

The re-encoded files were staged for commit - 13 MB of binary that would have
sat in history forever, since removing a blob later does not remove it from
every clone. `.gitignore` said *"generated media - never commit"* and listed
`*.wav`, `*.mp3`, `*.mp4`. The new extension simply was not in it.

The branch was unpushed, so amending fixed the instance. The more useful fix
was structural: ignore **the directory** rather than chasing extensions, so the
next format cannot slip through the same gap. Narration is derived data - it is
regenerable from the chapter text and addressed by a hash of it - so none of it
belongs in the repository at any size.

The `.wav` originals were kept as masters rather than deleted. Re-encoding from
them at a different bitrate, or to Opus, costs nothing; re-synthesising costs
provider quota.

### 3.10 What large platforms do, and what of it applies

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


### 3.11 Events: why publishing does not call narration

Publishing a story should start narrating it. The obvious way is for the story
service to call the TTS service, and there are two separate reasons it cannot.

**The import direction already means something.** `TtsModule` imports
`StoriesModule`, because narration has to read chapters. Having stories import
TTS as well is a cycle, and Nest refuses to boot. `forwardRef()` would silence
it, but the direction is telling the truth: narration is a consumer of story
data, and publishing has no reason to know narration exists.

**And a primary action must not fail for a secondary effect.** `await
tts.narrate(storyId)` inside publish means that if Redis is unreachable, or the
queue is misconfigured, the *publish* returns an error. The story was saved and
the visibility did change; the writer is told it failed and tries again. Their
action is being rejected for something that has nothing to do with it.

So the story layer announces what happened and stops caring:

```ts
this.events.emit('story.published', { storyId: updated.id });
```

`NarrationPrerender` subscribes in `TtsModule`, where importing stories is
already allowed. Nothing imports in the other direction.

```
update()  ──emit──▶  DomainEvents
                          │
                          └──▶ NarrationPrerender   (today, the only listener)
                               …analytics, search indexing, notification
                                 could subscribe later, changing nothing here
```

Both problems close at once: no cycle, and handler failures are caught inside
the emitter, so they cannot reach the request that triggered them.

Hand-rolled rather than `@nestjs/event-emitter` — it is about sixty lines, the
two behaviours that matter are ones I wanted to be explicit about, and adding a
dependency to get a decorator was not worth it.

### What it deliberately does not give you

Worth saying plainly, because event buses get described as free and they are
not:

- **No durability.** Events live in this process and die with it. A crash
  between the database write and the handler loses the reaction entirely. That
  is exactly the gap a transactional outbox closes, and `outbox_events` is
  already in the schema waiting for it. Until then the rule is that **nothing
  may depend on an event as its only path**: pre-rendering is an optimisation,
  and a reader asking for a chapter still queues it the ordinary way.
- **No completion guarantee.** `emit` dispatches synchronously but handlers are
  async and unawaited, so `update()` returns without knowing whether narration
  was queued. That is the point — it is what stops a queue outage from failing
  a publish — but it means the response cannot report on it.

### The bug underneath: identity crossing an async boundary

This is the part worth remembering, and it is invisible in code review.

`AsyncLocalStorage` (§2.8) carries the caller's id through a request. It
survives the microtask queue — that is what makes it work across awaits. So a
handler *scheduled from inside a request* inherits whoever made that request,
even though the request is conceptually over.

Publishing therefore pre-rendered **as the story's owner**. And `readBranch`
answers differently depending on who asks:

| Asking | Gets |
|---|---|
| anonymous visitor | the free chapters only |
| the owner | **every chapter** — the paywall does not apply to your own work |

So instead of the two free chapters, publishing a two-hundred-chapter novel
would have queued **two hundred syntheses**, against a provider quota measured
in tens per day. It would not have raised an error. It would have looked like
the project mysteriously running out of quota, a day later, for no visible
reason.

The fix is one line, placed in the **emitter** rather than in the handler, so
every future listener inherits it without anybody having to remember:

```ts
requestContext.exit(() => { void handler(payload); });
```

The principle it encodes:

> A reaction to something that happened is not performed on behalf of whoever
> triggered it, so it gets no identity at all. Anything a handler is allowed to
> do, it must be allowed to do as nobody.

Depositing a cheque may trigger a fraud check. The fraud check is not acting on
the depositor's behalf and does not get their credentials — it is the bank's
own process.

### The elegant conclusion that was wrong

Because pre-rendering runs as nobody, it renders exactly what an anonymous
visitor can read — so the obvious conclusion was that **the paywall decides how
far it goes, and no `PRERENDER_CHAPTERS` setting is needed.** Two features
sharing one rule; a design rather than a configuration option.

The test agreed. It published a five-chapter story with two free chapters and
asserted the pre-rendered set was exactly `[0, 1]`, and it passed.

It passed because the fixture set `unlockPrice: 10`. **`unlockPrice` defaults to
zero**, an ungated story is readable to the last chapter by anybody, and
`readableDepth()` returns `POSITIVE_INFINITY`. Re-run against the default:

```
6 chapters, freeChapters=3, unlockPrice=0 (the default)
walked depths: [0, 1, 2, 3, 4, 5]      ← every chapter
```

Publishing a two-hundred-chapter free story would have queued two hundred
syntheses — the identical failure the identity fix was believed to have closed,
arriving through the front door instead. The fix was real; the conclusion drawn
from it was not. Free is the *default* configuration, so the case that was never
tested is the one almost every story is in.

The error is worth naming precisely, because it is not a typo:

> **The paywall answers who may read a chapter. It does not answer what is worth
> spending to render one.** Those are an authorization question and a cost
> question, and collapsing them was what made the design feel elegant.

### What replaced it

A flat `PRERENDER_CHAPTERS`, default **3**, for every story regardless of length
or pricing. The number that felt inelegant is the correct one, and three is
enough for a structural reason rather than a tuned one:

```
stranger opens a story   →  ch.1 already rendered      (pre-render, at publish)
presses play             →  ch.2 queued immediately    (prefetch)
~6 minutes of ch.1       →  ch.2 lands in 29–195 s     (comfortably ahead)
presses next             →  ch.3 queued
```

Pre-rendering only has to bridge the gap until prefetch takes over, which is one
chapter; the other two are margin for a reader who skips ahead. Everything past
that is covered by a loop that already works, and paying for it in advance is
paying for chapters most visitors never reach.

The property that matters is not the value but its shape: **publishing costs a
constant, not a function of book length.** A three-chapter story and a
three-hundred-chapter one now cost the same to publish, which is the only
version of this that survives a writer arriving with a finished novel.

### How it was caught

Not by reading the code, which looked right. The first test passed — a story
published, a job queued, audio produced. The tell was one field in the output:

```
job userId: 3d948b38-…     ← expected null
```

The test asserted on something nobody had asked about, the answer was wrong,
and that was the whole thread.

Two general defences, one for each half of this:

- **Identity.** This class of bug is common in event-driven systems and has a
  large blast radius. At every async boundary, ask what identity is in the store
  right now and whether it should be.
- **Fixtures.** The regression test for the identity bug passed while the same
  catastrophe remained wide open, because its fixture priced the story and the
  schema default does not. **A fixture that sets a field is not testing the
  default.** Where a default is the case almost every row is in, that is the
  case worth writing down first.

---

### 3.12 Who pays for narration

Synthesis is the one operation on the platform with a hard external cost and a
hard external ceiling, so the question of who is charged for it is a design
decision rather than a billing detail. It has to be answered before the quota
code is written, because the wrong answer is easy to implement and hard to walk
back.

### The rule: narration belongs to the story, not to the listener

Pre-rendering happens at publish. Prefetch happens when a *reader* presses play
on the previous chapter. Charging whoever triggered the work is the obvious move
and it is wrong on three counts:

- **They did not ask for it.** Prefetch is speculative. The reader clicked
  chapter one; chapter two was the system's idea.
- **Early readers subsidise late ones.** Reader #1 pays for chapter two and
  readers #2 through #1000 get it free, which is an arbitrary tax on being early.
- **It meters consumption.** Listening should stay free and unmetered. Serving
  an existing file costs almost nothing, and it is the part that makes stories
  spread.

So: **the branch owner pays for narration of their branch, whoever triggered
it.** For the main branch that is the author; for a fork it is the forker, which
is the right answer because a fork is someone else's story living here.

> Creation is metered. Consumption is not.

This also dissolves the abuse worry that prompted the question — publishing a
story to get it narrated, then unpublishing. Publishing *is* the legitimate way
to spend narration quota, priced identically to every other route, so there is
no trick left to play.

### The tiers

| | Free | Reader premium | Author premium |
|---|---|---|---|
| First 3 chapters of any story | ✓ | ✓ | ✓ |
| Narration beyond chapter 3 | on demand, queued | any chapter, any story | — |
| Whole book rendered at publish | — | — | ✓ |
| Queue priority | bulk | interactive | ahead of both |
| Voice selection | default | multiple, regional | per story |
| Offline download | — | ✓ | ✓ |
| Listener analytics | — | — | ✓ |

**The free tier is the acquisition tool, and it is why `PRERENDER_CHAPTERS` is
flat.** Three narrated chapters exist for every published story, paid for by the
platform, because a stranger who presses play and hears nothing does not come
back. That cost is a constant per story rather than per chapter, which is the
only reason it is affordable to give away at all.

**Reader premium sells latency, not access.** Every chapter can be narrated by
anyone; what a subscriber buys is not waiting — their jobs enter at
`PRIORITY.INTERACTIVE` rather than `PRIORITY.BULK`. That distinction already
exists in the queue, so the tier is a policy on top of built mechanism rather
than new machinery.

**Author premium sells the thing that costs real money**, which is rendering a
whole book up front against a quota measured in tens per day. It is priced above
reader premium for that reason and no other.

### What this implies that is not built yet

- `EntitlementKind.TTS_CREDITS`, charged in `enqueueOne` against
  `branch.ownerId` — explicitly *not* the caller, and not the anonymous identity
  the handler runs under. Permission and billing are separate lookups, and §3.11
  is the story of what happens when two questions get collapsed into one.
- **Cache hits are free.** Content-addressed audio (§3.6) means a fork that
  changed nothing charges nothing, which has to be true or forking becomes
  expensive for no reason.
- Reserve on enqueue, commit on success, **release on failure** — a provider
  timeout must not bill a narration that does not exist.
- A third priority band above `INTERACTIVE` for author premium.

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
