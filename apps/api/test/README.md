# Runnable checks

Plain Node scripts, not a framework. They talk to a running API and a real
database, because what they check only exists when both are up: a CRDT room
converging between two sockets, a token being refused, the model typing into a
document somebody else is holding open.

Run the API first (`npm run dev` in `apps/api`), then:

    node test/collab-room.js    # auth, convergence, persistence, read-only
    node test/ai-in-room.js     # the model writing into a live room (spends AI quota)

Both create what they need, assert, and clean up after themselves - including
the test user. If one crashes midway it can leave a collaborator row behind,
which will make the next run's "user with no seat" check pass for the wrong
reason; `node -e` the `branchCollaborator` table if a result looks odd.
