#
# Stage 1: Prune
#

FROM oven/bun:1-slim AS pruner

WORKDIR /app

COPY . .
RUN bunx turbo prune client --docker --out-dir /tmp/pruned

#
# Stage 2: Build
#

FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY --from=pruner /tmp/pruned/json/ ./
COPY --from=pruner /app/infra/prune-workspaces.ts ./infra/prune-workspaces.ts
RUN bun infra/prune-workspaces.ts
RUN bun install --frozen-lockfile --filter client

COPY --from=pruner /tmp/pruned/full/ ./
COPY --from=pruner /app/tsconfig.json ./tsconfig.json
RUN bun run --filter client build

#
# Stage 3: Serve with Caddy
#

FROM caddy:2-alpine

# Generate a self-signed cert for local HTTPS.
RUN apk add --no-cache openssl && \
		mkdir -p /etc/caddy/certs && \
		openssl req -x509 -newkey rsa:4096 \
			-keyout /etc/caddy/certs/key.pem \
			-out /etc/caddy/certs/cert.pem \
			-days 365 -nodes -subj "/CN=localhost" \
			-addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0"

COPY --from=builder /app/client/dist /usr/share/caddy
COPY infra/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443
