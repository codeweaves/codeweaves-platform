import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Response, Request } from "express";
import { getRequestContext } from "../common/tracer/correlation.storage";
import { SentryService } from "../common/sentry/sentry.service";
import { TracerService } from "../common/tracer/tracer.service";
import {
  resolveChannel,
  capturesHttpEnvelope,
  extractEntityIds,
} from "../common/events/resolve-channel";
import { CryptoService } from "../common/crypto/crypto.service";
import { maskPiiText } from "../modules/pii/mask-pii";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private readonly sentryService: SentryService,
    private readonly tracer: TracerService,
    private readonly crypto: CryptoService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const context = getRequestContext();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    if (status >= 500) {
      // Console output (Render logs) is a log too: an error can echo the input.
      this.logger.error(
        `[${context?.correlationId?.slice(0, 8) ?? "no-ctx"}] ${request.method} ${request.originalUrl} — ${maskPiiText(String(exception))}`,
        exception instanceof Error && exception.stack
          ? maskPiiText(exception.stack)
          : undefined,
      );

      this.sentryService.captureException(exception, {
        correlationId: context?.correlationId,
        method: request.method,
        url: request.originalUrl,
      });
    }

    // Fire-and-forget failed-request envelope: the SINGLE capture point for
    // failed mutating requests, including 4xx thrown by guards (401/403/429)
    // that never reach the interceptor. Bodies are PII-masked by the event_logs
    // writer (ADR-0005).
    //
    //   DASHBOARD / INTERNAL: every failure (auth and validation rejections
    //   are auditable).
    //   WIDGET / VOICE / WHATSAPP: server errors (5xx) only. Those are our bugs
    //   and Sentry no longer carries bodies, so this row is where the detail
    //   lives. Client errors on public endpoints (bad input, 404, rate limit)
    //   are bot and scanner noise, and logging each would let anyone fill the
    //   table.
    const channel = resolveChannel(request.originalUrl);
    const isPublic = !capturesHttpEnvelope(channel);
    if (
      process.env.EVENT_LOG_HTTP_CAPTURE !== "false" &&
      MUTATING.has(request.method) &&
      (!isPublic || status >= 500)
    ) {
      const ids = extractEntityIds(request.originalUrl, request.params ?? {});
      const { agentId, organizationId } = ids;
      // Link public rows to the conversation and the visitor, so visitor
      // erasure finds them: the session id travels in the body, the visitor
      // is the hashed device id (never the raw header).
      const body = request.body as { sessionId?: unknown } | undefined;
      const sessionId =
        ids.sessionId ??
        (isPublic && typeof body?.sessionId === "string"
          ? body.sessionId.slice(0, 128)
          : undefined);
      const deviceHeader = request.headers?.["x-device-id"];
      const visitorId = isPublic
        ? this.crypto.hashVisitorDevice(
            Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader,
          )
        : undefined;
      void this.tracer.logEvent({
        channel,
        eventName: `${channel}_HTTP_ERROR`,
        direction: "INBOUND",
        agentId,
        organizationId,
        sessionId,
        visitorId,
        requestUrl: request.originalUrl,
        requestHeaders: request.headers,
        requestPayload: request.body,
        responseStatus: status,
        success: false,
        errorMessage:
          exception instanceof Error ? exception.message : String(exception),
        metadata: {
          method: request.method,
          // Stack only for 5xx — 4xx are expected business rejections.
          ...(status >= 500 && exception instanceof Error
            ? { stack: exception.stack }
            : {}),
        },
      });
    }

    // Preserve structured HttpException responses (e.g. { message, reissueToken })
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : typeof exceptionResponse === "object" && exceptionResponse !== null
          ? ((exceptionResponse as Record<string, unknown>)["message"] ??
            "Internal server error")
          : "Internal server error";

    const body: Record<string, unknown> = {
      statusCode: status,
      message,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    };

    // Merge extra fields from structured HttpException responses
    if (typeof exceptionResponse === "object" && exceptionResponse !== null) {
      const extra = Object.fromEntries(
        Object.entries(exceptionResponse as Record<string, unknown>).filter(
          ([key]) => !["statusCode", "message", "error"].includes(key),
        ),
      );
      Object.assign(body, extra);
    }

    response.status(status).json(body);
  }
}
