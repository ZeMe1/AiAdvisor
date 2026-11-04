import { z } from 'zod';

export const recommendationConfigSchema = z
  .object({
    min_ects: z
      .coerce
      .number({ required_error: 'min_ects is required' })
      .int('Minimum ECTS must be an integer')
      .min(20, 'Minimum semester registration limit cannot be less than 20 ECTS')
      .max(40, 'Minimum semester registration limit cannot exceed 40 ECTS'),
    max_ects: z
      .coerce
      .number({ required_error: 'max_ects is required' })
      .int('Maximum ECTS must be an integer')
      .min(20, 'Maximum semester registration limit cannot be less than 20 ECTS')
      .max(40, 'Maximum semester registration limit cannot exceed 40 ECTS'),
    gpa_weight: z.coerce.number().min(0, 'GPA weight must be non-negative').default(1.0),
    retake_weight: z.coerce.number().min(0, 'Retake weight must be non-negative').default(2.0),
    interest_weight: z.coerce.number().min(0, 'Interest weight must be non-negative').default(1.5),
    disabled_programs: z.array(z.string()).optional().default([]),
  })
  .refine((data) => data.min_ects <= data.max_ects, {
    message: 'Min cannot be greater than max',
    path: ['min_ects'],
  });
