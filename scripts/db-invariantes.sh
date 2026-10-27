#!/usr/bin/env bash
# Recria um banco de teste vazio, aplica o schema + complemento SQL e roda os testes das
# invariantes garantidas pelo banco (docs/sql/testes-invariantes.sh).
#
# Uso: PGHOST=localhost PGPORT=5433 PGUSER=ebisu PGPASSWORD=ebisu ./scripts/db-invariantes.sh
# O usuário precisa ser superusuário (o teste cria o papel ebisu_app).
# Até a F1 criar as migrações em packages/db, o SQL é gerado a partir de docs/schema.prisma.
set -euo pipefail

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
BANCO=${BANCO_TESTE:-ebisu_test}
PRISMA_VERSAO=6.19.3
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

: "${PGUSER:?PGUSER não definido}"
export PGHOST=${PGHOST:-localhost} PGPORT=${PGPORT:-5432}

echo "== Gerando SQL a partir de docs/schema.prisma (prisma $PRISMA_VERSAO)"
pnpm dlx "prisma@$PRISMA_VERSAO" migrate diff --from-empty \
  --to-schema-datamodel "$RAIZ/docs/schema.prisma" --script > "$TMP/migracao.sql"

echo "== Recriando o banco $BANCO"
psql -X -q -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$BANCO\" WITH (FORCE)" -c "CREATE DATABASE \"$BANCO\""

echo "== Aplicando migração e complemento"
psql -X -q -d "$BANCO" -v ON_ERROR_STOP=1 -f "$TMP/migracao.sql" > /dev/null
psql -X -q -d "$BANCO" -v ON_ERROR_STOP=1 -f "$RAIZ/docs/sql/complemento-v0.2.sql" > /dev/null

echo "== Testes das invariantes"
PSQL="psql -d $BANCO" bash "$RAIZ/docs/sql/testes-invariantes.sh"
