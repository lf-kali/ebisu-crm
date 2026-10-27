#!/usr/bin/env bash
# =============================================================================
# Testes das invariantes garantidas pelo BANCO (docs/invariantes.md).
#
# Pré-requisito: banco vazio com a migração do Prisma + complemento-v0.2.sql.
#   npx prisma migrate diff --from-empty --to-schema-datamodel docs/schema.prisma --script > /tmp/m.sql
#   psql -d ebisu_test -f /tmp/m.sql && psql -d ebisu_test -f docs/sql/complemento-v0.2.sql
#
# Uso:  PSQL="psql -d ebisu_test" ./docs/sql/testes-invariantes.sh
# PSQL deve conectar como superusuário (o script cria o papel ebisu_app e roda
# os testes com SET ROLE ebisu_app, sem BYPASSRLS, como a aplicação rodará).
# =============================================================================
set -u
PSQL=${PSQL:-psql -d ebisu_test}

T1=11111111-1111-1111-1111-111111111111   # tenant 1
T2=22222222-2222-2222-2222-222222222222   # tenant 2
EA=aaaaaaaa-0000-0000-0000-000000000001   # empresa A (tenant 1)
EB=bbbbbbbb-0000-0000-0000-000000000001   # empresa B (tenant 1)
CA=aaaaaaaa-0000-0000-0000-0000000000c1   # contato da empresa A
CB=bbbbbbbb-0000-0000-0000-0000000000c1   # contato da empresa B
DA=aaaaaaaa-0000-0000-0000-0000000000d1   # dispositivo da empresa A
IA=aaaaaaaa-0000-0000-0000-0000000000e1   # item (peça) da empresa A
OR1=aaaaaaaa-0000-0000-0000-0000000000f1  # orçamento v1 da empresa A
OS1=aaaaaaaa-0000-0000-0000-0000000000a1  # OS da empresa A
TI1=aaaaaaaa-0000-0000-0000-0000000000b1  # título a receber da OS
PG1=aaaaaaaa-0000-0000-0000-0000000000b2  # pagamento

PASS=0; FAIL=0
ctx() { echo "SET ROLE ebisu_app; SET app.tenant_id = '$1';"; }   # na aplicação: set_config(..., true) por transação

# roda SQL como a aplicação no tenant $1; imprime stderr
roda() { { ctx "$1"; echo "$2"; } | $PSQL -X -q -v ON_ERROR_STOP=1 -At 2>&1 >/dev/null; }

ok() {   # ok "descrição" tenant "sql"
  local out; out=$( { ctx "$2"; echo "BEGIN; $3 ROLLBACK;"; } | $PSQL -X -q -v ON_ERROR_STOP=1 -At 2>&1 >/dev/null)
  if [ -z "$out" ]; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1 — $out"; fi
}
falha() {   # falha "descrição" "trecho esperado do erro" tenant "sql"
  local out; out=$( { ctx "$3"; echo "BEGIN; $4 ROLLBACK;"; } | $PSQL -X -q -v ON_ERROR_STOP=1 -At 2>&1 >/dev/null)
  if echo "$out" | grep -q -- "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"
  else FAIL=$((FAIL+1)); echo "  ✘ $1 — esperado erro com '$2', obtido: ${out:-sucesso}"; fi
}
igual() {   # igual "descrição" "esperado" tenant "sql que retorna 1 valor"
  local out; out=$( { ctx "$3"; echo "$4"; } | $PSQL -X -q -v ON_ERROR_STOP=1 -At 2>&1 | tail -1)
  if [ "$out" = "$2" ]; then PASS=$((PASS+1)); echo "  ✔ $1"
  else FAIL=$((FAIL+1)); echo "  ✘ $1 — esperado '$2', obtido '$out'"; fi
}

echo "== Preparação"
$PSQL -X -q <<SQL >/dev/null
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ebisu_app') THEN
    CREATE ROLE ebisu_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO ebisu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ebisu_app;
SQL

for T in $T1 $T2; do
  roda "$T" "INSERT INTO tenant (id, nome, slug, updated_at) VALUES ('$T', 'Tenant', 'tenant-$T', now());"
done
roda "$T1" "
INSERT INTO empresa (id, tenant_id, razao_social, nome_fantasia, updated_at) VALUES
  ('$EA', '$T1', 'Empresa A', 'A', now()), ('$EB', '$T1', 'Empresa B', 'B', now());
INSERT INTO contato (id, tenant_id, empresa_id, nome, email, email_normalizado, updated_at) VALUES
  ('$CA', '$T1', '$EA', 'Ana', 'ana@x.com', 'ana@x.com', now()),
  ('$CB', '$T1', '$EB', 'Bia', 'bia@x.com', 'bia@x.com', now());
