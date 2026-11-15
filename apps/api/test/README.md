# Runnable checks

Plain Node scripts, not a framework. They talk to a running API and a real
database, because what they check only exists when both are up: a CRDT room
converging between two sockets, a token being refused, the model typing into a
document somebody else is holding open.

Run the API first (`npm run dev` in `apps/api`), then:

    node test/collab-room.js    # auth, convergence, persistence, read-only
    node test/draft-commit.js   # commit, the ghost-row race, invite edges
    node test/collab-branching.js  # who may append where; a guest's chapter becomes their own branch
    node test/ai-in-room.js     # the model writing into a live room (spends AI quota)
    node test/rag-search.js     # indexes the craft corpus, then queries it
    node test/rag-pipeline.js   # a committed chapter indexes itself and is retrievable

Running them back to back can trip the rate limiter, which is the limiter
working. `rag-search.js` reports that as SKIPPED rather than as a failure - an
earlier version called it a retrieval bug and sent me looking for one that was
never there. To clear the counters between runs:

    docker exec aw-redis sh -c 'redis-cli --scan --pattern "throttle:*" | xargs -r redis-cli DEL'

Both create what they need, assert, and clean up after themselves - including
the test user. If one crashes midway it can leave a collaborator row behind,
which will make the next run's "user with no seat" check pass for the wrong
reason; `node -e` the `branchCollaborator` table if a result looks odd.
