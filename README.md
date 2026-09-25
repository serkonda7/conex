# conex
Network inventory for MSPs (tenants, sites, racks, devices, L1 cabling).


## Run
```sh
bun install
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
| Variable            | Description                                         | Default       |
| ------------------- | --------------------------------------------------- | ------------- |
| `CONEX_DB_PATH`     | Relative to `server/data` or absolute or `:memory:` | `conex.db`    |
| `CONEX_CONFIG_PATH` | Relative to `server/data` or absolute               | `config.toml` |


## Checks
```sh
bun run check
bun run build
bun run lint:ci
```
