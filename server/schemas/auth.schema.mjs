import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string({ message: 'username обязателен' }).trim().min(1, 'username не может быть пустым'),
  password: z.string({ message: 'password обязателен' }).min(1, 'password не может быть пустым'),
});

export const twoFaSchema = z.object({
  code: z
    .string({ message: 'code обязателен' })
    .trim()
    .regex(/^\d{6}$/, 'Код подтверждения должен состоять ровно из 6 цифр'),
});
