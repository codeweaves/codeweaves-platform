/**
 * One chunk of the reply token stream that feeds `VoiceService.streamingTTS()`
 * and its `SentenceBuffer`. `begin` and `end` bracket the stream; `item` carries
 * a piece of reply text. DirectChatService output is adapted into this shape by
 * `directChatToTokenStream`.
 */
export type TokenStreamChunkType = "begin" | "item" | "end";

export interface TokenStreamChunk {
  type: TokenStreamChunkType;
  content?: string;
  metadata?: { timestamp: number };
}
