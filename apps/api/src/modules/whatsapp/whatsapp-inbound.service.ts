import { Injectable, Logger } from '@nestjs/common';

import { CryptoService } from '../../common/crypto/crypto.service';
import { ChatService } from '../../services/chat.service';
import { PrismaService } from '../../services/prisma.service';
import { DirectChatService } from '../ai/direct-chat.service';
import type { DirectChatResult } from '../ai/interfaces/direct-chat.interfaces';
import type { SupportedLanguage } from '../voice/providers/voice-provider.interface';
import { VoiceService } from '../voice/voice.service';

import { WhatsappInboundJob } from './interfaces/whatsapp.interfaces';
import { markdownToPlainText, markdownToWhatsapp } from './whatsapp-format';
import { WhatsappSendService } from './whatsapp-send.service';
import { detectFallback } from '../../utils/fallback-detection';

/** Sent when orchestration fails, so the user isn't left on silent read. */
const FALLBACK_REPLY =
  "Sorry — I'm having trouble responding right now. Please try again in a moment.";

/** Sent when an inbound voice note can't be transcribed. */
const CANT_TRANSCRIBE_REPLY =
  "Sorry — I couldn't make out that voice note. Could you try again, or send it as text?";

/** Mask a phone number for logs — keep only the last 4 digits. */
function maskPhone(phone: string): string {
  return phone.length <= 4 ? '****' : `***${phone.slice(-4)}`;
}

/**
 * Processes one inbound WhatsApp message (text or voice note) end-to-end. This is
 * the WhatsApp equivalent of PublicChatController.stream, but buffered (WhatsApp
 * takes a complete message, not a token stream) and async (runs in a BullMQ worker).
 * Voice notes are transcribed to text first, then handled identically.
 *
 * Reuses the exact channel-agnostic core: ChatService for sessions/persistence
 * and DirectChatService.send() for the LLM turn. Nothing here is WhatsApp-specific
 * except the transport (download → run → send back via Graph API).
 */
