# Forking and versioning in Audio Writer

A complete description of how story branching works, written to be read cold —
you should not need the repo open. Everything here is what the code actually
does, not a proposal.

**The product:** a collaborative fiction platform for Vietnamese audio
storytelling. People write chapters; readers **fork** a story into their own
version the way you fork a repo; finished branches get narrated to audio.

**Stack:** NestJS + Postgres 16 + Prisma. All logic below lives in
`apps/api/src/stories/stories.service.ts` and `apps/api/prisma/schema.prisma`.

---

## 1. The shape

Three levels:

```
Story              the work. Owns metadata, visibility, price, fork policy.
  └── Branch       one version of it. Owned by whoever made it.
        └── Contribution   one chapter. IMMUTABLE. Ordered by `depth`.
```

A `Story` has many `Branch`es. One of them is **canonical** — the one readers
land on. Every other branch is somebody's alternate version.

A `Branch` has many `Contribution`s, ordered by an integer `depth` starting at 0.
A contribution is roughly a chapter: a ProseMirror JSON document, its plain text,
a word count, and an author who is either a `HUMAN` or the `AI`.

The single most important property: **a fork copies no chapters.** It writes one
row. How that works is §4.

---

## 2. The schema

Only the fields that matter for forking. Prisma syntax.

```prisma
model Story {
  id           String     @id @default(uuid())
  ownerId      String     // who wrote it
  visibility   Visibility @default(PRIVATE)   // PRIVATE | PUBLIC
  allowForks   Boolean?   // null = never declared
  freeChapters Int        @default(3)
  unlockPrice  Int        @default(0)

  // Denormalised counters, describing the CANONICAL branch, not the root.
  contributionCount Int @default(0)
  branchCount       Int @default(1)
  wordCount         Int @default(0)

  /// The branch readers land on. Null means "the root branch".
  mainBranchId String? @unique
  mainBranch   Branch? @relation("MainBranch", fields: [mainBranchId],
                                 references: [id], onDelete: SetNull)
}

model Branch {
  id      String  @id @default(uuid())
  storyId String
  ownerId String   // the FORKER, not the story owner
  name    String  @default("main")
  isRoot  Boolean @default(false)

  // --- the fork machinery ---
  forkedFromBranchId String?   // direct parent (adjacency list)
  forkedAtDepth      Int?      // inherit ancestor chapters 0..this
  lineage            String[]  @default([])  // ALL ancestor ids, root first

  /// Private working copy. 404s to everyone but its owner.
  isDraft Boolean @default(false)

  headContributionId String?   // last chapter written on THIS branch
  depth              Int @default(0)  // depth of that last chapter

  @@index([lineage], type: Gin)
}

/// IMMUTABLE by rule. Corrections are new contributions; removals are new
/// branches.
model Contribution {
  id       String  @id @default(uuid())
  branchId String
  parentId String?  // previous chapter on this branch — provenance chain
  depth    Int

  title      String?
  authorId   String?
  authorType AuthorType   // HUMAN | AI
  content    Json         // ProseMirror document
  textPlain  String
  wordCount  Int

  @@unique([branchId, depth])
  @@index([branchId, depth])
}
```

Three things to notice:

- `lineage` is a **string array with a GIN index**. That is a materialized path,
  stored as an array rather than a delimited string.
- `@@unique([branchId, depth])` makes chapter ordering a **database guarantee**,
  not an application convention.
- `mainBranchId` is `@unique` **on the Story**. Canonicity is a pointer from the
  story, not a flag on the branch.

---

## 3. Two mechanisms, not one

This is the part that looks inconsistent until you see why. There are two ways a
new branch comes into existence, and they store versions completely differently.

| | `fork()` | `revise()` |
|---|---|---|
| Who calls it | anyone allowed to fork | the story owner only |
| Rows copied | **zero** | **every chapter** |
| `lineage` | `[...parent.lineage, parent.id]` | `[]` |
| `forkedFromBranchId` | the parent | `null` |
| `isDraft` | false — public from the first word | **true** |
| Purpose | a different story | replace the canonical one |
| Cost on a 200-chapter story | 1 insert | 200 inserts |

**Why the asymmetry?** Because a revision is destined to become **canonical**
via `promote()`. If it inherited through `lineage`, the new canonical branch
would read *through* the branch it was meant to replace — and that old branch
could then never be deleted, because deleting an ancestor does not free a
descendant, it breaks it. So a revision is a self-contained snapshot.

