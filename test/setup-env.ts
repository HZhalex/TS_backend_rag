// Defaults for e2e runs; real services (Mongo, Qdrant, models) are replaced in each spec.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGO_URI: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:1/unused',
  QDRANT_URL: process.env.QDRANT_URL ?? 'http://127.0.0.1:1',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef',
  MODEL_PATH: '/nonexistent/model.gguf',
  WORLD_DATA_DIR: '/nonexistent/world',
  MINING_DIR: '/nonexistent/mining',
});
