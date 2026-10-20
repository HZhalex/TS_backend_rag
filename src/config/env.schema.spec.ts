import { EnvValidationError, parseEnv } from './env.schema';

const valid = {
  MONGO_URI: 'mongodb://localhost/x',
  QDRANT_URL: 'http://localhost:6333',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MODEL_PATH: '/models/q.gguf',
  WORLD_DATA_DIR: '/data/world',
  MINING_DIR: '/data/mining',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const c = parseEnv(valid);
    expect(c.PORT).toBe(3000);
    expect(c.QDRANT_COLLECTION).toBe('scientific_papers_gold');
    expect(c.LLM_MAX_QUEUE).toBe(8);
    expect(c.LLM_GPU).toBe('auto');
  });

  it('coerces numbers', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('lists every missing required variable', () => {
    try {
      parseEnv({});
      fail('expected error');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const issues = (e as EnvValidationError).issues.join('\n');
      for (const k of [
        'MONGO_URI',
        'QDRANT_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'MODEL_PATH',
        'WORLD_DATA_DIR',
        'MINING_DIR',
      ]) {
        expect(issues).toContain(k);
      }
    }
  });

  it('rejects short secrets', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('rejects an unknown LLM_GPU', () => {
    expect(() => parseEnv({ ...valid, LLM_GPU: 'tpu' })).toThrow(
      EnvValidationError,
    );
  });
});