**The rule: forks are cheap and dependent; revisions are expensive and
independent. Canonical content never depends on a branch the author wants gone.**

---

## 4. Copy-on-write forking, worked through

Take a real sequence.

**Start.** Phúc writes an 8-chapter story. One branch:

```
Branch A   isRoot=true   owner=Phúc
           lineage=[]    forkedFromBranchId=null   forkedAtDepth=null   depth=7
           contributions at depth 0,1,2,3,4,5,6,7
```

**Mai forks at chapter 5** (depth 4) and writes her own chapter 6:

```
Branch B   owner=Mai
           forkedFromBranchId=A
           forkedAtDepth=4          ← inherits A's chapters 0..4
           lineage=[A]              ← A.lineage ([]) + A
           contributions at depth 5, then 6, 7 as she keeps writing
```

Rows copied: **zero**. Mai's branch owns 3 rows and inherits 5 by reference.

**Nam forks Mai's branch at chapter 7** (depth 6):

```
Branch C   owner=Nam
           forkedFromBranchId=B
           forkedAtDepth=6
           lineage=[A, B]           ← B.lineage ([A]) + B
           contributions at depth 7 onward
```

Rows copied: **zero** again. Three branches, one story, and the only duplicated
data is the chapters people actually wrote themselves.

### How reading resolves

`readableChapters()` walks `lineage` **backwards** — nearest ancestor first —
narrowing a depth cutoff at each step. No recursion, no CTE.

Resolving branch C:

| Step | cutoff | Action | Accumulated |
|---|---|---|---|
| start | `C.forkedAtDepth` = **6** | | `[]` |
| ancestor **B** | 6 | take B's rows where `depth <= 6` → B5, B6 | `[B5, B6]` |
| | cutoff ← `B.forkedAtDepth` = **4** | | |
| ancestor **A** | 4 | take A's rows where `depth <= 4` → A0..A4 | `[A0..A4, B5, B6]` |
| | cutoff ← `A.forkedAtDepth` = **null** → stop | | |
| own rows | — | C's own contributions, depth 7+ | `[A0..A4, B5, B6, C7…]` |

Final read order: **A0 A1 A2 A3 A4 B5 B6 C7 …**

Each ancestor contributes only the slice that existed when the fork below it was
taken. That is the whole trick.

The same function is used by reading, revising, and promoting — deliberately, so
the three can never disagree about what a branch contains.

---

## 5. Writing: how `depth` is chosen

`commit()` picks the next depth with one rule:

```ts
const nextDepth =
  branch.headContributionId !== null
    ? branch.depth + 1                  // continuing this branch
    : (branch.forkedAtDepth ?? -1) + 1; // first write on this branch
```

So:

- Fresh **root** branch: `forkedAtDepth` is null → `-1 + 1` = **0**.
- Fresh **fork** at depth 4: → **5**. It resumes where the inheritance stops.
- Any later chapter: previous depth + 1.

**A branch does not exist until its first chapter is saved.** `fork()` creates
the branch row *and* its first contribution inside one transaction. Clicking
"fork" and then abandoning the idea leaves nothing behind. This was a deliberate
fix — writing the two separately used to leave empty branches lying around.

---

## 6. Immutability, and the three guards on breaking it

The stated rule is that contributions are never updated or deleted. In practice
there is an escape hatch, gated by three checks in `editableChapter()`, applied
in this order:

**1. Branch ownership.** Not story ownership. → `403 NOT_OWNER`

**2. Is this the published canonical version?** If the branch is the story's main
branch *and* the story is not PRIVATE → `409 STORY_PUBLISHED`.

> A published story is a fixed thing to everyone reading it. Readers who
> followed chapter 7 must still find chapter 7 there. To change it, use
> `revise()` → `promote()`, so the swap happens once and visibly.

**3. Has anyone forked from this chapter?**

```ts
const dependent = await prisma.branch.findFirst({
  where: {
    forkedFromBranchId: chapter.branchId,
    forkedAtDepth: { gte: chapter.depth },
  },
});
```

If yes → `409 CHAPTER_INHERITED`. Editing it would change someone else's story
underneath them.

**Why checking only *direct* children is sufficient** — this is subtle and worth
being able to explain. A grandchild's slice of this branch is bounded by its
parent's `forkedAtDepth` (see the cutoff walk in §4). So if a direct child does
not inherit chapter `d`, no descendant of that child can either. One query is
enough; no recursion is needed.

