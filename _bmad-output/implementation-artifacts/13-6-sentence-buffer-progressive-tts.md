# Story 13.6: Sentence Buffer for Progressive TTS

Status: done

## Story

As a **backend developer**,
I want a sentence boundary detection utility,
So that streaming AI tokens can be batched into sentences for progressive TTS synthesis.

## Acceptance Criteria

1. A `SentenceBuffer` class exists with `addToken(token: string): string[]` and `flush(): string | null` methods
2. Complete sentences are emitted when a sentence boundary is detected (`.` `!` `?` followed by space or at string end)
3. Sentences shorter than 10 characters are held in the buffer (avoid tiny TTS calls for fragments like "Hi.")
4. Buffers longer than 500 characters are force-flushed (handle unpunctuated long responses)
5. `flush()` returns any remaining text when the stream ends
6. Edge cases handled: abbreviations ("Dr.", "U.S."), numbered lists ("1."), ellipsis ("..."), URLs
7. Unit tests cover: single sentence, multi-sentence, no punctuation force-flush, min length hold, edge cases, flush, empty input

## Tasks / Subtasks

- [x] Task 1: Create SentenceBuffer class (AC: 1-5)
  - [x] Create `apps/api/src/modules/voice/utils/sentence-buffer.ts`
  - [x] Implement `addToken(token)` — appends to internal buffer, scans for boundaries, returns ready sentences
  - [x] Implement `flush()` — returns remaining buffer content, resets buffer
  - [x] Configurable constants: `MIN_SENTENCE_LENGTH = 10`, `MAX_BUFFER_LENGTH = 500`

