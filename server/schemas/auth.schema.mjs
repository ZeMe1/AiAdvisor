import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string({ message: 'username is required' }).trim().min(1, 'username cannot be empty'),
  password: z.string({ message: 'password is required' }).min(1, 'password cannot be empty'),
});

export const twoFaSchema = z.object({
  code: z
    .string({ message: 'code is required' })
    .trim()
    .regex(/^\d{6}$/, 'Confirmation code must be exactly 6 digits'),
});
