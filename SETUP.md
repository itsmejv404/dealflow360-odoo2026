# Manual Setup — DealFlow360

The compose stack intentionally has **no one-shot init containers**. Dependency install, Prisma client generation, migrations, and the MinIO bucket are manual steps you run when needed — not on every boot.

Everything runs through the `api` service image (Node 24 + Prisma) or `docker compose exec`, so nothing needs to be installed on the host.

## When to run what

| Step | First boot | After pulling dep changes | After adding a migration | After wiping volumes (`down -v`) |
|---|---|---|---|---|
| 1. `npm install` | ✅ | ✅ | | ✅ |
| 2. Prisma generate | ✅ | | | ✅ |
| 3. Create MinIO bucket | ✅ | | | ✅ |
| 4. Apply migrations | ✅ | | ✅ | ✅ |
| 5. Start the stack | ✅ | ✅ | ✅ | ✅ |

## Steps

Run from the repo root (`D:\OdooFinals`).

**0. Env file (first time only)**

```powershell
Copy-Item .env.example .env
```

**1. Install workspace dependencies** (into the shared `node_modules` volume)

```powershell
docker compose run --rm api npm install
```

> `docker compose run` works even though the app containers aren't running yet. `docker compose exec` would not — it needs a running container.

**2. Generate the Prisma client**

```powershell
docker compose run --rm api npm run prisma:generate -w @dealflow/api
```

> npm blocks Prisma's postinstall script, so generation must be run explicitly.

**3. Create the MinIO bucket** (name/creds come from `.env`; defaults shown)

```powershell
docker compose up -d minio
docker compose exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker compose exec minio mc mb --ignore-existing local/dealflow
```

> The `mc alias set` step is required — the image's built-in `local` alias has no credentials (bucket creation fails with `Access Denied` without it). If you changed `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `MINIO_BUCKET` in `.env`, use those values instead.

**4. Start everything**

```powershell
docker compose up -d
```

**5. Apply migrations**

```powershell
docker compose exec api npm run prisma:deploy -w @dealflow/api
```

> Creating a new migration — note the `-w` path so Prisma finds the schema:
> `docker compose exec -w /repo/apps/api api npx prisma migrate dev --name <name>`

## Verify

```powershell
docker compose ps                                                          # all healthy
curl http://localhost/api/health                                           # postgres/redis/minio all "up"
docker compose exec -w /repo/apps/api api npx prisma migrate status        # "Database schema is up to date!"
```

## Re-running later

- Pulled changes that touch a `package.json` → re-run step **1**.
- Pulled new migrations → re-run step **5**.
- `docker compose down -v` (full reset) → re-run steps **1–5** (data volumes and the `node_modules` volume are wiped).
- Normal `docker compose up -d` / `down` needs **no** setup — everything persists in volumes.
