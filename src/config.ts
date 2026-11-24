import { z } from 'zod';

const Env = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),
  ADMIN_API_KEY: z.string().min(12),
  DEFAULT_MODEL: z.string().default('claude-haiku-5-5'),
  DEFAULT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  HISTORY_LIMIT: z.coerce.number().default(20),
  MAX_TOOL_TURNS: z.coerce.number().default(6),
  DEBOUNCE_MS: z.coerce.number().default(2500),
});

export const config = Env.parse(process.env);
export type Effort = z.infer<typeof Env>['DEFAULT_EFFORT'];
