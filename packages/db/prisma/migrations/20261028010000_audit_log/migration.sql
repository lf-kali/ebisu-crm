-- F3-3b: audit log automático (plano docs/planos/f3-3b-audit-log.md; SEG-8).
-- Um trigger genérico grava em audit_log toda escrita nas tabelas de negócio: quem (membro ou
-- API key, de app.membro_id/app.api_key_id), em qual requisição (app.request_id, app.ip) e os
-- NOMES das colunas alteradas, nunca os valores (SEG-8). Os app.* são definidos por comTenant,
-- na mesma transação do tenant. Roda com o papel de quem escreve (SECURITY INVOKER): o ebisu_app
-- só grava auditoria da própria conta (RLS do audit_log). search_path fixo, com pg_temp por último:
-- uma tabela temporária "audit_log" criada na sessão não desvia a auditoria.

CREATE OR REPLACE FUNCTION public.auditar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  antes  jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  depois jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  linha  jsonb := COALESCE(depois, antes);
  -- Tabela filha (sem tenant_id): o tenant da transação.
  tenant uuid  := COALESCE((linha ->> 'tenant_id')::uuid, public.app_tenant_id());
  campos text[];
  acao   text;
BEGIN
  -- Sem tenant só acontece em escrita privilegiada sem contexto (o RLS impede a aplicação).
  IF tenant IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    acao := 'create';
    SELECT array_agg(e.chave ORDER BY e.chave) INTO campos
      FROM jsonb_each(depois) AS e(chave, valor)
     WHERE e.valor <> 'null'::jsonb;
  ELSIF TG_OP = 'DELETE' THEN
    acao := 'delete';
  ELSE
    SELECT array_agg(e.chave ORDER BY e.chave) INTO campos
      FROM jsonb_each(depois) AS e(chave, valor)
     WHERE e.chave <> 'updated_at' AND e.valor IS DISTINCT FROM antes -> e.chave;
    -- UPDATE que não muda nada (fora o updated_at) não vira auditoria.
    IF campos IS NULL THEN
      RETURN NULL;
    END IF;
    acao := CASE
      WHEN 'deleted_at' = ANY (campos) AND depois ->> 'deleted_at' IS NOT NULL THEN 'delete'
      WHEN 'anonimizado_em' = ANY (campos) AND depois ->> 'anonimizado_em' IS NOT NULL THEN 'anonimizar'
      WHEN 'status' = ANY (campos) THEN 'status_change'
      ELSE 'update'
    END;
  END IF;

  INSERT INTO public.audit_log (
    id, tenant_id, empresa_id, ator_membro_id, ator_api_key_id,
    entidade_tipo, entidade_id, acao, diff, ip, request_id
  ) VALUES (
    gen_random_uuid(),
    tenant,
    (linha ->> 'empresa_id')::uuid,
    NULLIF(current_setting('app.membro_id', true), '')::uuid,
    NULLIF(current_setting('app.api_key_id', true), '')::uuid,
    TG_TABLE_NAME,
    -- A coluna do id vem como argumento do trigger (padrão: id).
    (linha ->> COALESCE(TG_ARGV[0], 'id'))::uuid,
    acao,
    CASE WHEN campos IS NULL THEN NULL ELSE jsonb_build_object('campos', to_jsonb(campos)) END,
    NULLIF(current_setting('app.ip', true), ''),
    NULLIF(current_setting('app.request_id', true), '')
  );
  RETURN NULL;
END $$;

-- Tabelas de negócio auditadas. Ficam de fora (decisão 6 do plano; o teste
-- packages/db/test/auditoria.test.ts exige que toda tabela esteja num dos dois grupos):
--   globais/auth: tenant, usuario, refresh_token, permissao;
--   técnicas: audit_log, idempotencia_requisicao, sequencia_documento, notificacao, job_lote;
--   append-only que já gravam o membro: historico_etapa_negocio, orcamento_status_historico,
--   os_status_historico, dispositivo_evento, movimento_estoque, pagamento.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'empresa', 'membro', 'papel', 'atribuicao_papel', 'api_key',
    'contato', 'origem_lead', 'captura_lead', 'consentimento',
    'funil', 'etapa_funil', 'requisito_etapa', 'negocio', 'motivo_perda', 'atividade', 'tarefa',
    'dispositivo', 'dispositivo_proprietario', 'tipo_acessorio', 'acessorio_recebido',
    'checklist_modelo', 'inspecao', 'orcamento', 'orcamento_item',
    'ordem_servico', 'ordem_servico_item', 'anexo',
    'fornecedor', 'item', 'compra', 'compra_item', 'titulo_financeiro', 'modelo_mensagem'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION public.auditar()', t);
  END LOOP;
END $$;

-- papel_permissao não tem id: a entidade é o papel.
CREATE TRIGGER auditoria AFTER INSERT OR UPDATE OR DELETE ON papel_permissao
  FOR EACH ROW EXECUTE FUNCTION public.auditar('papel_id');
