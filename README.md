# conex
Network inventory for MSPs.


## Getting Started
```sh
docker start conex-dev-db
export CONEX_DATABASE_URL=postgres://conex:conex@localhost:5432/conex
bun run dev
```

### Initial Setup
```sh
bun install

# Create postgres DB
docker run -d --name conex-dev-db -p 5432:5432 \
  -e POSTGRES_USER=conex -e POSTGRES_PASSWORD=conex -e POSTGRES_DB=conex postgres:17
export CONEX_DATABASE_URL=postgres://conex:conex@localhost:5432/conex
```

Create config file at `server/data/config.toml`:
```toml
[auth]
appKey = "at-least-32-chars-long-random-secret-here"
secureCookies = false  # plain HTTP local dev; keep true behind HTTPS
```

Run the app. Admin account is created during first-run:
```sh
bun run dev
```


### Environment Variables
| Variable                 | Description                                        | Default       |
| ------------------------ | -------------------------------------------------- | ------------- |
| `CONEX_DATABASE_URL`     | Postgres connection string (required)              | –             |
| `CONEX_CONFIG_PATH`      | Relative to `server/data` or absolute              | `config.toml` |
| `CONEX_E2E_DATABASE_URL` | Separate Postgres database for `bun run test:e2e`  | `CONEX_DATABASE_URL` + `_e2e` (auto-created) |


### Backing up
A backup consists of the Postgres database and the attachments directory
(images; `server/data/attachments` unless `[storage] attachmentsDir` in
`config.toml` points elsewhere). Back up both at the same time and restore
them together: the database holds only the image metadata, the files live on
disk. On startup the server removes files without a database row and logs rows
whose file is missing.
```sh
# Backup
docker exec conex-dev-db pg_dump -U conex -Fc conex > backups/conex-$(date +%F).dump
tar -czf backups/conex-attachments-$(date +%F).tar.gz -C server/data attachments

# Restore
docker exec -i conex-dev-db pg_restore -U conex -d conex < backups/<file>.dump
tar -xzf backups/conex-attachments-<date>.tar.gz -C server/data

# Restore and overwrite any existing data
docker exec -i conex-dev-db pg_restore -U conex -d conex --clean --if-exists --no-owner < backups/<file>.dump
rm -rf server/data/attachments && tar -xzf backups/conex-attachments-<date>.tar.gz -C server/data
```


## Development
### Checks
```sh
bun run check
bun run build
bun run lint:ci

# Export CONEX_DATABASE_URL first (see Environment Variables above).
bun run test:e2e
bun run test:visual
bun run test:visual:update
```


### Documentation
User docs live in `docs/` ([mdBook](https://rust-lang.github.io/mdBook/), install it separately; optionally `mdbook-last-changed` for page dates) and are published to GitHub Pages on push to `main`.
```sh
bun run docs:dev
bun run docs:build
```


### Git Worktrees
Use worktrees to work on parallel branches without disturbing the current checkout:
```sh
git worktree add ../conex-feature -b feature/my-change
cd ../conex-feature
# work, test, and commit as usual
cd ../conex
git worktree remove ../conex-feature
git branch -d feature/my-change
```
