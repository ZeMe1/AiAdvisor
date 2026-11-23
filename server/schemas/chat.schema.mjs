import { z } from 'zod';

export const sendMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message is too long (max 2000 characters)'),
});

export const addCourseToPlanSchema = z.object({
  courseCode: z
    .string()
    .trim()
    .min(1, 'Course code is required')
    .max(30, 'Course code is too long'),
  targetSemester: z.number().int().min(1).max(12).optional(),
});
