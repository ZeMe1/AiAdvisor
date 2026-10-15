import { z } from 'zod';

export const sectionsQuerySchema = z.object({
  code: z.string({ required_error: 'укажите ?code=' }).trim().min(1, 'код курса не может быть пустым'),
  mufSqId: z.string().optional(),
});

export const searchQuerySchema = z.object({
  code: z.string({ required_error: 'укажите ?code=' }).trim().min(1, 'код курса не может быть пустым'),
});

export const electivesBodySchema = z.object({
  dk: z.string({ required_error: 'укажите dk (код заглушки электива)' }).trim().min(1),
  mufSqId: z.union([z.string(), z.number()]).optional().nullable(),
  periodNo: z.union([z.string(), z.number()]).optional().nullable(),
  groupName: z.string().optional().nullable(),
  candidates: z.array(z.string()).optional().default([]),
  codeType: z.string().optional().default('R'),
  lgCode: z.string().optional().default(''),
  type: z.string().optional().default('NAE'),
});
