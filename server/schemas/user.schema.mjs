import { z } from 'zod';

export const updateProfileSchema = z.object({
  display_name: z.string().trim().max(100, 'Name too long (max 100 characters)').optional().nullable(),
  avatar_url: z.string().max(500_000, 'Avatar data too large (max 500 KB)').optional().nullable(),
});

export const updateRoleSchema = z.object({
  role: z.enum(['Student', 'Advisor', 'Administrator'], {
    errorMap: () => ({ message: 'Invalid role. Allowed: Student, Advisor, Administrator' }),
  }),
});

export const blockUserSchema = z.object({
  is_blocked: z.boolean({ required_error: 'is_blocked field is required' }),
});
