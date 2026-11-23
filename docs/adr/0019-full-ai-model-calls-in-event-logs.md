# ADR-0019: Full AI model calls in event_logs

- **Status:** Accepted
- **Date:** 2026-11-04
- **Deciders:** Dhruv (owner)

## Context

On 2026-11-04 the OpenAI account ran out of credit. For 26 minutes every widget reply failed with "The assistant is temporarily unavailable". The logs could not say why:

- `LLM_COMPLETION_FAILED` rows held "No output generated. Check the stream for errors." The AI SDK does not throw the provider error from a stream. It passes it to `onError` and then rejects with a generic `NoOutputGeneratedError`. We had no `onError`.
- The request payload held only counts (`messageCount`, `systemPromptChars`). There was no response payload, so there was no provider status and no error body.
- The classifier and extraction calls logged "HTTP 429" without the body. A model refusal or an empty reply wrote no row.
- A failed chat turn wrote no `chat_traces` row. The trace was ended after the error chunk was yielded, and the consumer stops at that chunk.

The cause (`429 insufficient_quota / credit_balance_exhausted`) was found only by sending a request by hand.

ADR-0005 already says "log everything, mask PII, full bodies stay". The LLM logger was an exception left from the observability plan, which said "do not store the full prompt, the full replay lives in `chat_traces`". That premise is false: `chat_traces` stores counts and the final reply, not the prompt.

The default `event_logs` limits also make full AI payloads impossible: every string is cut to 2,000 characters and a row to 32 KB. A real ARPMS turn is about 6,000 input tokens (about 24 KB).

## The four questions

- **Blast radius:** `event_logs` storage and the ops console. If the masking misses something, more personal text sits in logs (masked as in ADR-0005). Chat replies do not change.
- **One-way or two-way door:** two-way. It is logging code and two constants. Rows already written stay until erasure.
- **Couples us to:** nothing new. It uses the AI SDK `onError` callback and `APICallError` fields we already depend on.
- **Cost of waiting:** high. The next provider outage, key problem or prompt bug is again a blind guess.

## Decision

Every AI model call writes its full request and the provider's full answer to `event_logs`, masked by the single writer (`TracerService.logEvent`) as ADR-0005 requires.

| Call                                              | Request payload                                          | Response payload                                                                        |
| ------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Chat, voice, WhatsApp, summaries (`LlmService`)   | model, all settings, tool names, messages, system prompt | text, finish reason, every tool call and tool result                                    |
| Classifier and extraction (`AiClassifierService`) | the exact body sent to OpenAI                            | the full OpenAI response                                                                |
| Any failed call                                   | as above                                                 | the provider's HTTP status and error body; `errorMessage` is the provider's own message |

Rules:

1. Streaming calls capture the provider error with `onError`. A provider error after a finished step (for example the reply after a tool call) is a failed call, not a success with empty text.
2. AI rows use `LLM_PAYLOAD_LIMITS`: 100,000 characters per string, 500 items per array, 256 KB per payload. An oversized payload keeps its first 256 KB as text. Every other row keeps the default limits.
3. Large payloads are masked on a later turn of the event loop, never on the request tick. Masking a 36 KB payload takes about 3 ms (measured).
4. Classifier and extraction rows carry the chat session id, so visitor erasure finds them (ADR-0005).
5. A failed chat turn always writes its `chat_traces` row. The trace is ended before the error is yielded.
6. Secrets are never logged: API keys go in headers, which are not logged, and `redact()` still strips sensitive keys.

## Options rejected

### Log only failures in full

**Good:** much less storage. Failures are what we debug most.

**Rejected because:** a wrong or leaked answer is a successful call. Prompt bugs, guardrail misses and "why did the bot say this" questions need the successful calls too. The owner asked for full requests and responses.

**Revisit if:** storage cost becomes a problem (see Consequences).

### Store the system prompt once and log a hash per call

**Good:** the system prompt (persona plus knowledge) is the largest part and is almost the same on every turn. A hash would cut most of the storage.

**Rejected because:** the prompt changes with the agent's settings, knowledge and running summary. Rebuilding "what exactly did the model see" from a hash needs a versioned prompt store, which we do not have. It is more code for a cost we do not have yet.

**Revisit if:** `event_logs` storage approaches the database plan limit.

### Keep counts only (the previous rule)

**Good:** smallest rows, no personal text from prompts in logs.

**Rejected because:** it made the 2026-11-04 outage undiagnosable, and it contradicts ADR-0005.

## Consequences

- A provider outage, quota problem or key error is visible in one query: status, provider error code and message.
- "What did the model see and say" can be answered for any turn, including tool calls.
- Storage grows. Estimate: about 25 to 40 KB per chat turn before Postgres compression. At 80,000 turns a month that is about 2 to 3 GB a month, less after compression. `event_logs` keeps rows forever (ADR-0005), so this needs watching.
- Each AI call costs about 3 ms of CPU to mask, off the request tick.
- Tool results are logged. Today the only tool is `connect_to_human`. When CRM or other integration tools return third-party records, those records are masked by the same regex recognizers. Names and free text are not detected (the same limit ADR-0005 records).
- The ops console shows AI payloads in full.

## Open questions

- A retention period or a storage budget for AI rows, if storage cost becomes real. Owner decides.
