import type { N8nStreamChunk } from '../../../services/n8n-stream.interface';
import type {
  DirectChatResult,
  DirectChatStreamChunk,
} from '../interfaces/direct-chat.interfaces';

/**
 * Voice token-stream adapter: convert a DirectChatService stream into the
 * chunk format that `VoiceService.streamingTTS()` + `SentenceBuffer` consume.
 *
 * Despite the target type being called `N8nStreamChunk`, this adapter has
 * NOTHING TO DO with n8n. The type name is a historical holdover from when
 * n8n was the only thing feeding the voice pipeline — the voice pipeline is
 * format-agnostic internally; it just needs a stream of
 * `{ type: 'item', content: string }` chunks.
 *
 * Future cleanup: rename `N8nStreamChunk` → `VoiceTokenChunk` and consumers
 * follow. For now, the naming asymmetry is documented so it's not confusing.
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
 *                 because N8nStreamChunk lacks those fields; the callback is
 *                 the side-channel.
 * @returns An AsyncGenerator matching N8nStreamingService.streamFromWebhookUrl
 */
export async function* directChatToN8nStream(
  source: AsyncIterable<DirectChatStreamChunk>,
  onFinish?: (result: DirectChatResult) => void,
): AsyncGenerator<N8nStreamChunk> {
  let hasEmittedBegin = false;

  for await (const chunk of source) {
    switch (chunk.type) {
      case 'text-delta':
        // Emit a synthetic 'begin' on the first token so downstream code that
        // relies on begin/item/end ordering (rare, but possible) still sees it.
        if (!hasEmittedBegin) {
          hasEmittedBegin = true;
          yield {
            type: 'begin',
            metadata: { timestamp: Date.now() },
          };
        }
        if (chunk.content) {
          yield {
            type: 'item',
            content: chunk.content,
            metadata: { timestamp: Date.now() },
          };
        }
        break;

      case 'finish':
        // Expose the LLM result before yielding `end` so the caller has the
        // values in time to bake them into the assistant-message metadata.
        if (onFinish) {
          onFinish(chunk.result);
        }
        yield {
          type: 'end',
          metadata: { timestamp: Date.now() },
        };
        break;

      case 'error':
        // Propagate as a real thrown error — the voice pipeline has proper
        // try/catch around `streamingTTS` that maps this to a user-facing
        // NDJSON error chunk.
        throw new Error(chunk.error);

      case 'trace':
        // Trace events are orchestration metadata; the voice pipeline doesn't
        // care about them. AiTraceService already logs them to file + DB.
        break;
    }
  }
}
