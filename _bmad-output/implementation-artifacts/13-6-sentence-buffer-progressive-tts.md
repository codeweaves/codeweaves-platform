# Story 13.6: Sentence Buffer for Progressive TTS

Status: ready-for-dev

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

- [ ] Task 1: Create SentenceBuffer class (AC: 1-5)
  - [ ] Create `apps/api/src/modules/voice/utils/sentence-buffer.ts`
  - [ ] Implement `addToken(token)` — appends to internal buffer, scans for boundaries, returns ready sentences
  - [ ] Implement `flush()` — returns remaining buffer content, resets buffer
  - [ ] Configurable constants: `MIN_SENTENCE_LENGTH = 10`, `MAX_BUFFER_LENGTH = 500`

- [ ] Task 2: Sentence boundary detection (AC: 2, 6)
  - [ ] Primary boundaries: `.` `!` `?` followed by whitespace or end of buffer
  - [ ] Skip false boundaries: common abbreviations (Mr., Mrs., Dr., vs., etc., e.g., i.e.)
  - [ ] Skip numbered lists: digit + period + space (e.g., "1. First item")
  - [ ] Handle ellipsis: `...` is NOT a sentence boundary (it's a continuation)
  - [ ] Handle URLs: skip periods inside URLs (http://..., www....)

- [ ] Task 3: Export from voice module (AC: 1)
  - [ ] Export SentenceBuffer from voice utils barrel file (or directly importable)

- [ ] Task 4: Unit tests (AC: 7)
  - [ ] Create `apps/api/test/services/voice/sentence-buffer.spec.ts`
  - [ ] Test: "Hello world. How are you?" → ["Hello world."] then ["How are you?"] on flush
  - [ ] Test: token-by-token input ("H", "ello", " world", ".") → emits sentence when boundary hit
  - [ ] Test: short sentence "Hi." held until more text or flush
  - [ ] Test: 500+ chars without punctuation → force-flushed
  - [ ] Test: flush returns remaining text
  - [ ] Test: empty buffer flush returns null
  - [ ] Test: "Dr. Smith went home." → single sentence (not split at "Dr.")
  - [ ] Test: "1. First item. 2. Second item." → handles numbered lists
  - [ ] Test: multiple sentences in one token batch

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

## Dev Agent Record

### Agent Model Used

### Completion Notes List

### Change Log

### File List
