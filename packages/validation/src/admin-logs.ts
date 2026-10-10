/**
 * Ops console (platform-only) query schemas: the audit log, the event log and
 * the event-log detail. The date window defaults and caps live in the API
 * service, because they depend on "now".
 */
import { z } from "zod";

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid ISO datetime");

/** Comma-separated list (`?a=x,y`) parsed into a de-duplicated array. */
function csvList<T extends z.ZodTypeAny>(item: T) {
  return z
    .string()
    .optional()
    .transform((v) =>
      v
        ? [
            ...new Set(
              v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ]
        : undefined,
    )
    .pipe(z.array(item).max(50).optional());
}

const pageFields = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
};

const fromBeforeTo = (q: { from?: string; to?: string }) =>
  !q.from || !q.to || new Date(q.from) <= new Date(q.to);

export const auditLogListQuerySchema = z
  .object({
    ...pageFields,
    /** Substring match on the event name. */
    search: z.string().trim().max(200).optional(),
    organizationId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    events: csvList(z.string().max(120)),
  })
  .refine(fromBeforeTo, { message: "from must be before to", path: ["from"] });

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;

export const eventLogChannelSchema = z.enum([
  "WIDGET",
  "DASHBOARD",
  "WHATSAPP",
  "VOICE",
  "INTERNAL",
  "SYSTEM",
]);

export const eventLogListQuerySchema = z
  .object({
    ...pageFields,
    /** Substring match on the event name, or an exact session / correlation id. */
    search: z.string().trim().max(200).optional(),
    channels: csvList(eventLogChannelSchema),
    providers: csvList(z.string().max(50)),
    eventName: z.string().trim().max(120).optional(),
    success: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "true")),
    organizationId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    sessionId: z.string().trim().max(200).optional(),
  })
  .refine(fromBeforeTo, { message: "from must be before to", path: ["from"] });

export type EventLogListQuery = z.infer<typeof eventLogListQuerySchema>;
