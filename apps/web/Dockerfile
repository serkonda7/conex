FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/
COPY packages/schemas/package.json ./packages/schemas/
RUN bun install --filter @conex/web...

COPY . .
RUN bun run --filter @conex/ui build || true
RUN bun run --filter @conex/schemas build || true
RUN bun run --filter @conex/web build

EXPOSE 5173
WORKDIR /app/apps/web
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
