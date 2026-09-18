#
# Stage 1: Prune
#

FROM oven/bun:1-slim AS pruner

WORKDIR /app

COPY . .
RUN bunx turbo prune server server-cli --docker --out-dir /tmp/pruned

#
# Stage 2: Build
#

FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY --from=pruner /tmp/pruned/json/ ./
COPY --from=pruner /app/infra/prune-workspaces.ts ./infra/prune-workspaces.ts
RUN bun infra/prune-workspaces.ts
RUN bun install --frozen-lockfile --filter server --filter server-cli

COPY --from=pruner /tmp/pruned/full/ ./
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN bun run --filter server compile && bun run --filter server-cli compile

#
# Stage 3: Run backend
#

FROM debian:stable-slim

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/server/dist/backend.bin ./
COPY --from=builder /app/server-cli/dist/cli.bin ./cli.bin
COPY --from=builder /app/server/drizzle ./drizzle

EXPOSE 3000

ENTRYPOINT ["./backend.bin"]