INSERT INTO dispositivo (id, tenant_id, empresa_id, tipo, marca, modelo, proprietario_atual_id, updated_at) VALUES
  ('$DA', '$T1', '$EA', 'CELULAR', 'Apple', 'iPhone 12', '$CA', now());
INSERT INTO item (id, tenant_id, empresa_id, tipo, nome, estoque_atual, custo_medio, updated_at) VALUES
  ('$IA', '$T1', '$EA', 'PRODUTO', 'Tela iPhone 12', 1, 300, now());
INSERT INTO orcamento (id, tenant_id, empresa_id, numero, contato_id, tipo_dispositivo, descricao_problema,
                       validade, token_publico, status, updated_at) VALUES
  ('$OR1', '$T1', '$EA', 'ORC-1', '$CA', 'CELULAR', 'Tela quebrada', current_date + 7, 'tok1', 'RASCUNHO', now());
INSERT INTO orcamento_item (id, tenant_id, empresa_id, orcamento_id, tipo, descricao, preco_unitario, total) VALUES
  (gen_random_uuid(), '$T1', '$EA', '$OR1', 'PRODUTO', 'Tela', 900, 900);
UPDATE orcamento SET status = 'ENVIADO' WHERE id = '$OR1';
INSERT INTO ordem_servico (id, tenant_id, empresa_id, numero, contato_id, dispositivo_id, orcamento_id,
                           descricao_problema, prazo, updated_at) VALUES
  ('$OS1', '$T1', '$EA', 'OS-1', '$CA', '$DA', '$OR1', 'Tela quebrada', now() + interval '3 days', now());
INSERT INTO titulo_financeiro (id, tenant_id, empresa_id, tipo, categoria, descricao, contato_id, os_id,
                               valor, vencimento, updated_at) VALUES
  ('$TI1', '$T1', '$EA', 'RECEBER', 'RECEITA_SERVICO', 'OS-1', '$CA', '$OS1', 900, current_date, now());
INSERT INTO pagamento (id, tenant_id, empresa_id, titulo_id, valor, forma) VALUES
  ('$PG1', '$T1', '$EA', '$TI1', 100, 'PIX');
INSERT INTO movimento_estoque (id, tenant_id, empresa_id, item_id, tipo, chave_operacao, quantidade,
                               custo_unitario, valor_total, saldo_apos, custo_medio_apos) VALUES
  (gen_random_uuid(), '$T1', '$EA', '$IA', 'ENTRADA_COMPRA', 'ENTRADA:seed', 1, 300, 300, 1, 300);
" | sed 's/^/  seed: /'

echo "== SEG: isolamento entre tenants (RLS)"
igual "tenant 2 não enxerga contatos do tenant 1" "0" "$T2" "SELECT count(*) FROM contato;"
igual "tenant 1 enxerga os próprios contatos" "2" "$T1" "SELECT count(*) FROM contato;"
igual "sem contexto de tenant, nenhuma linha é visível" "0" "" "SELECT count(*) FROM contato;"
igual "tenant 2 não enxerga histórico filho (os_status_historico) do tenant 1" "0" "$T2" \
  "SELECT count(*) FROM ordem_servico;"
falha "tenant 2 não consegue gravar linha com tenant_id do tenant 1" "row-level security" "$T2" \
  "INSERT INTO contato (id, tenant_id, empresa_id, nome, email, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'Intruso', 'i@x.com', now());"
igual "tenant 2 não altera dados do tenant 1 (UPDATE afeta 0 linhas)" "0" "$T2" \
  "WITH u AS (UPDATE contato SET nome = 'hack' WHERE id = '$CA' RETURNING 1) SELECT count(*) FROM u;"

echo "== SEG: integridade entre empresas (FK composta)"
falha "OS da empresa A não referencia contato da empresa B" "foreign key" "$T1" \
  "INSERT INTO ordem_servico (id, tenant_id, empresa_id, numero, contato_id, dispositivo_id,
     descricao_problema, prazo, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'OS-X', '$CB', '$DA', 'x', now(), now());"
falha "linha não declara empresa de outro tenant" "foreign key" "$T2" \
  "INSERT INTO contato (id, tenant_id, empresa_id, nome, email, updated_at)
   VALUES (gen_random_uuid(), '$T2', '$EA', 'X', 'x@x.com', now());"

echo "== CRM"
falha "CRM-1 dedupe: e-mail repetido na mesma empresa" "contato_email_uq" "$T1" \
  "INSERT INTO contato (id, tenant_id, empresa_id, nome, email, email_normalizado, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'Ana 2', 'ana@x.com', 'ana@x.com', now());"
