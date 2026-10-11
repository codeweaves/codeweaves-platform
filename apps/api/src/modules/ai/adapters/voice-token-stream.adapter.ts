import type { TokenStreamChunk } from "../../voice/token-stream.interface";
import type {
  DirectChatResult,
  DirectChatStreamChunk,
} from "../interfaces/direct-chat.interfaces";

/**
 * Voice token-stream adapter: convert a DirectChatService stream into the
 * chunk format that `VoiceService.streamingTTS()` + `SentenceBuffer` consume.
 * The voice pipeline is format-agnostic internally; it just needs a stream of
 * `{ type: 'item', content: string }` chunks.
 *
 * Why an adapter? We deliberately don't rewrite the voice pipeline, we adapt
 * into it. This lets direct-mode agents reuse the battle-tested voice stack
 * (sentence buffering, per-sentence TTS with fallback, NDJSON streaming) with
 * zero duplicate code.
 *
 * What passes through:
 *   - `text-delta` chunks become `{ type: 'item', content, metadata: { timestamp } }`
 *     — the shape SentenceBuffer expects.
 *
 * What's exposed via `onFinish` callback (rather than yielded):
 *   - The LLM's full `DirectChatResult` — ttftMs, model, usage tokens, cost,
 *     latencyMs, finishReason, traceId. The voice pipeline doesn't need these
 *     to do its job, but the controller persists them into the assistant
 *     message metadata so analytics can show LLM-vs-STT-vs-TTS breakdown.
 *
 * What's dropped silently:
 *   - `trace` chunks (orchestration metadata, not tokens) — callers that want
 *     trace events should subscribe separately via AiTraceService.subscribe.
 *   - `error` chunks — re-thrown so the voice pipeline's try/catch maps them
 *     to a user-facing NDJSON error chunk.
 *
 * @param source   The DirectChatService stream (from `.stream()`)
 * @param onFinish Optional callback invoked once when the LLM stream finishes.
 *                 Receives the full DirectChatResult including LLM TTFT, tokens,
 *                 cost, etc. The yielded `end` chunk does NOT carry these
 *                 because TokenStreamChunk lacks those fields; the callback is
 *                 the side-channel.
 * @returns An AsyncGenerator of TokenStreamChunk for VoiceService.streamingTTS
 */
export async function* directChatToTokenStream(
  source: AsyncIterable<DirectChatStreamChunk>,
  onFinish?: (result: DirectChatResult) => void,
): AsyncGenerator<TokenStreamChunk> {
  let hasEmittedBegin = false;

  for await (const chunk of source) {
    switch (chunk.type) {
      case "text-delta":
        // Emit a synthetic 'begin' on the first token so downstream code that
        // relies on begin/item/end ordering (rare, but possible) still sees it.
        if (!hasEmittedBegin) {
          hasEmittedBegin = true;
          yield {
            type: "begin",
            metadata: { timestamp: Date.now() },
          };
        }
        if (chunk.content) {
          yield {
            type: "item",
            content: chunk.content,
            metadata: { timestamp: Date.now() },
          };
        }
        break;

      case "finish":
        // Expose the LLM result before yielding `end` so the caller has the
        // values in time to bake them into the assistant-message metadata.
        if (onFinish) {
          onFinish(chunk.result);
        }
        yield {
          type: "end",
          metadata: { timestamp: Date.now() },
        };
        break;

      case "error":
        // Propagate as a real thrown error — the voice pipeline has proper
        // try/catch around `streamingTTS` that maps this to a user-facing
        // NDJSON error chunk.
        throw new Error(chunk.error);

      case "trace":
        // Trace events are orchestration metadata; the voice pipeline doesn't
        // care about them. AiTraceService already logs them to file + DB.
        break;
    }
  }
}
