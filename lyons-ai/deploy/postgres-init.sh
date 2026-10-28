#!/bin/sh
# Runs once, on first database initialisation.
# Separate database and role for n8n so it cannot read LYONS AI tables.
# N8N_DB_PASSWORD must be alphanumeric (generate with: openssl rand -hex 24).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE n8n LOGIN PASSWORD '${N8N_DB_PASSWORD}';
CREATE DATABASE n8n OWNER n8n;
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
EOSQL