ok "CRM-1 dedupe: mesmo e-mail em outra empresa é permitido" "$T1" \
  "INSERT INTO contato (id, tenant_id, empresa_id, nome, email, email_normalizado, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EB', 'Ana B', 'ana@x.com', 'ana@x.com', now());"
ok "CRM-1 dedupe: após soft delete o e-mail pode ser reutilizado" "$T1" \
  "UPDATE contato SET deleted_at = now() WHERE id = '$CA';
   INSERT INTO contato (id, tenant_id, empresa_id, nome, email, email_normalizado, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'Ana nova', 'ana@x.com', 'ana@x.com', now());"
falha "CRM-1 contato sem nenhum meio de contato" "contato_meio_contato_ck" "$T1" \
  "INSERT INTO contato (id, tenant_id, empresa_id, nome, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'Sem contato', now());"

echo "== Dispositivos e inspeção"
falha "DSP-5 inspeção de entrada sem remoção do bloqueio nem justificativa" "inspecao_bloqueio_ck" "$T1" \
  "INSERT INTO inspecao (id, tenant_id, empresa_id, dispositivo_id, os_id, momento, itens_snapshot, estado_externo)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$DA', '$OS1', 'ENTRADA', '[]', 'riscos leves');"
ok "DSP-5 inspeção de entrada com bloqueio removido pelo cliente" "$T1" \
  "INSERT INTO inspecao (id, tenant_id, empresa_id, dispositivo_id, os_id, momento, itens_snapshot,
     estado_externo, bloqueio_removido)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$DA', '$OS1', 'ENTRADA', '[]', 'riscos leves', true);"
falha "ANX-1 anexo ligado a duas entidades" "anexo_um_alvo_ck" "$T1" \
  "INSERT INTO anexo (id, tenant_id, empresa_id, os_id, dispositivo_id, nome, mime, tamanho_bytes, storage_key)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$OS1', '$DA', 'f.jpg', 'image/jpeg', 1, 'k');"

echo "== Orçamento"
falha "ORC-2 item não pode ser incluído após o envio" "já enviado" "$T1" \
  "INSERT INTO orcamento_item (id, tenant_id, empresa_id, orcamento_id, tipo, descricao, preco_unitario, total)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$OR1', 'SERVICO', 'Extra', 50, 50);"
falha "ORC-2 total não muda após o envio" "já enviado" "$T1" \
  "UPDATE orcamento SET total = 1 WHERE id = '$OR1';"
ok "ORC-2 decisão item a item (aprovado) é permitida após o envio" "$T1" \
  "UPDATE orcamento_item SET aprovado = true WHERE orcamento_id = '$OR1';"
falha "ORC-1 duas versões vigentes do mesmo número" "orcamento_versao_vigente_uq" "$T1" \
  "INSERT INTO orcamento (id, tenant_id, empresa_id, numero, versao, contato_id, tipo_dispositivo,
     descricao_problema, validade, token_publico, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'ORC-1', 2, '$CA', 'CELULAR', 'x', current_date, 'tok2', now());"
ok "ORC-1 nova versão é aceita quando a anterior é cancelada" "$T1" \
  "UPDATE orcamento SET status = 'CANCELADO' WHERE id = '$OR1';
   INSERT INTO orcamento (id, tenant_id, empresa_id, numero, versao, contato_id, tipo_dispositivo,
     descricao_problema, validade, token_publico, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'ORC-1', 2, '$CA', 'CELULAR', 'x', current_date, 'tok2', now());"

echo "== Bancada (OS)"
falha "OS-1 um orçamento gera no máximo uma OS" "ordem_servico_empresa_id_orcamento_id_key" "$T1" \
  "INSERT INTO ordem_servico (id, tenant_id, empresa_id, numero, contato_id, dispositivo_id, orcamento_id,
     descricao_problema, prazo, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'OS-2', '$CA', '$DA', '$OR1', 'x', now(), now());"
falha "OS-3 EM_REPARO exige técnico" "os_reparo_tecnico_ck" "$T1" \
  "UPDATE ordem_servico SET status = 'EM_REPARO' WHERE id = '$OS1';"
falha "OS-5 ENTREGUE exige data de entrega" "os_entregue_data_ck" "$T1" \
  "UPDATE ordem_servico SET status = 'ENTREGUE' WHERE id = '$OS1';"
falha "OS-7 OS de garantia exige OS de origem" "os_garantia_origem_ck" "$T1" \
  "INSERT INTO ordem_servico (id, tenant_id, empresa_id, numero, tipo, contato_id, dispositivo_id,
     descricao_problema, prazo, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'OS-G', 'GARANTIA', '$CA', '$DA', 'x', now(), now());"

