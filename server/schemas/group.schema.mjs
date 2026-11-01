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

export const importPreviewSchema = z.object({
  csvContent: z.string().min(1, 'CSV content cannot be empty'),
});

export const importExecuteSchema = z.object({
  rows: z.array(z.object({
    group_name: z.string().trim().min(1, 'Group name is required'),
    program: z.string().trim().optional().default('Information Systems'),
    study_year: z.coerce.number().int().min(1).max(6).optional().default(1),
    student_username: z.string().trim().min(1, 'Student username is required'),
  })).min(1, 'At least one student record is required for import'),
});
