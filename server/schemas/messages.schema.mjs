import { z } from 'zod';

export const sendDirectMessageSchema = z.object({
  advisorUsername: z.string().trim().min(1).max(255).optional(),
  content: z
    .string({ required_error: 'Message cannot be empty' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message cannot exceed 2000 characters'),
});

export const sendAdvisorReplySchema = z.object({
  content: z
    .string({ required_error: 'Message cannot be empty' })
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message cannot exceed 2000 characters'),
});

export const sendAnnouncementSchema = z.object({
  content: z
    .string({ required_error: 'Announcement cannot be empty' })
    .trim()
    .min(1, 'Announcement cannot be empty')
    .max(2000, 'Announcement cannot exceed 2000 characters'),
});

export const updateOfficeHoursSchema = z.object({
  office_hours: z
    .string()
    .trim()
    .max(200, 'Office hours cannot exceed 200 characters')
    .optional()
    .default(''),
  response_time_note: z
    .string()
    .trim()
    .max(255, 'Response time note cannot exceed 255 characters')
    .optional()
    .default(''),
});

export const syncQuerySchema = z.object({
  since: z.string().optional(),
});

export const studentDialogQuerySchema = z.object({
  advisor: z.string().trim().optional(),
});
