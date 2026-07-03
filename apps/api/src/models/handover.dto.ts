import { z } from 'zod';

/** Inbox list filter — which handover states to show. */
export const handoverInboxQuerySchema = z.object({
  filter: z.enum(['needs', 'handling', 'all']).default('needs'),
  agentId: z.string().uuid().optional(),
  // ADMIN/SUPER_ADMIN only — scope to one org. Ignored for CLIENT (own org).
  orgId: z.string().uuid().optional(),
});
export type HandoverInboxQuery = z.infer<typeof handoverInboxQuerySchema>;

/** Public ChatSession.sessionId in the route. */
export const handoverSessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(128),
});
export type HandoverSessionParams = z.infer<typeof handoverSessionParamsSchema>;

/** Body for a human agent's reply. */
export const handoverMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});
export type HandoverMessageDto = z.infer<typeof handoverMessageSchema>;