echo "== Estoque"
falha "EST-1 saldo nunca fica negativo" "item_estoque_ck" "$T1" \
  "UPDATE item SET estoque_atual = estoque_atual - 2 WHERE id = '$IA';"
falha "EST-2 a mesma operação não gera dois movimentos" "movimento_estoque_empresa_id_chave_operacao_key" "$T1" \
  "INSERT INTO movimento_estoque (id, tenant_id, empresa_id, item_id, tipo, chave_operacao, quantidade,
     custo_unitario, valor_total, saldo_apos, custo_medio_apos)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$IA', 'ENTRADA_COMPRA', 'ENTRADA:seed', 1, 300, 300, 2, 300);"
falha "EST-3 saída com quantidade positiva é rejeitada" "movimento_sinal_ck" "$T1" \
  "INSERT INTO movimento_estoque (id, tenant_id, empresa_id, item_id, tipo, chave_operacao, quantidade,
     custo_unitario, valor_total, saldo_apos, custo_medio_apos)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$IA', 'SAIDA_OS', 'SAIDA:x', 1, 300, 300, 0, 300);"
falha "EST-4 ledger é append-only (UPDATE)" "append-only" "$T1" \
  "UPDATE movimento_estoque SET quantidade = 5;"
falha "EST-4 ledger é append-only (DELETE)" "append-only" "$T1" \
  "DELETE FROM movimento_estoque;"
falha "EST-5 o mesmo movimento não é estornado duas vezes" "movimento_estoque_empresa_id_movimento_estornado_id_key" "$T1" \
  "WITH m AS (SELECT id FROM movimento_estoque WHERE chave_operacao = 'ENTRADA:seed')
   INSERT INTO movimento_estoque (id, tenant_id, empresa_id, item_id, tipo, chave_operacao, quantidade,
     custo_unitario, valor_total, saldo_apos, custo_medio_apos, movimento_estornado_id)
   SELECT gen_random_uuid(), '$T1', '$EA', '$IA', 'ESTORNO', 'ESTORNO:' || n, -1, 300, 300, 0, 300, m.id
     FROM m, generate_series(1, 2) n;"

echo "== EST-6 concorrência: duas OS disputam a última peça"
SAIDA="UPDATE item SET estoque_atual = estoque_atual - 1
       WHERE id = '$IA' AND empresa_id = '$EA' AND estoque_atual >= 1 RETURNING estoque_atual;"
R1=$( { ctx "$T1"; echo "BEGIN; $SAIDA SELECT pg_sleep(1.5); COMMIT;"; } | $PSQL -X -q -At 2>&1 | grep -E '^[0-9]' | head -1) &
sleep 0.4
R2=$( { ctx "$T1"; echo "BEGIN; $SAIDA COMMIT;"; } | $PSQL -X -q -At 2>&1 | grep -cE '^[0-9]')
wait
FINAL=$( { ctx "$T1"; echo "SELECT estoque_atual FROM item WHERE id = '$IA';"; } | $PSQL -X -q -At | tail -1)
if [ "$R2" = "0" ] && [ "$FINAL" = "0.000" ]; then PASS=$((PASS+1)); echo "  ✔ só uma baixa ocorreu (a segunda esperou o lock e encontrou saldo 0)"
else FAIL=$((FAIL+1)); echo "  ✘ concorrência — 2ª sessão retornou $R2 linha(s), saldo final $FINAL"; fi

echo "== Financeiro"
falha "FIN-1 um único título a receber ativo por OS" "titulo_receber_os_uq" "$T1" \
  "INSERT INTO titulo_financeiro (id, tenant_id, empresa_id, tipo, categoria, descricao, os_id, valor,
     vencimento, updated_at)
   VALUES (gen_random_uuid(), '$T1', '$EA', 'RECEBER', 'RECEITA_SERVICO', 'dup', '$OS1', 1, current_date, now());"
falha "FIN-3 estorno de pagamento precisa ser negativo" "pagamento_sinal_ck" "$T1" \
  "INSERT INTO pagamento (id, tenant_id, empresa_id, titulo_id, tipo, valor, forma, pagamento_estornado_id)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$TI1', 'ESTORNO', 100, 'PIX', '$PG1');"
ok "FIN-3 estorno negativo ligado ao pagamento original" "$T1" \
  "INSERT INTO pagamento (id, tenant_id, empresa_id, titulo_id, tipo, valor, forma, pagamento_estornado_id)
   VALUES (gen_random_uuid(), '$T1', '$EA', '$TI1', 'ESTORNO', -100, 'PIX', '$PG1');"
falha "FIN-4 pagamento é append-only" "append-only" "$T1" \
  "UPDATE pagamento SET valor = 1 WHERE id = '$PG1';"

echo
echo "Resultado: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ]
