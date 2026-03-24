# AI Orchestration Layer — Production Research (March 2026)

Research compiled from real production systems, official documentation, and engineering blogs. All information verified against current (2025-2026) sources.

---

## Table of Contents

1. [OpenRouter Integration (Multi-LLM Gateway)](#1-openrouter-integration)
2. [RAG Architecture (Production-Grade)](#2-rag-architecture)
3. [Voice Pipeline (Direct API)](#3-voice-pipeline)
4. [WhatsApp Integration](#4-whatsapp-integration)
5. [Architecture Patterns for AI Orchestration](#5-architecture-patterns)
6. [Scalability & Production Concerns](#6-scalability--production)
7. [Vercel AI SDK](#7-vercel-ai-sdk)
8. [Recommended Architecture for CodeWeaves](#8-recommended-architecture)

---

## 1. OpenRouter Integration

### What OpenRouter Is

OpenRouter is a managed, multi-LLM gateway providing a single OpenAI-compatible API endpoint to 300+ models from OpenAI, Anthropic, Google, Meta, Mistral, and more. Over 2 million users. No self-hosting required.

### API Format

- **Base URL**: `https://openrouter.ai/api/v1/chat/completions`
- **Auth**: `Authorization: Bearer <OPENROUTER_API_KEY>`
- **Format**: OpenAI-compatible — same `messages`, `model`, `tools`, `stream` parameters
- **Model IDs**: Provider-prefixed, e.g., `openai/gpt-5.2`, `anthropic/claude-4-sonnet`, `google/gemini-2.5-flash`

```typescript
// Basic request
fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <OPENROUTER_API_KEY>',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'anthropic/claude-4-sonnet',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true,
  }),
});
```

### Pricing Model

- **Pay-per-token**: Pass-through pricing from providers, no markup on model costs
- **Credit fees**: 5.5% on card purchases (min $0.80), 5% on crypto
- **BYOK (Bring Your Own Key)**: 5% usage fee on underlying provider cost
- **Free models**: 27+ free models with rate limits (20 req/min, 200/day; 1000/day if 10+ credits purchased)
- **No monthly fees or minimums**

### Rate Limiting

- Free users: 50 requests/day, 20 req/min
- Paid users: No platform-level rate limits
- Per-key caps and alerts configurable in dashboard

### Streaming

Server-Sent Events (SSE) via `stream: true`. The TypeScript SDK supports text streaming, reasoning streaming, tool call streaming, and full event streaming. Uses an items-based model where items are emitted with progressive updates (replace by ID, not accumulate chunks).

### Cost Tracking

- Separate API keys per environment with individual caps and alerts
- Per-model and per-key spending tracked in dashboard
- Response includes `cost` field for credit usage

### OpenRouter vs LiteLLM

| Aspect | OpenRouter | LiteLLM |
|--------|-----------|---------|
| Deployment | Managed SaaS | Self-hosted (open source) |
| Models | 300+ | 100+ |
| Routing | Built-in intelligent routing | Latency/cost/usage-based routing |
| Overhead | Zero ops | Requires infrastructure |
| Enterprise users | 2M+ users | Netflix, Lemonade, RocketMoney |
| Cost control | Dashboard + per-key caps | Policy-as-code, team management |
| Best for | Zero-maintenance multi-provider | Self-hosted control, observability |

**Recommendation for CodeWeaves**: Start with OpenRouter (zero ops overhead). If you need self-hosted control later for compliance, migrate to LiteLLM — the API is compatible.

### Key Packages

- `@openrouter/ai-sdk-provider` — Vercel AI SDK provider for OpenRouter
- OpenRouter TypeScript SDK (native)

---

## 2. RAG Architecture

### Current Best Practices (2025-2026)

**The critical insight**: 80% of RAG failures trace back to the ingestion and chunking layer, NOT the LLM. Most teams waste weeks tuning prompts while retrieval quietly returns wrong context.

### pgvector vs Dedicated Vector DBs

| Criteria | pgvector | Pinecone | Qdrant |
|----------|----------|----------|--------|
| Latency (<10M vectors) | 5-20ms (HNSW) | 5-20ms | 5-15ms |
| Latency (>50M vectors) | Degrades | Consistent | Consistent |
| Horizontal scaling | No native sharding | Auto-scaling serverless | Distributed |
| Cost (<10M vectors) | PostgreSQL hosting | $64-85/mo | Self-host or cloud |
| ACID compliance | Full | No | No |
| Relational joins | Native | Requires separate DB | Requires separate DB |

**Decision for CodeWeaves**: Use **pgvector**. You already run PostgreSQL/Prisma. For a SaaS platform, you will likely stay under 10M vectors per tenant for a long time. Benefits:
- No additional database to manage
- Transactional consistency between vectors and relational data (documents, users, tenants)
- Metadata stored alongside vectors (no 40KB limit like Pinecone)
- Use HNSW index for production (not IVFFlat)

**When to migrate**: If you exceed 50M vectors per shard or need >1000 QPS sustained, evaluate Qdrant or Pinecone serverless.

### Embedding Models (2026 Rankings)

| Model | MTEB Score | Dimensions | Cost | Context |
|-------|-----------|------------|------|---------|
| Voyage-3-large | Best | 1,024 | $0.06/1M tokens | 32K |
| OpenAI text-embedding-3-large | Strong | 3,072 | $0.13/1M tokens | 8K |
| OpenAI text-embedding-3-small | Good | 1,536 | $0.02/1M tokens | 8K |
| BGE-M3 (self-hosted) | Strong | 1,024 | Infra only | 8K |
| Qwen3-Embedding-8B | Best open-source | Varies | Infra only | Varies |

**Recommendation**: Start with `text-embedding-3-small` via OpenRouter ($0.02/1M tokens, good enough for MVP). Upgrade to `text-embedding-3-large` or Voyage-3 when quality matters. Use `embedMany()` from Vercel AI SDK for batch processing.

### Chunking Strategies

| Strategy | Size | Overlap | Accuracy | Best For |
|----------|------|---------|----------|----------|
| Recursive (default) | 512 tokens | 50 tokens (10%) | 69% | Technical docs, mixed content |
| Fixed-size | 400-512 tokens | 10-20% | Baseline | Homogeneous content (FAQs) |
| Semantic | Dynamic | Threshold-based | 79-82% | High-value docs (legal, medical) |
| Hierarchical (parent-child) | 200 tokens retrieve / 2000 tokens return | N/A | Best precision | Complex docs needing context |

**Production default**: Recursive chunking, 512 tokens, 50-token overlap. This covers 80% of use cases.

**Critical insight**: Chunking quality constrains retrieval accuracy MORE than embedding model choice. A 2025 study found adaptive chunking hit 87% accuracy vs 13% for fixed-size.

### Hybrid Search (Vector + BM25)

Hybrid search consistently outperforms either method alone. The architecture:

1. **Dense retrieval** (vector/embedding similarity) — captures semantic meaning
2. **Sparse retrieval** (BM25 keyword matching) — captures exact terms
3. **Fusion** via Reciprocal Rank Fusion (RRF) at k=60
4. **Reranking** with cross-encoder model

**Recommended weights**: 60% dense / 40% sparse (adjust per query type).

**PostgreSQL implementation options**:
- `pg_textsearch` (by TimescaleDB) — native BM25 in PostgreSQL, pairs with pgvector
- ParadeDB — BM25 + vector search in PostgreSQL
- PostgreSQL native `tsvector` + `ts_rank` — decent but not true BM25

**With Prisma**: Use `$queryRaw` for BM25 queries. Add SQL to Prisma migration files for index creation.

### Document Ingestion Pipeline

```
Document Upload → Queue (BullMQ) → Parse (PDF/DOCX/etc) → Chunk → Embed → Store in pgvector
                                                                              ↓
                                                                   Hash for change detection
                                                                   Incremental re-indexing
```

**Production pipeline requirements**:
- Queue-based processing (BullMQ) — never block the API on document ingestion
- Change detection via content hashing — only re-embed changed chunks
- Batch embedding — process chunks in batches of 100-500
- Progress tracking — webhook or polling for upload status
- Access control enforcement at vector search time via metadata filters

### RAG Retrieval Flow

```
User Query → Embed Query (20-50ms) → Parallel: [Vector Search (5-30ms) + BM25 Search (5-20ms)]
          → RRF Fusion → Rerank top 20 → top 5 (30-100ms) → Assemble Context (<8K tokens)
          → LLM Generation (500ms-3s) → Stream Response
```

**Total latency**: 560ms-3.2s (LLM dominates)

### Evaluation & Monitoring

**Key metrics (RAGAS-based)**:
- Context Precision: fraction of retrieved chunks actually relevant
- Context Recall: did we find all needed information?
- Faithfulness: claims supported by context (hallucination detector)
- Answer Relevance: response addresses the question

**Alert thresholds**:
- Retrieval p99 > 200ms (warning), > 500ms (critical)
- Zero-result rate > 5% (warning), > 15% (critical)
- Faithfulness < 0.80 (warning), < 0.70 (critical)

---

## 3. Voice Pipeline

### Architecture Approaches (2026)

| Approach | Latency | Flexibility | Maturity |
|----------|---------|-------------|----------|
| Cascading Pipeline (STT→LLM→TTS) | 800-2000ms | Maximum | Production-ready |
| Streaming Pipeline | 400-700ms | High | Production-ready |
| Speech-to-Speech (e2e models) | 200-500ms | Limited | Emerging |

### How Sub-500ms Latency Is Achieved

Real production system by Nick Tikhonov (open source: github.com/NickTikhonov/shuo):

**Architecture**: Twilio → Deepgram Flux (STT) → Groq LLM → ElevenLabs (TTS) → Twilio

**Latency breakdown**:
- LLM TTFT: ~80ms (Groq, vs 200-400ms OpenAI)
- Total end-to-end: ~400ms (vs Vapi's ~840ms)
- 2x faster than Vapi through architecture and model selection

**Critical optimizations**:
1. **Pre-warmed WebSocket connections to TTS** — saves ~300ms per turn. Keep a pool of pre-connected sockets alive
2. **Streaming between ALL components** — LLM tokens flow directly to TTS, audio frames flow directly to output
3. **Geographic deployment** — deploy close to provider endpoints (EU region cut latency from 1.6s to 690ms)
4. **Sentence-boundary chunking** — chunk LLM output at sentence boundaries, stream TTS against those chunks

**State machine**: Only two states — User Speaking (agent listening) / User Listening (agent speaking). Interruption handling: detect speech → cancel LLM → teardown TTS → clear audio buffer.

### How Vapi Works

Vapi is an orchestration layer over three swappable modules: Transcriber, Model, Voice. It:
- Optimizes latency and manages scaling/streaming
- Supports WebSocket transport for direct audio streaming (PCM 16-bit or Mu-Law)
- Production latency: 550-800ms
- Supports OpenAI Realtime API for native speech-to-speech

### STT Providers (2026)

| Provider | Latency | WER | Price | Streaming |
|----------|---------|-----|-------|-----------|
| Deepgram Nova-3 | ~150ms | <5% | $0.0043/min | Yes, WebSocket |
| AssemblyAI Universal | ~300ms | <5% | $0.15/hr | Yes |
| OpenAI Whisper | ~500ms | ~5% | $0.006/min | No (batch) |
| Google Cloud STT | ~200ms | ~6% | $0.006/min | Yes |

### TTS Providers (2026)

| Provider | TTFB | Quality (ELO) | Price | Streaming |
|----------|------|---------------|-------|-----------|
| Cartesia Sonic-3 | 40-90ms | Good | Low | WebSocket |
| ElevenLabs Flash v2.5 | ~75ms | High (1108) | $11/1M chars | WebSocket |
| Deepgram Aura-2 | ~90ms | Good | $0.0075/1K chars | Yes |
| OpenAI TTS | ~200ms | Good (1095) | $15/1M chars | Yes |
| Kokoro (open-weight) | Varies | Good | $0.70/1M chars | Self-host |

### Voice Activity Detection (VAD)

**Production options**:
- `@ricky0123/vad-web` — browser-based VAD using Silero model, MIT license
- Silero VAD — deep learning model, high accuracy
- Cobra VAD (Picovoice) — production-ready, lightweight
- WebRTC VAD — Google's engine, fast but less accurate

**Best practice**: Process audio in 10ms frames. Favor on-device processing. Minimize buffer sizes.

### Protocol: WebSocket vs HTTP

**WebSocket** is the standard for production voice systems:
- Bidirectional, persistent connection
- Minimal overhead per audio frame
- Required for real-time STT streaming and TTS output
- Vapi, LiveKit, Daily/Pipecat all use WebSocket

**HTTP** only for batch/async processing (e.g., processing recorded voice messages from WhatsApp).

### Recommended Voice Stack for CodeWeaves

```
Browser/Phone → WebSocket → NestJS Gateway
                                ↓
                    Deepgram (STT, streaming WebSocket)
                                ↓
                    Groq or OpenRouter (LLM, streaming)
                                ↓
                    ElevenLabs or Cartesia (TTS, WebSocket)
                                ↓
                    Audio frames → WebSocket → Browser/Phone
```

---

## 4. WhatsApp Integration

### WhatsApp Cloud API (Recommended)

The WhatsApp Cloud API is Meta's hosted version — no third-party BSP needed. Free to use (you pay only per-conversation fees to Meta).

**Official SDK**: `WhatsApp-Nodejs-SDK` (from github.com/WhatsApp/WhatsApp-Nodejs-SDK) — includes TypeScript declarations.

### Setup Requirements

```
Environment Variables:
- WA_PHONE_NUMBER_ID
- CLOUD_API_ACCESS_TOKEN
- WEBHOOK_VERIFICATION_TOKEN
- CLOUD_API_VERSION (e.g., v16.0)
```

### Webhook Architecture

```
WhatsApp Cloud → HTTPS POST → Your NestJS endpoint (/webhook)
                                    ↓
                            Verify signature (X-Hub-Signature-256)
                                    ↓
                            Parse message type (text, audio, image, document)
                                    ↓
                            Route to handler
                                    ↓
                            Process + Reply via API
```

**Webhook verification**: Meta sends a GET request with `hub.verify_token` — respond with `hub.challenge`.

**Inbound message flow**: Meta POSTs JSON with message data. For media (voice notes, images), the payload contains a Media ID — you must make a separate GET request to download the file.

### Message Types Supported

- **Text**: Standard messages
- **Audio**: Voice notes (OGG/Opus format), audio files
- **Images**: JPEG, PNG
- **Documents**: PDF, DOCX, etc.
- **Location**: GPS coordinates
- **Contacts**: vCard format
- **Interactive**: Buttons, lists, product messages
- **Templates**: Pre-approved outbound messages (required for initiating conversations)

### Voice Message Processing Flow

```
User sends voice note → Webhook receives Media ID
→ Download audio (GET /v16.0/{media-id})
→ Convert OGG/Opus to WAV/PCM if needed
→ STT (Deepgram or Whisper)
→ Process with LLM
→ TTS response
→ Upload audio to WhatsApp Media API
→ Send audio message back to user
```

### Rate Limits & Billing (2026)

- **Messaging tiers**: 250 → 2K → 10K → 100K conversations/24hr (auto-scales with quality)
- **Throughput**: Default 80 messages/second, can request up to 500 mps
- **Billing**: Per-template model (from July 2025) — each template message billed individually
- **Categories**: Marketing, Utility, Authentication, Service
- **24-hour service window**: After user initiates, free-form messages for 24 hours
- **Pacing**: WhatsApp batches large campaigns, monitoring feedback before releasing next batch (rolling out Q1-Q2 2026)

### Best Practices

- Download media immediately — temporary URLs expire in 24-48 hours
- Implement message deduplication (WhatsApp may retry webhooks)
- Use Redis for session/conversation state with TTL
- Queue voice message processing (it is async by nature)
- Pre-approve templates for outbound campaigns
- Monitor delivery rates (sent/delivered/read ratios)

---

## 5. Architecture Patterns for AI Orchestration

### Framework Comparison (2026)

| Framework | Language | Best For | Production Users |
|-----------|----------|----------|-----------------|
| **Mastra** | TypeScript | Full agent framework | Replit, PayPal, Adobe |
| **Vercel AI SDK** | TypeScript | Streaming UI + backend | Vercel ecosystem |
| **LangChain/LangGraph** | Python/TS | Complex chains, legacy | Widespread |
| **Custom orchestration** | Any | Simple pipelines | Many startups |

### Why NOT LangChain

LangChain's heavy abstraction, complex debugging, and difficulty with real-world use make it more suited for prototyping than production. For simple pipelines, ~60 lines of custom coordination code beats framework overhead.

### Mastra Deep Dive

Mastra is the TypeScript-native AI framework built for production (from the Gatsby team, YC-backed, $13M seed).

**Core primitives**:
- **Agents**: LLM reasoning + tool execution loops
- **Tools**: Executable functions extending agent capabilities
- **Workflows**: Graph-based orchestration with `.then()`, `.branch()`, `.parallel()`
- **Memory**: Conversation persistence
- **RAG**: Full pipeline (chunk → embed → store → retrieve)
- **Agent Networks**: Multi-agent coordination

**Built on Vercel AI SDK** — inherits all provider support and streaming.

**Vector store packages**:
- `@mastra/pg` (pgvector)
- `@mastra/pinecone`
- `@mastra/qdrant`
- `@mastra/chroma`
- `@mastra/upstash`

**RAG tools**: `createVectorQueryTool` from `@mastra/rag` — lets agents decide when and how to retrieve.

**NestJS compatibility**: Mastra supports Express and Hono as HTTP layers. For NestJS, you would use Mastra's core primitives (agents, tools, workflows) as services within NestJS, not as a standalone server. Community discussion exists about this pattern.

### Vercel AI SDK as Foundation

The better approach for NestJS: use **Vercel AI SDK Core** (`ai` package) directly in NestJS services. It provides:
- `generateText()` / `streamText()` — works in any Node.js environment
- `generateObject()` / `streamObject()` — structured outputs
- `embed()` / `embedMany()` — embeddings
- `rerank()` — reranking
- Tool definition via `tool()` and `dynamicTool()`
- Agent loops via `ToolLoopAgent`
- Provider-agnostic (swap models without code changes)

### Agent/Chain Composition Pattern (Without LangChain)

```typescript
// NestJS service using Vercel AI SDK directly
@Injectable()
export class AgentService {
  async runAgent(messages: Message[], tools: Tool[]) {
    const result = await streamText({
      model: openrouter('anthropic/claude-4-sonnet'),
      messages,
      tools,
      maxSteps: 10, // tool loop iterations
      onStepFinish: (step) => {
        // Log tool calls, track usage
      },
    });
    return result.toDataStreamResponse();
  }
}
```

### Function Calling / Tool Use Across Providers

The Vercel AI SDK normalizes tool calling across all providers. Define tools once:

```typescript
const weatherTool = tool({
  description: 'Get weather for a location',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => getWeather(city),
});
```

Works identically whether the model is OpenAI, Anthropic, or Google (via OpenRouter).

### Conversation Memory Architecture

**Three-tier approach**:

1. **Short-term (context window)**: Last N messages in the current conversation. Managed by the client or stored in Redis with TTL.

2. **Working memory**: Temporary information for multi-step tasks. Stored in-memory or Redis during agent execution.

3. **Long-term memory**: Persists across sessions. Options:
   - **Summarization**: Periodically summarize older messages, store summaries
   - **Vector memory**: Embed past conversations, retrieve relevant ones via RAG
   - **Structured memory**: Extract key facts into a knowledge graph or database

**AI SDK 6 Memory Tool**: Built-in memory tool for Anthropic that stores/retrieves information across conversations via a memory file directory.

**Production pattern**: Keep last 20 messages in context + retrieve 3-5 relevant past exchanges via vector search + include user profile/preferences as system message.

### Context Window Management

**When to use full context**: Short conversations, simple tasks, context < 8K tokens
**When to use RAG**: Large knowledge bases, specific factual recall, multi-document reasoning
**Hybrid**: Always include conversation history in context + RAG for domain knowledge

---

## 6. Scalability & Production Concerns

### Concurrent LLM Requests

- Node.js async/await handles concurrent I/O naturally — LLM API calls are I/O-bound, not CPU-bound
- Use connection pooling for WebSocket connections (STT, TTS)
- Set per-tenant concurrency limits to prevent noisy neighbor problems
- Consider queue-based processing for non-real-time operations

### Queue-Based Processing

Use **BullMQ** (already common in NestJS ecosystem) for:
- Document ingestion (parse → chunk → embed → store)
- Batch embedding generation
- Voice message processing (download → STT → process → TTS → upload)
- Scheduled re-indexing of changed documents

```
npm packages:
- bullmq (queue)
- @nestjs/bullmq (NestJS integration)
```

### Caching Strategies

**Two-tier LLM response caching**:

1. **Exact match cache** (Redis): Hash the (model + messages + tools) → cache response. Check first, return immediately on hit.
2. **Semantic cache** (Redis + vector search): Embed the query, find similar cached queries above threshold (0.85-0.95 cosine similarity). Returns in milliseconds vs seconds for fresh LLM call.

**Results**: Up to 73% cost reduction in high-repetition workloads. Latency: 0.052s cached vs 1.67s uncached (96.9% reduction).

**Embedding cache**: Cache embeddings by content hash. If document chunk unchanged, reuse embedding.

**Redis 8.4+ (2026)**: Native vector search for semantic caching without additional infrastructure.

### Cost Monitoring Per Tenant

```typescript
// Track in database per API call
interface LLMUsageRecord {
  tenantId: string;
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number; // from OpenRouter response
  timestamp: Date;
  feature: string; // 'chat', 'voice', 'rag', etc.
}
```

OpenRouter returns `cost` in every response. Aggregate per tenant for billing, alerts, and dashboards.

### Error Handling & Resilience

**Retry strategy** (exponential backoff with jitter):
- Retry on: 429, 500, 502, 503, 504
- Do NOT retry on: 400, 401, 403, 404
- Max 3 retries with exponential backoff (1s, 2s, 4s) + random jitter

**Fallback chain**:
```
Primary: anthropic/claude-4-sonnet (via OpenRouter)
Fallback 1: openai/gpt-4o (via OpenRouter)
Fallback 2: google/gemini-2.5-flash (via OpenRouter)
```
OpenRouter handles this natively with the `models` array and `route: "fallback"` parameter.

**Circuit breaker pattern**:
- Track failure rate per provider over rolling window
- Open circuit after N consecutive failures or >50% failure rate
- Half-open after timeout — test with single request
- Use `cockatiel` or `opossum` npm packages for TypeScript circuit breakers

```
npm packages:
- cockatiel (circuit breaker, retry, timeout, bulkhead)
- opossum (Netflix Hystrix-inspired circuit breaker)
```

### Monitoring Stack

- **LLM observability**: Track input/output tokens, cost, latency, model used per request
- **OpenTelemetry**: Vercel AI SDK has built-in telemetry support
- **Key metrics**: Token usage per tenant, cost per feature, latency p50/p95/p99, error rates by provider, cache hit rates

---

## 7. Vercel AI SDK

### Overview

The Vercel AI SDK (`ai` npm package, currently v6) is the most mature TypeScript-first SDK for building AI applications. It provides a unified API across 25+ providers.

### Core Packages

| Package | Purpose |
|---------|---------|
| `ai` | Core SDK — generateText, streamText, embed, rerank, tools, agents |
| `@ai-sdk/openai` | OpenAI provider |
| `@ai-sdk/anthropic` | Anthropic provider |
| `@ai-sdk/google` | Google AI provider |
| `@openrouter/ai-sdk-provider` | OpenRouter provider (300+ models) |
| `@ai-sdk/mcp` | Model Context Protocol client |

### OpenRouter Integration

```typescript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const result = await streamText({
  model: openrouter('anthropic/claude-4-sonnet'),
  messages: [{ role: 'user', content: 'Hello' }],
});
```

**Supported features via OpenRouter provider**:
- Streaming (streamText, streamObject)
- Tool calling (on supported models)
- Structured outputs (generateObject, streamObject)
- Embeddings (text-embedding-3-small, text-embedding-3-large, ada-002)
- Prompt caching (Anthropic models)
- Response healing plugin (auto-fix malformed JSON)

### AI SDK 6 New Features (Current)

- **ToolLoopAgent**: Reusable agent class with built-in tool execution loops (up to 20 steps)
- **Tool approval**: `needsApproval` flag for human-in-the-loop
- **MCP stable**: `@ai-sdk/mcp` with HTTP transport + OAuth
- **DevTools**: `npx @ai-sdk/devtools` for debugging prompts, tool calls, token usage
- **Reranking**: Native `rerank()` with Cohere, Bedrock, Together.ai
- **Structured output + tools**: Combined multi-step tool loops with structured output
- **Memory Tool**: Built-in for Anthropic (store/retrieve across conversations)
- **Enhanced usage**: Cache tokens, reasoning tokens, raw provider data

### Using AI SDK in NestJS

The AI SDK Core functions (`generateText`, `streamText`, `embed`, etc.) work in any Node.js environment. They are pure functions, not tied to Next.js:

```typescript
@Injectable()
export class AiService {
  private openrouter = createOpenRouter({
    apiKey: this.configService.get('OPENROUTER_API_KEY'),
  });

  constructor(private configService: ConfigService) {}

  async chat(messages: CoreMessage[], modelId: string) {
    return streamText({
      model: this.openrouter(modelId),
      messages,
      tools: { /* your tools */ },
      maxSteps: 10,
    });
  }

  async embed(texts: string[]) {
    const { embeddings } = await embedMany({
      model: this.openrouter.textEmbeddingModel('openai/text-embedding-3-small'),
      values: texts,
    });
    return embeddings;
  }
}
```

### AI SDK vs Building From Scratch

| Aspect | AI SDK | From Scratch |
|--------|--------|-------------|
| Provider switching | One-line change | Rewrite API integration |
| Streaming | Built-in SSE handling | Manual chunking |
| Tool calling | Normalized across providers | Provider-specific implementations |
| Structured output | Schema validation built-in | Manual JSON parsing |
| Type safety | Full TypeScript types | Manual typing |
| Maintenance | Community-maintained providers | You maintain everything |

**Verdict**: Use AI SDK. The abstraction cost is minimal, and the benefit of provider-agnostic code is massive for a multi-tenant SaaS where different customers might use different models.

---

## 8. Recommended Architecture for CodeWeaves

### Technology Stack

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                     │
│  Vercel AI SDK UI (useChat, useCompletion)               │
│  WebSocket client for voice                              │
└─────────────┬───────────────────────────┬───────────────┘
              │ HTTP/SSE                   │ WebSocket
┌─────────────▼───────────────────────────▼───────────────┐
│                    BACKEND (NestJS)                       │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Chat Module   │  │ Voice Module │  │ WhatsApp Mod  │ │
│  │ (HTTP/SSE)    │  │ (WebSocket)  │  │ (Webhook)     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                  │                  │          │
│  ┌──────▼──────────────────▼──────────────────▼────────┐│
│  │              AI Orchestration Layer                   ││
│  │  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  ││
│  │  │ Agent Engine │  │ RAG Svc  │  │ Memory Svc    │  ││
│  │  │ (AI SDK)     │  │ (pgvec)  │  │ (Redis+PG)    │  ││
│  │  └─────────────┘  └──────────┘  └───────────────┘  ││
│  └──────────────────────┬───────────────────────────────┘│
│                         │                                │
│  ┌──────────────────────▼───────────────────────────────┐│
│  │              External AI Services                     ││
│  │  OpenRouter (LLM) │ Deepgram (STT) │ ElevenLabs(TTS)││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Infrastructure: BullMQ (queues) │ Redis (cache)     ││
│  │  PostgreSQL + pgvector │ Prisma ORM                  ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### Packages to Install

```
# Core AI
ai                                    # Vercel AI SDK v6
@openrouter/ai-sdk-provider          # OpenRouter provider
@ai-sdk/mcp                          # MCP client (optional)

# RAG
pgvector                              # pgvector client for Node.js
# OR use Prisma raw queries with pgvector extension

# Voice
# deepgram SDK for STT
# elevenlabs SDK for TTS
# ws (WebSocket library)

# Queue & Cache
bullmq                                # Job queues
@nestjs/bullmq                        # NestJS integration
ioredis                               # Redis client

# Resilience
cockatiel                             # Circuit breaker, retry, timeout

# Document Processing
pdf-parse                             # PDF extraction
mammoth                               # DOCX extraction

# WhatsApp
whatsapp-cloud-api                    # WhatsApp Cloud API client
# OR use the official Meta SDK

# Evaluation (dev dependency)
ragas                                 # RAG evaluation
```

### Database Schema Additions (Prisma)

```prisma
// Enable pgvector extension
// In migration: CREATE EXTENSION IF NOT EXISTS vector;

model DocumentChunk {
  id          String   @id @default(uuid())
  documentId  String
  content     String
  embedding   Unsupported("vector(1536)")  // for text-embedding-3-small
  metadata    Json
  chunkIndex  Int
  tokenCount  Int
  contentHash String   // for change detection
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  document    Document @relation(fields: [documentId], references: [id])

  @@index([documentId])
  // HNSW index created via raw SQL migration:
  // CREATE INDEX ON "DocumentChunk" USING hnsw (embedding vector_cosine_ops);
}

model LlmUsage {
  id               String   @id @default(uuid())
  tenantId         String
  userId           String
  model            String
  promptTokens     Int
  completionTokens Int
  totalTokens      Int
  cost             Float
  feature          String   // 'chat', 'voice', 'rag', 'whatsapp'
  latencyMs        Int
  cached           Boolean  @default(false)
  createdAt        DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([userId, createdAt])
}

model ConversationMessage {
  id             String   @id @default(uuid())
  conversationId String
  role           String   // 'user', 'assistant', 'system', 'tool'
  content        String
  toolCalls      Json?
  toolResults    Json?
  tokenCount     Int?
  createdAt      DateTime @default(now())

  conversation   Conversation @relation(fields: [conversationId], references: [id])

  @@index([conversationId, createdAt])
}
```

### Key Architectural Decisions

1. **Use Vercel AI SDK (`ai`) as the core LLM abstraction** — not Mastra, not LangChain. It is lightweight, TypeScript-native, and provider-agnostic. Mastra is great but adds unnecessary framework overhead when you already have NestJS.

2. **Use OpenRouter as the single LLM gateway** — one API key, 300+ models, built-in fallback routing, cost tracking. No need for LiteLLM unless you need self-hosted control.

3. **Use pgvector for vector search** — you already have PostgreSQL. Add `pg_textsearch` for BM25 hybrid search. No additional database.

4. **Use BullMQ for async processing** — document ingestion, voice message processing, batch embeddings.

5. **Use Redis for caching** — conversation state (TTL), embedding cache (content hash), semantic LLM response cache.

6. **WebSocket for voice, HTTP/SSE for chat** — NestJS supports both via `@WebSocketGateway` and SSE controllers.

7. **Queue WhatsApp voice messages** — they are inherently async. Download → STT → LLM → TTS → Upload → Send.

### Pitfalls to Avoid

1. **Don't use LangChain** — too much abstraction, hard to debug, TypeScript support is second-class
2. **Don't start with a dedicated vector DB** — pgvector handles your scale, and co-location with relational data is a huge advantage
3. **Don't skip hybrid search** — vector-only retrieval misses exact keyword matches; BM25-only misses semantic similarity
4. **Don't block on document ingestion** — always use queues
5. **Don't forget to pre-warm WebSocket connections** for voice — cold connections add 300ms
6. **Don't store conversation history only in context** — persist to database for analytics and long-term memory
7. **Don't skip cost tracking** — multi-tenant SaaS needs per-tenant usage tracking from day one
8. **Don't trust WhatsApp media URLs** — download immediately, they expire in 24-48 hours
9. **Don't use fixed-size chunking** — recursive chunking with overlap is strictly better for most content
10. **Don't skip evaluation** — without RAGAS metrics, you are flying blind on RAG quality

---

## Sources

### OpenRouter
- [OpenRouter API Reference](https://openrouter.ai/docs/api/reference/overview)
- [OpenRouter Streaming Docs](https://openrouter.ai/docs/sdks/typescript/call-model/streaming)
- [OpenRouter TypeScript SDK](https://openrouter.ai/docs/sdks/typescript/call-model/overview)
- [OpenRouter Rate Limits](https://openrouter.ai/docs/api/reference/limits)
- [OpenRouter Pricing](https://openrouter.ai/pricing)
- [OpenRouter AI SDK Provider (GitHub)](https://github.com/OpenRouterTeam/ai-sdk-provider)
- [OpenRouter vs LiteLLM](https://denshub.com/en/choosing-llm-gateway/)
- [LiteLLM vs OpenRouter Comparison](https://www.truefoundry.com/blog/litellm-vs-openrouter)

### RAG Architecture
- [Why Confident AI Replaced Pinecone with pgvector](https://www.confident-ai.com/blog/why-we-replaced-pinecone-with-pgvector)
- [pgvector vs Pinecone 2026](https://encore.dev/articles/pgvector-vs-pinecone)
- [Production RAG Architecture 2026 Guide](https://blog.premai.io/building-production-rag-architecture-chunking-evaluation-monitoring-2026-guide/)
- [Hybrid Search in PostgreSQL (ParadeDB)](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- [pg_textsearch BM25 Extension](https://github.com/timescale/pg_textsearch)
- [Best Embedding Models 2026](https://www.openxcell.com/blog/best-embedding-models/)
- [Optimizing RAG with Hybrid Search & Reranking](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking)
- [Best Open-Source Embedding Models 2026](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)

### Voice Pipeline
- [Voice AI Stack 2026 (AssemblyAI)](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents)
- [Sub-500ms Voice Agent from Scratch](https://www.ntik.me/posts/voice-agent)
- [Open Source: github.com/NickTikhonov/shuo](https://github.com/NickTikhonov/shuo)
- [How to Build Lowest Latency Voice Agent in Vapi](https://www.assemblyai.com/blog/how-to-build-lowest-latency-voice-agent-vapi)
- [Best TTS APIs 2026 Benchmarks](https://inworld.ai/resources/best-voice-ai-tts-apis-for-real-time-voice-agents-2026-benchmarks)
- [Real-Time vs Turn-Based Voice Architecture](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture)
- [Vapi WebSocket Transport](https://docs.vapi.ai/calls/websocket-transport)
- [ricky0123/vad (Browser VAD)](https://github.com/ricky0123/vad)

### WhatsApp
- [WhatsApp Official Node.js SDK](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)
- [WhatsApp Business API Bot Architecture](https://dev.to/achiya-automation/building-whatsapp-business-bots-with-the-official-api-architecture-webhooks-and-automation-1ce4)
- [WhatsApp API Rate Limits](https://www.wati.io/en/blog/whatsapp-business-api/whatsapp-api-rate-limits/)
- [WhatsApp Messaging Limits](https://developers.facebook.com/docs/whatsapp/messaging-limits/)
- [Scalable Webhook Architecture for WhatsApp](https://www.chatarchitect.com/news/building-a-scalable-webhook-architecture-for-custom-whatsapp-solutions)

### AI Orchestration Patterns
- [Mastra AI Framework](https://mastra.ai/)
- [Mastra GitHub](https://github.com/mastra-ai/mastra)
- [LangChain Alternatives 2026](https://vellum.ai/blog/top-langchain-alternatives)
- [Orchestration Wars: LangChain vs Claude-Flow vs Custom](https://www.sitepoint.com/agent-orchestration-framework-comparison-2026/)
- [Context Engineering for LLM Memory](https://weaviate.io/blog/context-engineering)
- [Design Patterns for Long-Term Memory](https://serokell.io/blog/design-patterns-for-long-term-memory-in-llm-powered-architectures)

### Scalability & Production
- [Retries, Fallbacks, Circuit Breakers in LLM Apps](https://www.getmaxim.ai/articles/retries-fallbacks-and-circuit-breakers-in-llm-apps-a-production-guide/)
- [Top 5 LLM Gateways 2025](https://www.getmaxim.ai/articles/top-5-llm-gateways-in-2025-the-definitive-guide-for-production-ai-applications/)
- [Semantic Caching for LLMs](https://blog.premai.io/semantic-caching-for-llms-how-to-cut-api-bills-by-60-without-hurting-quality/)
- [LLM Token Optimization (Redis)](https://redis.io/blog/llm-token-optimization-speed-up-apps/)
- [Complete Guide to LLM Observability 2026](https://portkey.ai/blog/the-complete-guide-to-llm-observability/)

### Vercel AI SDK
- [AI SDK Introduction](https://ai-sdk.dev/docs/introduction)
- [AI SDK 6 Release Blog](https://vercel.com/blog/ai-sdk-6)
- [AI SDK OpenRouter Provider](https://ai-sdk.dev/providers/community-providers/openrouter)
- [AI SDK RAG Template](https://vercel.com/templates/next.js/ai-sdk-rag)