**Deleting a chapter** (`deleteChapter`) runs the same three guards, then adds a
fourth: it must be the **last** chapter on the branch —
`chapter.depth === branch.depth && branch.headContributionId === id`, else
`409 NOT_LAST_CHAPTER`. Removing from the middle would leave a hole that both
`@@unique([branchId, depth])` and the parent chain depend on. Deleting the last
one repeatedly walks the branch backwards; when the branch empties, `depth`
resets to `forkedAtDepth` so the next commit resumes where it did before.

---

## 7. Revise and promote

The flow for changing a published story:

```
1. revise(storyId)
     → reads the main branch's resolved chapters
     → creates Branch D: lineage=[], forkedFromBranchId=null, isDraft=true
     → copies EVERY chapter into D as new rows, re-indexed 0..n-1,
       chaining parentId as it goes
     → D is invisible to everyone but its owner

2. edit chapters on D freely
     (guard #2 doesn't fire — D is not main; guard #3 doesn't fire —
      nobody can fork a draft)

3. promote(D)
     → story.mainBranchId = D          ← atomic pointer swap
     → D.isDraft = false
     → recompute story.contributionCount and wordCount from D
     → the OLD branch A is left completely alone
```

Two consequences worth stating explicitly:

**Promotion does not change what existing forks read.** Mai's branch B still has
`lineage=[A]` and still inherits from A. Her story is untouched by Phúc revising
his. That is also exactly why A can never be deleted.

**The old branch is the historical record.** It is what anyone who forked from it
reads through, and the only trace of what the story said before.

`promote()` requires *both* story ownership and branch ownership (or ADMIN).

---

## 8. Canonical vs fan branches

There is no `is_canonical` boolean. Canonicity is `Story.mainBranchId`, a
**unique foreign key on the story**.

Why that is better than a flag:

- `@unique` makes "at most one canonical branch" a **database constraint**. A
  boolean per branch would need application logic to keep exactly one true, and
  that logic eventually loses a race.
- `onDelete: SetNull` means deleting the canonical branch degrades gracefully —
  main falls back to the root — rather than corrupting.
- Promotion becomes a single FK update instead of two writes that could tear.

A fan fork and the canonical branch are the **same row shape**. Which one is
canonical is a pointer that can move.

Everything else is separate columns, each doing exactly one job:

| Column | Meaning |
|---|---|
| `Branch.ownerId` | a fork belongs to the **forker**, on someone else's story |
| `Branch.isDraft` | private working copy — **404s**, not 403s |
| `Story.visibility` | `PRIVATE` by default |
| `Story.allowForks` | `null` = undeclared; must be answered at publish |
| `User.role` | `USER` / `ADMIN` |

**Ownership is per-branch. Canonicity is per-story. Fork permission is
per-story, declared at publish time.**

Two details behind those:

- **`isDraft` returns 404, not 403.** A 403 would confirm the branch exists,
  telling anyone enumerating branches that the author has a revision underway.
  That is the author's business.
- **`allowForks: null` is not permission.** Undeclared means the fork path
  refuses. A story cannot leave PRIVATE while it is null, so publishing forces
  the writer to answer rather than inherit a default they never saw. Turning it
  off later blocks *new* forks only — retracting work people already built on is
  a much heavier decision.

---

## 9. Deleting and unpublishing a branch

Both are gated by `assertNobodyBuiltOn()`, which queries the GIN index:

```ts
const children = await prisma.branch.findMany({
  where: { lineage: { has: branchId } },   // array containment
});
```

- **Any child with contributions** → `409 BRANCH_HAS_FORKS`. Deleting an ancestor
  does not free a descendant; it breaks it.
- **Your own children with zero contributions** are "disposable" — scaffolding
  from a fork you opened and never wrote in. They are deleted alongside the
  parent rather than blocking it.

`deleteBranch` additionally:

- Requires **branch** ownership, not story ownership — a fork belongs to the
  person who made it, and they must be able to take it down.
- Refuses if the branch is both canonical **and** the root → `409 BRANCH_IS_ROOT`.
  The root is the story's floor; there would be nothing for main to fall back to.
- If it *was* canonical: sets `mainBranchId = null`, falls back to the root, and
  recomputes the story's counters from the root.

`unpublishBranch` is the mirror of promote: sets `isDraft = true`, and if the
branch was canonical, takes the **whole story** private — because a public story
whose only readable branch is a draft has nothing to show and no error that
explains it.

