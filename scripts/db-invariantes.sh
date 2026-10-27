#!/usr/bin/env bash
# Recria um banco de teste vazio, aplica as migrações de packages/db e roda os testes das
# invariantes garantidas pelo banco (docs/sql/testes-invariantes.sh).
#
# Uso: PGHOST=localhost PGPORT=5433 PGUSER=ebisu PGPASSWORD=ebisu ./scripts/db-invariantes.sh
# O usuário precisa ser superusuário (o teste cria/ajusta o papel ebisu_app).
set -euo pipefail

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
BANCO=${BANCO_TESTE:-ebisu_test}

: "${PGUSER:?PGUSER não definido}"
: "${PGPASSWORD:?PGPASSWORD não definido}"
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432}

echo "== Recriando o banco $BANCO"
psql -X -q -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$BANCO\" WITH (FORCE)" -c "CREATE DATABASE \"$BANCO\""

echo "== Aplicando migrações (prisma migrate deploy)"
DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$BANCO" \
  pnpm --filter @ebisu/db exec prisma migrate deploy

echo "== Testes das invariantes"
PSQL="psql -d $BANCO" bash "$RAIZ/docs/sql/testes-invariantes.sh"
