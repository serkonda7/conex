# conex
Network inventory for MSPs.


## Getting Started
```sh
docker start conex-db
export CONEX_DATABASE_URL=postgres://conex:conex@localhost:5432/conex
bun run dev
```

### Initial Setup
```sh
bun install

# Create postgres DB
docker run -d --name conex-db -p 5432:5432 \
  -e POSTGRES_USER=conex -e POSTGRES_PASSWORD=conex -e POSTGRES_DB=conex postgres:16
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
| `CONEX_E2E_DATABASE_URL` | Separate Postgres database for `bun run test:e2e`  | –             |


### Migrating from SQLite
Older installs stored data in `server/data/conex.db`. Stop the server, then copy
everything into an empty Postgres database (the SQLite file is only read):
```sh
CONEX_DATABASE_URL=postgres://... bun run --cwd server db:migrate-sqlite /abs/path/to/conex.db
```
The script first upgrades a snapshot of the file to the final SQLite schema, so
older schema versions work too. It copies all rows in one transaction, keeps ids, and
verifies row counts; on any error Postgres is left untouched.


## Checks
```sh
bun run check
bun run build
bun run lint:ci
```


## Development
Use worktrees to work on parallel branches without disturbing the current checkout:
```sh
git worktree add ../conex-feature -b feature/my-change
cd ../conex-feature
# work, test, and commit as usual
cd ../conex
git worktree remove ../conex-feature
git branch -d feature/my-change
```
