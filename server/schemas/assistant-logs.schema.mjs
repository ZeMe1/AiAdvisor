import { z } from 'zod';

export const flagAssistantLogSchema = z.object({
  status: z.enum(['wrong', 'helpful', 'resolved']),
  comment: z.string().trim().max(1000).optional().default(''),
});