@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly chatService: ChatService,
    private readonly directChat: DirectChatService,
    private readonly whatsappSend: WhatsappSendService,
    private readonly voiceService: VoiceService,
  ) {}

  async handleInbound(job: WhatsappInboundJob): Promise<void> {
    const { phoneNumberId, from, messageId } = job;

    // 1. Resolve the channel (routing key → agent). Must be CONNECTED.
    const channel = await this.prisma.whatsappChannel.findUnique({
      where: { phoneNumberId },
    });
    if (!channel || channel.status !== 'CONNECTED') {
      this.logger.warn(
        `Inbound for unknown/inactive channel (phoneNumberId=${phoneNumberId}) — dropping.`,
      );
      return;
    }

    // 2. Load the full, active agent (DirectChatService needs the whole entity).
    const agent = await this.prisma.agent.findFirst({
      where: { id: channel.agentId, deletedAt: null, status: 'ACTIVE' },
    });
    if (!agent) {
      this.logger.warn(
        `Channel ${channel.id} points at missing/inactive agent ${channel.agentId} — dropping.`,
      );
      return;
    }

    // 3. Decrypt the access token.
    let accessToken: string;
    try {
      accessToken = this.crypto.decrypt(channel.accessTokenEnc);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt token for channel ${channel.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // 4. Acknowledge + show "typing…" while we think (best-effort).
    await this.whatsappSend.markReadAndShowTyping(
      phoneNumberId,
      accessToken,
      messageId,
    );

    // Start the response-time clock here — after ack/typing, before we produce
    // the reply — so it mirrors the widget's `backendReceivedAt` exactly:
    // server-side wall-clock covering STT + LLM + TTS + send (received -> sent).
    const backendReceivedAt = new Date();

    // 4b. Resolve the user's text. Voice notes (type 'audio') are downloaded and
    //     transcribed via the existing STT pipeline; the transcript becomes the
    //     message we run + persist, so conversation history stays text-based and
    //     channel-neutral.
    let userText: string;
    let sttLanguage: SupportedLanguage | undefined;
    if (job.type === 'audio') {
      if (!job.mediaId) {
        this.logger.warn(`Audio job ${messageId} has no mediaId — dropping.`);
        return;
      }
      try {
        const media = await this.whatsappSend.downloadMedia(
          job.mediaId,
          accessToken,
        );
        const stt = await this.voiceService.transcribe({
          audio: media.buffer,
          audioFormat: media.mimeType,
          agentId: agent.id,
        });
        userText = stt.transcript?.trim() ?? '';
        sttLanguage = stt.detectedLanguage;
      } catch (err) {
        this.logger.error(
          `Transcription failed for ${maskPhone(from)} (msg ${messageId}): ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.whatsappSend
          .sendText(phoneNumberId, accessToken, from, CANT_TRANSCRIBE_REPLY)
          .catch(() => undefined);
        return;
      }
      if (!userText) {
        this.logger.warn(`Empty transcript for ${messageId} — asking user to retry.`);
        await this.whatsappSend
          .sendText(phoneNumberId, accessToken, from, CANT_TRANSCRIBE_REPLY)
          .catch(() => undefined);
        return;
      }
    } else {
      userText = job.text?.trim() ?? '';
      if (!userText) {
        this.logger.warn(`Text job ${messageId} has an empty body — dropping.`);
        return;
      }
    }

    // 5. Resolve/create the session, keyed by the customer's phone number. The
    //    agent's sessionLifetimeHours (default 6h) applies exactly as it does for
    //    the widget: a returning customer continues their thread until the cap,
    //    then rotates to a fresh session.
    const session = await this.chatService.resolveOrCreateVisitorSession(
      agent.id,
      'WHATSAPP',
      from,
    );

    // 5b. Human handover: if a teammate is handling this WhatsApp chat, capture
    //     the inbound message + push it to the dashboard, and DO NOT reply with
    //     the AI. (Delivering the human's reply back out via WhatsApp is a
    //     separate outbound piece — for now this just stops the double-reply.)
    if (this.chatService.isPausedForHuman(session)) {
      await this.chatService.recordPausedInbound(session, agent.organizationId, userText);
      this.logger.log(
        `WhatsApp session ${session.sessionId} is in human handover — AI reply suppressed.`,
      );
      return;
    }

    // 6. Persist the inbound message before calling the LLM (survives LLM failure).
    await this.chatService.saveUserMessage(session.id, userText);

    // 6b. Human handover parity with the widget/voice: a "talk to a human"
    //     keyword escalates immediately; otherwise the model gets the
    //     connect_to_human tool so it can escalate on frustration / consent.
    //     Either way the bot stalls politely, and we ping the dashboard after the
    //     turn so the WhatsApp exchange shows in the live thread.
    const escalated = await this.chatService.maybeEscalateToHuman(session, agent, userText);
    const inHandover = escalated || session.handoverState === 'REQUESTED';
    let toolEscalated = false;
    const offerHumanTools =
      agent.humanTakeoverEnabled && session.source !== 'DEMO' && !inHandover
        ? {
            connect_to_human: this.chatService.buildHumanConnectTool(
              session,
              agent.organizationId,
              () => {
                toolEscalated = true;
              },
            ),
          }
        : undefined;

    // 7. Run the agent (buffered — no streaming on WhatsApp).
    let result: DirectChatResult;
    try {
      result = await this.directChat.send({
        agent,
        chatSessionId: session.id,
        externalSessionId: session.sessionId,
        newUserMessage: userText,
        feature: 'chat',
        extraSystemInstruction: inHandover
          ? this.chatService.handoverStallInstruction(agent)
          : offerHumanTools
            ? this.chatService.humanOfferInstruction()
            : undefined,
        tools: offerHumanTools,
        maxSteps: offerHumanTools ? 3 : undefined,
      });
    } catch (err) {
      this.logger.error(
        `Orchestration failed for session ${session.sessionId} (${maskPhone(from)}): ${err instanceof Error ? err.message : String(err)}`,
      );
      // Best-effort fallback so the user isn't left hanging.
      await this.whatsappSend
        .sendText(phoneNumberId, accessToken, from, FALLBACK_REPLY)
        .catch(() => undefined);
      return;
    }

    const replyText = result.text?.trim() ?? '';
    if (!replyText) {
      this.logger.warn(
        `Empty reply for session ${session.sessionId} — nothing to send.`,
      );
      return;
    }

    // 8. Deliver the reply. If the agent has voice replies enabled AND the inbound
    //    was a voice note, answer with a voice note (TTS -> upload -> send audio);
    //    otherwise, or if anything in that path fails, fall back to formatted text.
    //    We persist the original Markdown either way (channel-neutral history).
    let outboundId: string | null = null;
    let delivered = false;
    let replyMode: 'text' | 'voice' = 'text';

    if (channel.voiceReplyEnabled && job.type === 'audio') {
      try {
        const tts = await this.voiceService.synthesize({
          text: markdownToPlainText(replyText),
          language: sttLanguage ?? 'en',
          agentId: agent.id,
        });
        const mediaId = await this.whatsappSend.uploadMedia(
          phoneNumberId,
          accessToken,
          tts.audio,
          tts.audioFormat,
        );
        outboundId = await this.whatsappSend.sendAudio(
          phoneNumberId,
          accessToken,
          from,
          mediaId,
        );
        delivered = true;
        replyMode = 'voice';
      } catch (err) {
        this.logger.warn(
          `Voice reply failed for session ${session.sessionId} — falling back to text: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!delivered) {
      const whatsappText = markdownToWhatsapp(replyText);
      try {
        outboundId = await this.whatsappSend.sendText(
          phoneNumberId,
          accessToken,
          from,
          whatsappText,
        );
        delivered = true;
      } catch (err) {
        this.logger.error(
          `Failed to deliver reply for session ${session.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 9. Persist the assistant message + bump the session timestamp. Metadata uses
    //    the same key names as the widget path so analytics needn't special-case
    //    the channel.
    await this.chatService.saveAssistantMessage(session.id, replyText, {
      channel: 'whatsapp',
      // Match the widget's voice tagging so the conversations UI shows the same
      // "Voice" badge (it reads metadata.inputType === 'voice').
      inputType: job.type === 'audio' ? 'voice' : 'text',
      replyMode,
      // Language detected from the voice note's STT (en/hi/…), same key the widget
      // uses. Null for text inbound — the post-session classifier sets the
      // session-level language for those, exactly as it does for widget text.
      detectedLanguage: sttLanguage ?? null,
      waInboundId: messageId,
      waOutboundId: outboundId,
      delivered,
      traceId: result.traceId,
      model: result.model,
      cost: result.cost,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      finishReason: result.finishReason,
      // Same definition as the widget: backend wall-clock from inbound-received
      // to reply-sent. The LLM's own generation time is kept separate.
      responseLatencyMs: Date.now() - backendReceivedAt.getTime(),
      llmLatencyMs: result.latencyMs,
      ...detectFallback(replyText, agent.fallbackPhrases),
    });
    await this.chatService.updateSessionTimestamp(session.id);

    // 10. Handover: ping the dashboard so the WhatsApp bot turn shows in the
    //     live Inbox thread while a teammate is being connected (keyword OR the
    //     model's connect_to_human tool).
    if (inHandover || toolEscalated) {
      await this.chatService.publishHandoverBotTurn(session, agent.organizationId);
    }
  }
}
