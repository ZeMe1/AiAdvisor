import { z } from 'zod';

export const guardrailConfigSchema = z.object({
  blocked_categories: z
    .array(z.enum(['politics', 'medical', 'legal', 'personal']))
    .default(['politics', 'medical', 'legal', 'personal']),
  custom_blocked_keywords: z
    .array(z.string().trim().min(1).max(80))
    .max(100)
    .default([]),
  refusal_message_en: z
    .string()
    .trim()
    .min(10, 'English refusal message must be at least 10 characters')
    .max(500),
  refusal_message_ru: z
    .string()
    .trim()
    .min(10, 'Russian refusal message must be at least 10 characters')
    .max(500),
  disclaimer_text: z
    .string()
    .trim()
    .min(5, 'Disclaimer text must be at least 5 characters')
    .max(300),
  official_deadlines: z
    .object({
      drop_deadline: z.string().trim().min(3).max(400),
      registration_deadline: z.string().trim().min(3).max(400),
      retake_rule: z.string().trim().min(3).max(400),
    })
    .optional(),
  redact_sensitive_data: z.boolean().default(true),
});
