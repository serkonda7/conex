FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock* turbo.json ./
COPY apps/ldap/package.json ./apps/ldap/
COPY packages/db/package.json ./packages/db/
RUN bun install --filter @conex/ldap...

COPY . .
RUN bun run --filter @conex/db build || true

ENV LDAP_PORT=1389
ENV LDAP_HTTP_PORT=3002
EXPOSE 1389 3002
WORKDIR /app/apps/ldap
CMD ["bun", "src/index.ts"]
