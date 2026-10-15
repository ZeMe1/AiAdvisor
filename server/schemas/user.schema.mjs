import { z } from 'zod';

export const updateProfileSchema = z.object({
  display_name: z.string().trim().max(100, 'Имя слишком длинное (макс 100 символов)').optional().nullable(),
  avatar_url: z.string().max(500_000, 'Аватар слишком большой (макс 500 КБ)').optional().nullable(),
});

export const updateRoleSchema = z.object({
  role: z.enum(['Student', 'Advisor', 'Administrator'], {
    errorMap: () => ({ message: 'Недопустимая роль. Доступные: Student, Advisor, Administrator' }),
  }),
});

export const blockUserSchema = z.object({
  is_blocked: z.boolean({ required_error: 'Поле is_blocked обязательно' }),
});
