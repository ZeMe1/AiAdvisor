import { z } from 'zod';

export const createGroupSchema = z.object({
  name: z.string().trim().min(2, 'Group name must be at least 2 characters').max(100),
  program: z.string().trim().min(2, 'Program is required').max(255),
  study_year: z.coerce.number().int().min(1).max(6).default(1),
  advisor_username: z.string().trim().nullable().optional(),
});

export const assignAdvisorSchema = z.object({
  advisor_username: z.string().trim().nullable().optional(),
});
