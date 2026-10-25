# ADR-0016: Theme writes: PATCH merges field by field, arrays whole, one write at a time

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Dhruv Khator

Amends ADR-0015 for `deepPatchOf()`. The rest of ADR-0015 stands.

## Context

ADR-0015 kept zod 3's `.deepPartial()` behaviour for the theme PATCH schema. That behaviour had two bugs:

- A defaulted section (`handover`) was parsed whole when sent. A PATCH of `{ handover: { buttonLabel } }` filled the section's other fields with defaults, and the merge wrote them over the client's saved labels. `consent` had the same problem and was patched by hand in `theme.ts`.
- Array elements were made partial, so `starters: [{}]` passed and was stored, although the merge replaces an array whole.

Most stored themes have no `handover` key, and some have one without its newer fields, so the merge also has to start from defaults.

## The four questions

- **Blast radius:** the PATCH rules affect `PATCH /agents/:id/theme` callers only; the dashboard editor saves with PUT, the whole theme. The write lock affects every theme write (PUT, PATCH, reset): writes to one agent now wait for each other.
- **One-way or two-way door:** two-way. The change is one helper and one merge step.
- **Couples us to:** nothing new.
- **Cost of waiting:** saved handover wording can be overwritten by any partial PATCH.

## Decision

| Rule                                                      | How                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A PATCH carries only the fields it sent, in every section | `deepPatchOf()` makes every object field optional and removes defaults at every level, defaulted sections included.                  |
| An array in a PATCH is a whole new value                  | `deepPatchOf()` leaves arrays as they are, so each element must be valid. `starters: [{}]` and a whitespace-only starter return 400. |
| A section the PATCH touches is stored complete            | `patchTheme` starts each touched section from its defaults, puts the stored values on top, then merges the PATCH.                    |

## Options rejected

### Keep zod 3's deepPartial behaviour (ADR-0015)

**Good:** no behaviour change at all during the zod upgrade, which kept that PR easy to verify.

**Rejected because:** it overwrites saved handover wording and stores empty starters.

### Parse the merged theme through `widgetThemeSchema` before storing

**Good:** one general step that fills every default and validates the whole result, as `withNormalizedConsent` does for consent.

**Rejected because:** a stored theme with an old value the current schema rejects would turn every PATCH on it into a 400, including a PATCH of an unrelated section. Filling defaults per touched section cannot throw.

**Revisit if:** stored themes are migrated to the current schema, so a full parse is safe.

## Consequences

- Partial handover and consent PATCHes keep the client's saved wording.
- A PATCH client that sent partial starter objects now gets a 400 and must send each starter whole.
- Starter messages are trimmed when a theme is written.
- Theme writes to one agent run one at a time (see "Concurrent writes" below). Each write holds the agent row lock for one short transaction, with a 15 s timeout instead of Prisma's 5 s, because writes queue on the lock.
- Still open: two people editing the same theme in the dashboard. The editor saves with PUT, the whole theme, so the second save writes its stale copy over the first person's change even with the lock. That needs a version check (the client sends the version it edited, the API answers 409 if it changed) and a "reload" message in the editor.

## Concurrent writes

`patchTheme`, `updateTheme` and `resetTheme` each read the stored theme and write back a result built from it (a merge, or the branding and privacy notice the caller may not change). Two concurrent writes read the same version, and the later one dropped the other's change.

Each write now runs in a transaction that first takes `SELECT ... FOR NO KEY UPDATE` on the agent row, then reads and writes the theme.

- The **agent** row, not the theme row, because the first write happens before a theme row exists.
- **`FOR NO KEY UPDATE`**, not `FOR UPDATE`, because a foreign-key check takes `FOR KEY SHARE` on the agent row. `FOR UPDATE` would block every new chat session for the agent while a theme saves; `FOR NO KEY UPDATE` does not. An e2e test on real Postgres checks both: concurrent PATCHes all land, and a row referencing the locked agent inserts without waiting (with `FOR UPDATE` it blocks).

### Rejected: optimistic version check with retry

**Good:** no lock is held, so nothing ever waits, and the same `version` check is what the dashboard case above needs.

**Rejected because:** under contention each write retries until it wins, so the server needs a retry loop with a cap, and a capped loop can still fail a write. The lock is simpler and certain for the server-side merge.

**Revisit if:** the dashboard version check is built. Server-side writes could then use the same check.

### Rejected: advisory lock on the agent id

**Good:** touches no table row, so it cannot interact with foreign-key locks at all.

**Rejected because:** it needs an id-to-integer mapping and is invisible in the schema; `FOR NO KEY UPDATE` already avoids the foreign-key conflict.
