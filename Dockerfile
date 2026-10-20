# syntax=docker/dockerfile:1

# ---- build: compile TypeScript, then drop dev dependencies ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Hugging Face model cache (mounted as a volume in docker-compose), writable by the app user.
RUN mkdir -p node_modules/@huggingface/transformers/.cache \
  && chown node:node node_modules/@huggingface/transformers/.cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
