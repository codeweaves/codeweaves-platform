import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { Public } from "../../decorators/public.decorator";
import { CryptoService } from "../../common/crypto/crypto.service";
import { ZodValidationPipe } from "../../pipes/zod-validation.pipe";
import { ChatService } from "../../services/chat.service";
import { ConsentService } from "../../services/consent.service";
import { MessageRateLimitService } from "../../services/message-rate-limit.service";
import { resolveWebVisitor } from "../../services/web-visitor";

const consentDecisionSchema = z.object({
  agentId: z.string().min(1).max(128),
  action: z.enum(["GRANT", "WITHDRAW"]),
  // SHA-256 hex of the notice the visitor saw. Required for GRANT (checked in
  // the service); a WITHDRAW must work even against a stale notice.
  noticeHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  // Which surface asked: the widget or the public demo page. A label only;
  // it unlocks nothing (see ConsentService.assertConsented).
  source: z.enum(["WIDGET", "DEMO"]).optional(),
});
type ConsentDecisionDto = z.infer<typeof consentDecisionSchema>;

/**
 * Chat-start consent decisions from the widget (ADR-0004).
 *
 * Public like the chat endpoints: the per-agent allowedDomains CORS check
 * covers `public/*`, and the message rate limiter caps abuse. The visitor is
 * identified by the widget's device ID, the same key the chat session uses,
 * so the session gate finds exactly this decision.
 */
@ApiTags("Public Chat")
@Public()
@Controller("public/consent")
export class PublicConsentController {
  constructor(
    private readonly chatService: ChatService,
    private readonly consentService: ConsentService,
    private readonly messageRateLimitService: MessageRateLimitService,
    private readonly crypto: CryptoService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Record a visitor consent decision (grant or withdraw)",
  })
  @ApiResponse({
    status: 200,
    description:
      "Decision recorded, or nothing to record (notice mode / notice off)",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid input or missing device ID",
  })
  @ApiResponse({ status: 404, description: "Agent not found or inactive" })
  @ApiResponse({
    status: 409,
    description:
      "The notice changed since the widget loaded it; body carries the current notice",
  })
  @ApiResponse({ status: 429, description: "Rate limited" })
  async decide(
    @Body(new ZodValidationPipe(consentDecisionSchema)) dto: ConsentDecisionDto,
    @Req() req: Request,
  ) {
    const rateLimit = await this.messageRateLimitService.checkMessageRateLimit(
      this.messageRateLimitService.getDeviceIdentifier(req),
      dto.agentId,
      this.messageRateLimitService.getClientIp(req),
    );
    if (!rateLimit.allowed) {
      throw new HttpException(
        {
          statusCode: 429,
          message: rateLimit.message,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        429,
      );
    }

    const visitor = resolveWebVisitor(this.crypto, req);
    if (!visitor.visitorId) {
      throw new BadRequestException("A valid X-Device-Id header is required");
    }
    if (dto.action === "GRANT" && !dto.noticeHash) {
      throw new BadRequestException("noticeHash is required to grant consent");
    }

    const agent = await this.chatService.resolveAgent(dto.agentId);
    const result = await this.consentService.record({
      agentId: agent.id,
      organizationId: agent.organizationId,
      source: dto.source ?? "WIDGET",
      visitor: { ...visitor, visitorId: visitor.visitorId },
      action: dto.action === "GRANT" ? "GRANTED" : "WITHDRAWN",
      method: dto.action === "GRANT" ? "WIDGET_BUTTON" : "WIDGET_WITHDRAW_LINK",
      noticeHash: dto.noticeHash,
    });

    return result.recorded
      ? { recorded: true, action: result.action, noticeHash: result.noticeHash }
      : { recorded: false };
  }
}
