# ADR-0016: Theme PATCH merges field by field; arrays are replaced whole

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

- **Blast radius:** `PATCH /agents/:id/theme` callers. The dashboard editor saves with PUT, the whole theme, and is not affected.
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
- Stored starters are trimmed when read through the schema.
- `patchTheme` still reads, merges and writes without a row lock, so two concurrent PATCHes to one theme can overwrite each other. That is unchanged by this ADR.