- [x] Task 2: Sentence boundary detection (AC: 2, 6)
  - [x] Primary boundaries: `.` `!` `?` followed by whitespace or end of buffer
  - [x] Skip false boundaries: common abbreviations (Mr., Mrs., Dr., vs., etc., e.g., i.e.)
  - [x] Skip numbered lists: digit + period + space (e.g., "1. First item")
  - [x] Handle ellipsis: `...` is NOT a sentence boundary (it's a continuation)
  - [x] Handle URLs: skip periods inside URLs (http://..., www....)

- [x] Task 3: Export from voice module (AC: 1)
  - [x] Export SentenceBuffer from voice utils barrel file (or directly importable)

- [x] Task 4: Unit tests (AC: 7)
  - [x] Create `apps/api/test/services/voice/sentence-buffer.spec.ts`
  - [x] Test: "Hello world. How are you?" → ["Hello world."] then ["How are you?"] on flush
  - [x] Test: token-by-token input ("H", "ello", " world", ".") → emits sentence when boundary hit
  - [x] Test: short sentence "Hi." held until more text or flush
  - [x] Test: 500+ chars without punctuation → force-flushed
  - [x] Test: flush returns remaining text
  - [x] Test: empty buffer flush returns null
  - [x] Test: "Dr. Smith went home." → single sentence (not split at "Dr.")
  - [x] Test: "1. First item. 2. Second item." → handles numbered lists
  - [x] Test: multiple sentences in one token batch

## Dev Notes

### This is a Pure Utility — No Dependencies

`SentenceBuffer` is a stateless-per-instance utility class with no NestJS dependencies, no database, no external services. It's a pure string processing class. This makes it easy to test and develop independently.

### Token Input Pattern

Tokens arrive from n8n Chat Trigger as individual words or word fragments:
```
"Hello" → "!" → " I" → " can" → " help" → " you" → "." → " What" → " would" → ...
```

The buffer accumulates these and detects when a full sentence is ready:
```typescript
const buffer = new SentenceBuffer();
buffer.addToken("Hello");      // → []
buffer.addToken("!");          // → []  (only 6 chars, below MIN_SENTENCE_LENGTH)
buffer.addToken(" I");         // → []
buffer.addToken(" can");       // → []
buffer.addToken(" help");      // → ["Hello! I can help"]  — wait, need boundary
// Actually: "Hello!" is 6 chars, held. Then more tokens accumulate.
// Eventually: "Hello! I can help you." → ["Hello! I can help you."]
```

### Boundary Detection Strategy

```typescript
// Simple regex approach — scan buffer for boundaries
const BOUNDARY = /[.!?](?:\s|$)/;

// But skip common abbreviations
const ABBREVIATIONS = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.\s/;

// And skip numbered lists
const NUMBERED_LIST = /\d+\.\s/;

// Strategy: find boundary, check it's not an abbreviation, check sentence >= MIN_LENGTH
```

### Architecture Reference

From `architecture.md` Section 20.15.1:
```typescript
export class SentenceBuffer {
  private buffer = '';
  private readonly SENTENCE_TERMINATORS = /[.!?]\s|[.!?]$/;
  private readonly MIN_SENTENCE_LENGTH = 10;
  private readonly MAX_BUFFER_LENGTH = 500;

  addToken(token: string): string[] { ... }
  flush(): string | null { ... }
}
```

The architecture provides the basic structure. This story implements it with proper edge case handling.

### Edge Case Priority

| Edge Case | Priority | Handling |
|-----------|----------|----------|
| Normal sentences (". ", "! ", "? ") | Must handle | Primary boundary detection |
| Short fragments ("Hi.", "OK.") | Must handle | MIN_SENTENCE_LENGTH hold |
| Long unpunctuated text | Must handle | MAX_BUFFER_LENGTH force-flush |
| Abbreviations ("Dr. Smith") | Should handle | Abbreviation skip list |
| Numbered lists ("1. Item") | Should handle | Digit-period-space skip |
| Ellipsis ("wait...") | Should handle | Three dots = not boundary |
| URLs ("http://example.com") | Nice to have | Skip periods inside URLs |
| Code blocks with periods | Won't handle | Edge case unlikely in chat |

### Dependencies

- None — this is a standalone utility
- Can be developed in parallel with any other story
- Will be consumed by Story 13-7 (Streaming Voice Pipeline)

### Project Structure Notes

| File | Action |
|------|--------|
| `apps/api/src/modules/voice/utils/sentence-buffer.ts` | CREATE — SentenceBuffer class |
| `apps/api/test/services/voice/sentence-buffer.spec.ts` | CREATE — unit tests |

### References

- [Source: architecture.md#Section 20.15.1] — SentenceBuffer class spec
- [Source: architecture.md#Section 20.15.2] — How SentenceBuffer is used in streaming TTS orchestrator

## Senior Developer Review (AI)

**Review Date:** 2026-03-23
**Review Outcome:** Changes Requested → All Resolved
**Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor (3-layer adversarial review)

### Findings Summary

| Category | Count | Resolved |
|----------|-------|----------|
| Patch | 5 | 5/5 |
| Bad Spec | 1 | N/A (cosmetic) |
| Defer | 4 | 4/4 (all fixed) |
| Rejected | 6 | N/A |

### Action Items

- [x] **[High] P1:** Infinite loop on 500+ whitespace-only buffer — added `trimStart()` on empty chunks + iteration cap (20)
- [x] **[Low] P2:** Repeated `toLowerCase()`/`slice()` allocations per period — `isInsideUrl` now walks backward; `isAbbreviation` no longer lowercases entire buffer
- [x] **[Low] P3:** `\r` not treated as whitespace — centralized `isWhitespace()` Set with `\r` support
- [x] **[Med] P4:** Missing unit test for `"U.S."` abbreviation — added tests for U.S., U.K., a.m., p.m.
- [x] **[Low] P5:** Abbreviation false positive from dot-stripping — words containing dots now rejected from single-word match
- [x] **[Med] D1:** Decimal numbers mid-sentence falsely detected as numbered lists — restricted to buffer start / after sentence boundary
- [x] **[Med] D2:** Unicode surrogate pair splitting on force-flush — `findSafeBreakPoint()` detects and avoids splitting pairs
- [x] **[Low] D3:** Missing multi-dot abbreviations — added `u.k.`, `a.m.`, `p.m.`
- [x] **[Low] D4:** Large single token blocks event loop — iteration cap (20) on force-flush loop
- **[Low] S1 (Bad Spec):** AC 2 says "at string end" but streaming requires deferral to `flush()` — no code change needed, correct design for streaming

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Completion Notes List
- Implemented `SentenceBuffer` class with `addToken()` and `flush()` methods
- Boundary detection handles: `.` `!` `?` followed by whitespace including `\r` (end-of-buffer deferred to `flush()` for streaming correctness)
- Short sentence merging: boundaries producing sentences < 10 chars are skipped; the next boundary produces a merged sentence
- Force-flush at 500 chars breaks at last space for clean output, with surrogate pair protection
- Edge case handling: 22 abbreviations, 6 multi-dot abbreviations (e.g., i.e., u.s., u.k., a.m., p.m.), numbered lists (start-of-line only), ellipsis, URLs (http/https/www)
- Abbreviation dot-stripping hardened: words containing dots are not matched against single-word abbreviation set
- Numbered list detection tightened: only matches at buffer start or after sentence boundary (not mid-sentence decimals)
- Unicode surrogate pair safe: force-flush detects and avoids splitting surrogate pairs
- Iteration cap (20) on force-flush loop prevents infinite loops on whitespace-only buffers
- Centralized whitespace detection via static `isWhitespace()` helper using Set
- Optimized `isInsideUrl`: backward walk instead of full-buffer slice+toLowerCase
- 49 unit tests covering all ACs plus code review fixes
- All 1278 tests pass (zero regressions)
- Lint, type-check, and build all pass

### Change Log
- 2026-03-23: Implemented SentenceBuffer utility and comprehensive unit tests (Story 13-6)
- 2026-03-23: Code review fixes — P1 infinite loop, P2 perf optimizations, P3 \r whitespace, P4 U.S. test, P5 dot-stripping, D1 numbered list false positive, D2 surrogate pairs, D3 abbreviations, D4 iteration cap

### File List
- `apps/api/src/modules/voice/utils/sentence-buffer.ts` — CREATE: SentenceBuffer class
- `apps/api/test/services/voice/sentence-buffer.spec.ts` — CREATE: 49 unit tests