Being published is **not** a reason to refuse either operation. A writer is
allowed to take their own work down. The only thing that removes a branch from
its owner's hands is somebody else having built on it.

---

## 10. The four design questions, answered directly

**Q: How is a version stored on fork — full snapshot, delta, or content-addressed
chunks?**

Neither of the three, exactly. `fork()` copies **nothing** — copy-on-write via
`lineage` + `forkedAtDepth`, resolved at read time. Chapters that *are* written
are stored as full text, not deltas. `revise()` is the one place that takes a
full snapshot, and only because its output becomes canonical.

*Why not deltas:* reads are the hot path — every reader, every chapter, every
narration. Deltas trade cheap storage for expensive reads. Chapters are 1–6 KB;
storage was never the constraint.

*Why not content-addressed chunks (git-style):* git dedupes because you edit the
same file a thousand times. A fiction fork is "the story goes differently from
chapter 5" — everything downstream is genuinely new text, so chunk dedup would
find almost nothing while adding a join and a reassembly step to every read.

**Q: How is the tree structured in Postgres?**

A hybrid: `forkedFromBranchId` is an **adjacency list** for the direct edge;
`lineage String[]` with a **GIN index** is a **materialized path** for ancestry.
Array containment (`@>`) answers "everything descended from X" in one indexed
query, and reads never recurse.

*Not ltree:* good conceptual fit, but ltree labels are restricted to
`[A-Za-z0-9_]` and the ids are hyphenated UUIDs, so you would strip and re-add
separators on every read — plus raw SQL and a custom Prisma type.

*Not a closure table:* the most flexible option, and the only one that makes
re-parenting cheap. Branches never move. It would mean maintaining a second
table on every insert to buy an operation that does not exist.

*Not a plain recursive CTE:* that is what you write when adjacency is all you
have. `lineage` is the denormalization that avoids it.

*The cost:* a materialized path is denormalized. It must be correct at insert
and has no repair path. If a branch were ever re-parented, every descendant's
`lineage` would need rewriting. That is acceptable **only because** branches are
immovable — say that condition out loud when defending the choice.

**Q: What is the unit of forking?**

A **branch of a story, cut at a chapter boundary**: `fork(branchId, { atDepth })`.
Not whole-story, not scene, not paragraph.

The atom is the contribution, which is chapter-sized and immutable — forking
mid-paragraph would mean splitting a row you have promised never to modify. It is
also the unit that owns narration (`AudioClip` is unique on
`(contributionId, voice)`), so a chapter is the smallest thing with a complete
identity.

*The limitation this accepts:* you cannot fork at the third paragraph of chapter
5. You fork at depth 4 and rewrite chapter 5 yourself. The alternative is mutable
contributions, which would break `forkedAtDepth` for every existing fork.

**Q: Canonical vs fan forks — how are they distinguished?**

`Story.mainBranchId`, a unique FK. See §8.

---

## 11. Known problems

Real, currently true, and worth naming before someone else does.

1. **`revise()` is O(n) inserts.** A 200-chapter story copies 200 rows in one
   transaction. Fine now; wrong at 1,000 chapters, which Vietnamese web novels
   reach.

2. **Reading is O(depth) round trips.** `readableChapters()` issues a `findMany`
   *plus* a `findUnique` per ancestor inside a loop. A deep fork chain is a lot of
   sequential queries. It could be one query with `branchId IN (…)` and
   per-branch cutoffs applied in memory, or a single recursive CTE.

3. **The "override at depth" path is unreachable.** `readableChapters()` filters
   inherited rows against `ownDepths` — "a branch overrides its ancestors at any
   depth it has written itself." No current write path can produce that state:
   `commit()` always appends past `forkedAtDepth`, `fork()` starts at
   `atDepth + 1`, and `revise()` has no lineage at all. It is defensive code for a
   feature that does not exist yet.

4. **`Contribution.parentId` is largely redundant** given `depth` plus
   `@@unique([branchId, depth])`. It carries provenance, not structure.

5. **Counters are denormalized** (`contributionCount`, `wordCount`,
   `branchCount`) and recomputed on write. They describe the **canonical** branch,
   not the root — which was a bug once: they used `branch.isRoot` everywhere, and
   froze on a branch nobody read as soon as a revision was promoted.

6. **No audit trail.** An `OutboxEvent` table exists in the schema and nothing
   writes to it. When a branch is deleted there is no record.
