import { z } from 'zod';

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`);

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const int = (def: number, min: number) =>
  z.coerce.number().int().min(min).default(def);

export const envSchema = z.object({
  PORT: int(3000, 1),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  MONGO_URI: required('MONGO_URI'),
  QDRANT_URL: required('QDRANT_URL'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().min(1).default('scientific_papers_gold'),
  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
  EMBEDDING_MODEL: z.string().min(1).default('nomic-ai/nomic-embed-text-v1.5'),
  MODEL_PATH: required('MODEL_PATH'),
  LLM_GPU: z.enum(['auto', 'cuda', 'metal', 'vulkan', 'false']).default('auto'),
  LLM_MAX_QUEUE: int(8, 0),
  LLM_CONCURRENCY: int(1, 1),
  LLM_TIMEOUT_MS: int(60000, 1000),
  WORLD_DATA_DIR: required('WORLD_DATA_DIR'),
  MINING_DIR: required('MINING_DIR'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
});

export type AppConfig = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
  }
}

/** Validates the environment; throws EnvValidationError listing every bad variable. */
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (i) =>
          `${i.path.join('.')}: ${i.message.replace(/^Invalid input: /, '')}`,
      ),
    );
  }
  return result.data;
}
