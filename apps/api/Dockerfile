FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/auth/package.json ./packages/auth/
RUN bun install --filter @conex/api...

COPY . .
RUN bun run --filter @conex/db build || true
RUN bun run --filter @conex/schemas build || true
RUN bun run --filter @conex/auth build || true

ENV PORT=3001
EXPOSE 3001
WORKDIR /app/apps/api
CMD ["bun", "src/index.ts"]
