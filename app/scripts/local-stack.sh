#!/usr/bin/env bash
# Local Supabase-compatible stack for integration tests, built from the official images
# (Postgres, GoTrue/Auth, PostgREST, Storage API) behind a small HTTP gateway.
#
# Why not `supabase start`? It also needs Realtime, which fails on hosts without IPv6.
# This script runs the same service images directly. It is NOT the hosted Supabase
# platform: results here are "local integration" evidence, not "live" evidence.
#
# Usage: scripts/local-stack.sh up|down|env
set -euo pipefail
STATE_DIR="${TS_STACK_DIR:-${TMPDIR:-/tmp}/trendset-stack}"
DB_PORT=54329; AUTH_PORT=54331; REST_PORT=54332; STORAGE_PORT=54333
PG_IMAGE=supabase/postgres:15.8.1.060
AUTH_IMAGE=supabase/gotrue:v2.170.0
REST_IMAGE=postgrest/postgrest:v12.2.8
STORAGE_IMAGE=supabase/storage-api:v1.19.3
HERE="$(cd "$(dirname "$0")/.." && pwd)"

wait_for() { for _ in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 2; done; echo "timeout: $1" >&2; return 1; }

make_keys() {
  mkdir -p "$STATE_DIR/storage"
  # Throwaway secret for an ephemeral local stack. Never reuse outside local testing.
  [ -f "$STATE_DIR/jwt_secret" ] || openssl rand -hex 32 > "$STATE_DIR/jwt_secret"
  python3 - "$(cat "$STATE_DIR/jwt_secret")" > "$STATE_DIR/keys.env" <<'PY'
import sys,hmac,hashlib,base64,json,time
s=sys.argv[1].encode()
b=lambda d: base64.urlsafe_b64encode(d).rstrip(b'=').decode()
def tok(role):
    h=b(json.dumps({"alg":"HS256","typ":"JWT"}).encode())
    p=b(json.dumps({"role":role,"iss":"supabase-local","iat":int(time.time()),"exp":int(time.time())+86400*30}).encode())
    return f"{h}.{p}."+b(hmac.new(s,f"{h}.{p}".encode(),hashlib.sha256).digest())
print("ANON_KEY="+tok("anon")); print("SERVICE_KEY="+tok("service_role"))
PY
}

up() {
  make_keys; . "$STATE_DIR/keys.env"; JWT=$(cat "$STATE_DIR/jwt_secret")
  docker network create ts-net >/dev/null 2>&1 || true
  docker rm -f ts-db ts-auth ts-rest ts-storage >/dev/null 2>&1 || true
  docker run -d --name ts-db --network ts-net -e POSTGRES_PASSWORD=postgres -p $DB_PORT:5432 $PG_IMAGE >/dev/null
  wait_for "PGPASSWORD=postgres psql -h 127.0.0.1 -p $DB_PORT -U postgres -tAc 'select 1'"
  sleep 3
  for r in supabase_auth_admin supabase_storage_admin authenticator; do
    docker exec -e PGPASSWORD=postgres ts-db psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "alter role $r with login password 'postgres'"
  done
  docker run -d --name ts-auth --network ts-net -p $AUTH_PORT:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
    -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@ts-db:5432/postgres" \
    -e GOTRUE_SITE_URL=http://127.0.0.1:3000 -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:3000/**" \
    -e GOTRUE_JWT_SECRET="$JWT" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
    -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_DISABLE_SIGNUP=false $AUTH_IMAGE >/dev/null
  docker run -d --name ts-rest --network ts-net -p $REST_PORT:3000 \
    -e "PGRST_DB_URI=postgres://authenticator:postgres@ts-db:5432/postgres" -e PGRST_DB_SCHEMAS=public,storage \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT" $REST_IMAGE >/dev/null
  docker run -d --name ts-storage --network ts-net -p $STORAGE_PORT:5000 -v "$STATE_DIR/storage:/var/lib/storage" \
    -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_KEY" -e AUTH_JWT_SECRET="$JWT" -e PGRST_JWT_SECRET="$JWT" \
    -e "DATABASE_URL=postgres://supabase_storage_admin:postgres@ts-db:5432/postgres" -e POSTGREST_URL=http://ts-rest:3000 \
    -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
    -e TENANT_ID=stub -e REGION=local -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false $STORAGE_IMAGE >/dev/null
  wait_for "curl -sf http://127.0.0.1:$AUTH_PORT/health"
  wait_for "curl -sf http://127.0.0.1:$STORAGE_PORT/status"
  # Storage/Auth have now run their own migrations; apply ours in order, each in a transaction.
  for f in "$HERE"/supabase/migrations/*.sql; do
    PGPASSWORD=postgres psql -h 127.0.0.1 -p $DB_PORT -U postgres -v ON_ERROR_STOP=1 -q -1 -f "$f" >/dev/null
    echo "applied $(basename "$f")"
  done
  docker restart ts-rest >/dev/null   # reload PostgREST schema cache
  echo "stack up. gateway: node scripts/dev-gateway.mjs (port 54321)"
}

down() { docker rm -f ts-db ts-auth ts-rest ts-storage >/dev/null 2>&1 || true; rm -rf "$STATE_DIR"; echo "stack down"; }

env_out() {
  . "$STATE_DIR/keys.env"
  echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"
  echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
  echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY"
  echo "DATABASE_URL=postgres://postgres:postgres@127.0.0.1:$DB_PORT/postgres"
}

case "${1:-}" in up) up ;; down) down ;; env) env_out ;; *) echo "usage: $0 up|down|env"; exit 1 ;; esac
