#!/usr/bin/env bash
#
# Deterministic clean reseed of the taiga-docker Postgres for the React E2E
# parity suite. This is the repo-tracked, CI-consumable form of the reset that
# produced the committed e2e-react/artifacts/react/ evidence; it is wired as the
# Playwright globalSetup hook via E2E_RESEED_CMD (see e2e-react/fixtures/
# globalSetup.ts and the `e2e` job in .github/workflows/main.yml).
#
# WHY A FULL DROP-SCHEMA RESET (not just `sample_data`):
#   taiga-back's `sample_data` is NOT idempotent on a persistent volume — a plain
#   re-run collides on duplicate keys. This encapsulates the full reset so the
#   suite can be executed twice-from-clean without duplicate-name / data / order
#   drift (the twice-from-clean mandate behind globalSetup):
#     1. stop app containers holding DB connections
#     2. DROP + recreate the public schema
#     3. start taiga-back so it auto-migrates (poll via psql until complete)
#     4. create the single superuser sample_data requires
#     5. run sample_data (7 projects)
#     6. start remaining app containers, restart the gateway (refresh upstream IPs)
#     7. poll the gateway until it is serving again
#
# It targets the taiga-docker compose stack by CONTAINER NAME. Compose derives
# those names from the project name (the taiga-docker directory), i.e.
# "<project>-<service>-1"; override the prefix with COMPOSE_PROJECT if your
# project name differs. taiga-back is out of scope for this submodule (AAP
# §0.2.2), so this script only orchestrates it — it changes no backend code.
#
# Requires: a Docker daemon with the taiga-docker stack already CREATED
# (`docker compose up -d` in ../taiga-docker) and reachable on the gateway port.
set -uo pipefail

# Compose project prefix -> container names. Default matches a stack brought up
# from the `taiga-docker/` directory (`docker compose up -d`).
PROJECT="${COMPOSE_PROJECT:-taiga-docker}"
BACK="${PROJECT}-taiga-back-1"
DB="${PROJECT}-taiga-db-1"
ASYNC="${PROJECT}-taiga-async-1"
EVENTS="${PROJECT}-taiga-events-1"
PROTECTED="${PROJECT}-taiga-protected-1"
GATEWAY="${PROJECT}-taiga-gateway-1"

# Superuser sample_data needs. Overridable for non-default credentials.
SUPERUSER="${TAIGA_SUPERUSER:-admin}"
SUPERUSER_EMAIL="${TAIGA_SUPERUSER_EMAIL:-admin@taiga.dev}"
SUPERUSER_PASSWORD="${TAIGA_SUPERUSER_PASSWORD:-123123}"

# Gateway base used only for the post-reseed health poll.
GATEWAY_URL="${E2E_BASE_URL:-http://localhost:9000/}"
GATEWAY_URL="${GATEWAY_URL%/}"

log() { echo "[reseed] $*"; }

log "0/7 waiting for the database container to accept connections"
db_ready=0
for i in $(seq 1 60); do
  if docker exec "$DB" pg_isready -U taiga >/dev/null 2>&1; then
    log "    database ready"
    db_ready=1
    break
  fi
  sleep 2
done
[ "$db_ready" -eq 1 ] || { log "FATAL: database container never became ready"; exit 1; }

log "1/7 stopping app containers holding DB connections"
docker stop "$BACK" "$ASYNC" "$EVENTS" "$PROTECTED" >/dev/null 2>&1 || true

log "2/7 dropping + recreating public schema"
docker exec "$DB" psql -U taiga -d taiga -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO taiga; GRANT ALL ON SCHEMA public TO public;" \
  >/dev/null || { log "FATAL: schema drop failed"; exit 1; }

log "3/7 starting taiga-back to auto-migrate"
docker start "$BACK" >/dev/null

log "    waiting for migrations to complete (psql poll)"
migrated=0
for i in $(seq 1 60); do
  users=$(docker exec "$DB" psql -U taiga -d taiga -tAc \
    "SELECT to_regclass('public.users_user') IS NOT NULL" 2>/dev/null | tr -d '[:space:]')
  cnt=$(docker exec "$DB" psql -U taiga -d taiga -tAc \
    "SELECT count(*) FROM django_migrations" 2>/dev/null | tr -d '[:space:]')
  cnt=${cnt:-0}
  if [ "$users" = "t" ] && [ "$cnt" -ge 250 ] 2>/dev/null; then
    log "    migrations complete ($cnt applied)"
    migrated=1
    break
  fi
  sleep 3
done
[ "$migrated" -eq 1 ] || { log "FATAL: migrations did not complete"; exit 1; }

log "4/7 creating the superuser sample_data requires"
docker exec -e DJANGO_SUPERUSER_PASSWORD="$SUPERUSER_PASSWORD" "$BACK" \
  python manage.py createsuperuser --no-input \
  --username "$SUPERUSER" --email "$SUPERUSER_EMAIL" \
  >/dev/null 2>&1 || true

log "5/7 seeding sample_data"
docker exec "$BACK" python manage.py sample_data || { log "FATAL: sample_data failed"; exit 1; }

log "6/7 starting remaining app containers + restarting gateway"
docker start "$ASYNC" "$EVENTS" "$PROTECTED" >/dev/null 2>&1 || true
docker restart "$GATEWAY" >/dev/null 2>&1 || true

log "7/7 waiting for gateway /api/v1/ to serve"
served=0
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "${GATEWAY_URL}/api/v1/" 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "404" ]; then
    log "    gateway serving (HTTP $code)"
    served=1
    break
  fi
  sleep 2
done
[ "$served" -eq 1 ] || log "WARN: gateway health poll timed out (continuing)"

log "DONE — clean sample_data seeded (7 projects)"
