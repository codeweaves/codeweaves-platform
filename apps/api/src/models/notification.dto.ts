import { z } from 'zod';

/** Bell list paging. `limit` is clamped again in the service — the schema is
 *  the first gate, not the only one. */
export const notificationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type NotificationIdParams = z.infer<typeof notificationIdParamsSchema>;
