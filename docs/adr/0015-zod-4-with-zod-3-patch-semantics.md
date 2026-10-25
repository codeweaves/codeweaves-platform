# ADR-0015: Zod 4, with Zod 3 PATCH semantics kept

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Dhruv Khator

## Context

Dependabot alerts 8 and 15 (high): "Zod can exhaust memory while validating oversized constrained collections". The only fixed version is zod 4.6.6. There is no zod 3 patch. We were on zod 3.25.76 in `apps/api` and `packages/validation`, which the API, the dashboard and the stored-config parsers all share.

Zod 4 changes behaviour in ways that pass the type checker:

- A `.default()` inside `.optional()` or `.partial()` now applies when the field is omitted. Zod 3 left the field out.
- `.default({})` returns the `{}` as it is. Zod 3 parsed it, so nested defaults filled in.
- `.uuid()` now requires an RFC 9562 version and variant. Zod 3 accepted any hex 8-4-4-4-12.
- `.deepPartial()` is removed.
- The built-in error messages are reworded.

Our PATCH schemas depend on the first two. A straight upgrade would make every agent update set `allowedDomains: []` (and an agent with no allowed domains blocks its widget), and an AI-config PATCH would reset PII redaction, RAG and sampling settings to their defaults.

## The four questions

- **Blast radius:** every request body and query the API validates, every stored theme and AI config read through a schema, and the dashboard forms that share `@repo/validation`. A wrong default silently overwrites saved customer settings.
- **One-way or two-way door:** two-way. It is a dependency version and a small helper module. Rolling back means pinning zod 3 again and accepting the open advisory.
- **Couples us to:** zod 4's object and default model, and `z.guid()` as our id format.
- **Cost of waiting:** an open high-severity advisory on the API's request validation.

## Decision

We use zod 4.6.6 and keep zod 3 behaviour wherever a change would reach stored data or clients:

| Rule                                                 | How                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A PATCH carries only the keys the client sent        | Build PATCH schemas with `patchOf()` (one level, like zod 3 `.partial()`) or `deepPatchOf()` (like zod 3 `.deepPartial()`) from `packages/validation/src/patch.ts`. Never `.partial()` a schema that has defaults. |
| No default sits inside an optional field             | Shared list schemas carry no `.default()`. A default belongs on the field that needs it, not on a reusable schema.                                                                                                 |
| A defaulted object section fills its nested defaults | `.prefault({})`, not `.default({})`.                                                                                                                                                                               |
| Ids are any hex 8-4-4-4-12                           | `z.guid()`, not `z.uuid()`. It matches what zod 3 accepted and what a Postgres `uuid` column accepts.                                                                                                              |

`apps/api/test/models/zod-optional-default.spec.ts` enforces the first two rules. It walks every exported schema in `@repo/validation`, `src/models` and every `*.dto.ts`, and fails on any optional field that would reach a default.

We accept zod 4's reworded built-in error messages. Our custom messages are unchanged.

## Options rejected

### Stay on zod 3

**Good:** no migration and no risk of behaviour change.

**Rejected because:** the advisory has no zod 3 fix, and the API validates untrusted request bodies with these schemas.

### Import `zod/v3` from the zod 4 package

**Good:** zod 4 ships the zod 3 implementation under `zod/v3`, so the upgrade would be a one-line import change with exactly the old behaviour.

**Rejected because:** that subpath is the legacy implementation zod no longer develops. The advisory names the 4.6.6 release, and we could not show that its fix covers the v3 layer.

### Adopt zod 4 semantics as they are

**Good:** idiomatic zod 4, no helper module.

**Rejected because:** omitted PATCH fields would be reset to defaults and would overwrite saved settings, as described above.

### Merge only the keys present in the raw request body

**Good:** PATCH handling would not depend on any validator's optional/default semantics.

**Rejected because:** it changes every update service at once. The schema-level fix keeps the services as they are and was proven equivalent: develop's schemas on zod 3 and these on zod 4 gave the same result on 1851 cases built from stored themes, AI and voice configs, agents and every PATCH shape.

**Revisit if:** we move away from zod, or PATCH bodies grow beyond what a schema helper can express.

### Strict `z.uuid()`

**Good:** rejects malformed ids earlier.

**Rejected because:** it would turn ids that zod 3 accepted into 400s. Every id we generate is a valid v4 UUID, so the stricter check buys nothing.

## Consequences

- The zod advisory is closed.
- A new PATCH schema must use `patchOf()`/`deepPatchOf()`, and the guard test fails CI if a default ends up inside an optional field.
- `ZodValidationPipe` is generic and returns the schema's output type instead of `any`.
- 400 responses and dashboard form errors that use zod's built-in texts read differently (for example "Required" becomes "Invalid input: expected string, received undefined").
- `patchOf()`/`deepPatchOf()` build on `.extend()`, which zod 4 refuses on an object with refinements. Adding a refinement to a schema that a PATCH schema is built from fails at startup and needs the PATCH schema built from the unrefined object.
- Two zod 3 behaviours are kept on purpose and are worth fixing separately: a theme PATCH that sends part of the `handover` section fills that section's own defaults, and a theme PATCH accepts `starters: [{}]`.
