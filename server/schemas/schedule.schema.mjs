import { z } from 'zod';

export const sectionsQuerySchema = z.object({
  code: z.string({ required_error: 'specify ?code=' }).trim().min(1, 'course code cannot be empty'),
  mufSqId: z.string().optional(),
});

export const searchQuerySchema = z.object({
  code: z.string({ required_error: 'specify ?code=' }).trim().min(1, 'course code cannot be empty'),
});

export const electivesBodySchema = z.object({
  dk: z.string({ required_error: 'specify dk (elective course code)' }).trim().min(1),
  mufSqId: z.union([z.string(), z.number()]).optional().nullable(),
  periodNo: z.union([z.string(), z.number()]).optional().nullable(),
  groupName: z.string().optional().nullable(),
  candidates: z.array(z.string()).optional().default([]),
  codeType: z.string().optional().default('R'),
  lgCode: z.string().optional().default(''),
  type: z.string().optional().default('NAE'),
});
