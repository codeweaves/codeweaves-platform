import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import * as Sentry from '@sentry/nestjs';
import { AppLogger } from '../../common/logger/app-logger';
import { VoiceService } from './voice.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserData } from '../../decorators/current-user.decorator';
import {
  voicePreviewRequestSchema,
  voiceErrorCodes,
  type VoicePreviewRequestDto,
  type VoiceListResponseDto,
  type TtsProviderEnum,
} from '@repo/validation';
import {
  UnsupportedLanguageError,
  VoiceProviderError,
} from './providers/voice-provider.interface';

/** Per-user preview rate limit. The 24h response cache already bounds upstream API spend
 *  globally (each provider+voiceId+language is synthesized at most once per 24h), so this
 *  rate limit is the per-user abuse-protection layer on top: catches click-loops and
 *  scripts without punishing legitimate exploration. 60/min matches the typical SaaS
 *  per-user quota for cheap UI actions. */
const PREVIEW_WINDOW_MS = 60_000;                  // 1 minute
const PREVIEW_MAX_PER_WINDOW = 60;                 // 60 previews per user per minute

@ApiTags('Voices')
@Controller('voices')
export class VoicesController {
  private readonly log = new AppLogger(VoicesController.name);
  /** userId → request timestamps inside the current window. Sliding window. */
  private readonly previewRateLimits = new Map<string, number[]>();

  constructor(private readonly voiceService: VoiceService) {}

  @Get()
  @ApiOperation({ summary: 'List available TTS voices grouped by provider' })
  @ApiResponse({ status: 200, description: 'Provider catalog with voices' })
  async listVoices(): Promise<VoiceListResponseDto> {
    this.log.debug('listVoices', 'listing TTS voice catalog');
    const providers = await this.voiceService.listAllVoices();
    // VoiceService only registers our TTS providers (sarvam/elevenlabs) under listAllVoices,
    // so the cast to TtsProviderEnum is safe at runtime.
    return {
      providers: providers.map((p) => ({
        provider: p.provider as TtsProviderEnum,
        voices: p.voices,
      })),
    };
  }

  @Post('preview')
  @ApiOperation({ summary: 'Synthesize a short sample of a voice for preview' })
  @ApiResponse({ status: 200, description: 'Base64-encoded preview audio' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 422, description: 'Unsupported language or synthesis failure' })
  @ApiResponse({ status: 429, description: 'Rate limited — too many previews from this user' })
  @ApiResponse({ status: 502, description: 'TTS provider unavailable' })
  async previewVoice(
    @Body(new ZodValidationPipe(voicePreviewRequestSchema)) dto: VoicePreviewRequestDto,
    @CurrentUser() user: CurrentUserData,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rate = this.checkPreviewRateLimit(user.id);
    if (!rate.allowed) {
      this.log.warn('previewVoice', 'preview rate limited', {
        userId: user.id,
        retryAfterSeconds: rate.retryAfterSeconds,
      });
      res.status(HttpStatus.TOO_MANY_REQUESTS);
      return {
        error: true,
        errorCode: voiceErrorCodes.RATE_LIMITED,
        message: `Too many voice previews — try again in ${rate.retryAfterSeconds}s.`,
        retryAfterSeconds: rate.retryAfterSeconds,
      };
    }

    try {
      this.log.debug('previewVoice', 'synthesizing preview', {
        provider: dto.provider,
        voiceId: dto.voiceId,
        language: dto.language ?? 'en',
      });
      const result = await this.voiceService.previewVoice(
        dto.provider,
        dto.voiceId,
        dto.language,
      );
      return {
        audio: result.audio.toString('base64'),
        format: result.audioFormat,
      };
    } catch (error) {
      const { errorCode, status } = this.classifyError(error);
      this.log.warn('previewVoice', 'preview failed', {
        provider: dto.provider,
        voiceId: dto.voiceId,
        language: dto.language ?? 'en',
        error: error instanceof Error ? error.message : 'unknown',
      });
      Sentry.withScope((scope) => {
        scope.setContext('voice_preview', {
          provider: dto.provider,
          voiceId: dto.voiceId,
          language: dto.language ?? 'en',
        });
        scope.setLevel('warning');
        if (error instanceof Error) {
          Sentry.captureException(error);
        }
      });
      res.status(status);
      return {
        error: true,
        errorCode,
        message: 'Voice preview unavailable',
      };
    }
  }

  /** Sliding-window rate check. Prunes the user's bucket on every call (so memory stays
   *  bounded by active users in the last minute, not lifetime users). */
  private checkPreviewRateLimit(
    userId: string,
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = Date.now();
    const cutoff = now - PREVIEW_WINDOW_MS;
    const recent = (this.previewRateLimits.get(userId) ?? []).filter((t) => t > cutoff);

    if (recent.length >= PREVIEW_MAX_PER_WINDOW) {
      const oldestInWindow = recent[0]!;
      this.previewRateLimits.set(userId, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldestInWindow + PREVIEW_WINDOW_MS - now) / 1000),
        ),
      };
    }

    recent.push(now);
    if (recent.length === 0) this.previewRateLimits.delete(userId);
    else this.previewRateLimits.set(userId, recent);
    return { allowed: true };
  }

  /** Test hook — clear the rate-limit map between specs without exposing internal state. */
  clearPreviewRateLimit(): void {
    this.previewRateLimits.clear();
  }

  private classifyError(error: unknown): { errorCode: string; status: number } {
    if (error instanceof UnsupportedLanguageError) {
      return { errorCode: voiceErrorCodes.UNSUPPORTED_LANGUAGE, status: HttpStatus.UNPROCESSABLE_ENTITY };
    }
    if (error instanceof VoiceProviderError) {
      const providerStatus = error.getStatus();
      if (providerStatus === HttpStatus.GATEWAY_TIMEOUT) {
        return { errorCode: voiceErrorCodes.PROVIDER_TIMEOUT, status: HttpStatus.GATEWAY_TIMEOUT };
      }
      return { errorCode: voiceErrorCodes.PROVIDER_UNAVAILABLE, status: providerStatus };
    }
    return { errorCode: voiceErrorCodes.TTS_FAILED, status: HttpStatus.UNPROCESSABLE_ENTITY };
  }
}
