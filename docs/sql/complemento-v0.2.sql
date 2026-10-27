-- =============================================================================
-- ebisuCRM v0.2-MVP — complemento SQL da migração gerada pelo Prisma
-- -----------------------------------------------------------------------------
-- Aplicar DEPOIS de `prisma migrate` (ou anexar à 1ª migração).
-- Contém o que o Prisma não expressa: CHECKs, índices únicos parciais,
-- bloqueio de UPDATE/DELETE em ledgers e Row Level Security.
-- Cada regra cita o identificador correspondente em docs/invariantes.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Índices únicos parciais
-- -----------------------------------------------------------------------------

-- CRM-1: dedupe de contato por empresa, ignorando excluídos
CREATE UNIQUE INDEX contato_email_uq ON contato (empresa_id, email_normalizado)
  WHERE deleted_at IS NULL AND email_normalizado IS NOT NULL;
CREATE UNIQUE INDEX contato_telefone_uq ON contato (empresa_id, telefone_e164)
  WHERE deleted_at IS NULL AND telefone_e164 IS NOT NULL;
CREATE UNIQUE INDEX contato_whatsapp_uq ON contato (empresa_id, whatsapp_e164)
  WHERE deleted_at IS NULL AND whatsapp_e164 IS NOT NULL;

-- CRM-5: um funil padrão por empresa
CREATE UNIQUE INDEX funil_padrao_uq ON funil (empresa_id) WHERE padrao;

-- ORC-1: uma única versão não cancelada por número de orçamento
CREATE UNIQUE INDEX orcamento_versao_vigente_uq ON orcamento (empresa_id, numero)
  WHERE status <> 'CANCELADO' AND deleted_at IS NULL;

-- DSP-2: no máximo um proprietário vigente por dispositivo
CREATE UNIQUE INDEX dispositivo_proprietario_vigente_uq ON dispositivo_proprietario (dispositivo_id)
  WHERE ate IS NULL;

-- FIN-1: um título a receber ativo por OS
CREATE UNIQUE INDEX titulo_receber_os_uq ON titulo_financeiro (empresa_id, os_id)
  WHERE tipo = 'RECEBER' AND os_id IS NOT NULL AND status <> 'CANCELADO';

-- -----------------------------------------------------------------------------
-- 2. CHECK constraints
-- -----------------------------------------------------------------------------

-- CRM-1: contato precisa de ao menos um meio de contato (exceto anonimizado)
ALTER TABLE contato ADD CONSTRAINT contato_meio_contato_ck
  CHECK (anonimizado_em IS NOT NULL OR num_nonnulls(email, telefone_e164, whatsapp_e164) >= 1);

-- CRM-4: negócio perdido exige motivo; fechado exige data
ALTER TABLE negocio ADD CONSTRAINT negocio_perdido_motivo_ck
  CHECK (status <> 'PERDIDO' OR motivo_perda_id IS NOT NULL);
ALTER TABLE negocio ADD CONSTRAINT negocio_fechado_data_ck
  CHECK (status NOT IN ('GANHO', 'PERDIDO') OR fechado_em IS NOT NULL);

-- ANX-1: anexo pertence a exatamente uma entidade
ALTER TABLE anexo ADD CONSTRAINT anexo_um_alvo_ck
  CHECK (num_nonnulls(contato_id, orcamento_id, os_id, dispositivo_id, compra_id) = 1);

-- DSP-3: acessório pertence a orçamento OU OS
ALTER TABLE acessorio_recebido ADD CONSTRAINT acessorio_um_alvo_ck
  CHECK (num_nonnulls(orcamento_id, os_id) = 1);

-- DSP-4: inspeção ligada a orçamento e/ou OS
ALTER TABLE inspecao ADD CONSTRAINT inspecao_alvo_ck
  CHECK (num_nonnulls(orcamento_id, os_id) >= 1);

-- DSP-5: na ENTRADA, o cliente remove o bloqueio do aparelho ou a exceção é justificada
ALTER TABLE inspecao ADD CONSTRAINT inspecao_bloqueio_ck
  CHECK (momento <> 'ENTRADA' OR bloqueio_removido OR bloqueio_observacao IS NOT NULL);

-- ORC-6: itens com valores válidos
ALTER TABLE orcamento_item ADD CONSTRAINT orcamento_item_valores_ck
  CHECK (quantidade > 0 AND preco_unitario >= 0 AND desconto >= 0 AND total >= 0);
ALTER TABLE ordem_servico_item ADD CONSTRAINT os_item_valores_ck
  CHECK (quantidade > 0 AND preco_unitario >= 0 AND desconto >= 0 AND total >= 0);

-- OS-3: EM_REPARO exige técnico (corrige no banco o bug do Ogun "Em Andamento")
ALTER TABLE ordem_servico ADD CONSTRAINT os_reparo_tecnico_ck
  CHECK (status NOT IN ('EM_REPARO', 'EM_TESTES') OR tecnico_id IS NOT NULL);

-- OS-5: ENTREGUE exige data de entrega
ALTER TABLE ordem_servico ADD CONSTRAINT os_entregue_data_ck
  CHECK (status <> 'ENTREGUE' OR entregue_em IS NOT NULL);

-- OS-7: OS de garantia aponta a OS de origem
ALTER TABLE ordem_servico ADD CONSTRAINT os_garantia_origem_ck
  CHECK (tipo <> 'GARANTIA' OR os_origem_id IS NOT NULL);

-- EST-1: estoque nunca negativo; serviço não controla estoque
ALTER TABLE item ADD CONSTRAINT item_estoque_ck
  CHECK (estoque_atual >= 0 AND custo_medio >= 0 AND estoque_minimo >= 0);
ALTER TABLE item ADD CONSTRAINT item_servico_sem_estoque_ck
  CHECK (tipo <> 'SERVICO' OR (controla_estoque = false AND estoque_atual = 0));

-- EST-3: sinal do movimento coerente com o tipo; estorno aponta o original
ALTER TABLE movimento_estoque ADD CONSTRAINT movimento_sinal_ck CHECK (
  quantidade <> 0 AND (
    (tipo IN ('ENTRADA_COMPRA', 'DEVOLUCAO_CLIENTE', 'AJUSTE_ENTRADA') AND quantidade > 0) OR
    (tipo IN ('SAIDA_OS', 'DEVOLUCAO_FORNECEDOR', 'AJUSTE_SAIDA', 'PERDA') AND quantidade < 0) OR
    (tipo = 'ESTORNO' AND movimento_estornado_id IS NOT NULL)
  )
);
ALTER TABLE movimento_estoque ADD CONSTRAINT movimento_saldo_ck
  CHECK (saldo_apos >= 0 AND custo_unitario >= 0);

-- FIN-2: título com valores coerentes
ALTER TABLE titulo_financeiro ADD CONSTRAINT titulo_valores_ck
  CHECK (valor >= 0 AND valor_pago >= 0 AND valor_pago <= valor);

-- FIN-3: pagamento positivo; estorno negativo e ligado ao original
ALTER TABLE pagamento ADD CONSTRAINT pagamento_sinal_ck CHECK (
  (tipo = 'PAGAMENTO' AND valor > 0 AND pagamento_estornado_id IS NULL) OR
  (tipo = 'ESTORNO' AND valor < 0 AND pagamento_estornado_id IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- 3. Ledgers e históricos append-only
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION bloquear_alteracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é append-only: use um lançamento de estorno', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'movimento_estoque', 'pagamento', 'dispositivo_evento', 'audit_log',
    'historico_etapa_negocio', 'orcamento_status_historico', 'os_status_historico',
    'consentimento'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao()', t || '_append_only', t);
  END LOOP;
END $$;

-- ORC-2: orçamento imutável após o envio (itens e valores)
CREATE OR REPLACE FUNCTION orcamento_item_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM orcamento
   WHERE id = COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  -- só a decisão item a item (coluna "aprovado") muda após o envio
  IF st IS NOT NULL AND st <> 'RASCUNHO' THEN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'aprovado') = (to_jsonb(OLD) - 'aprovado') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'orçamento % já enviado: crie uma nova versão', COALESCE(NEW.orcamento_id, OLD.orcamento_id)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER orcamento_item_imutavel
  BEFORE INSERT OR UPDATE OR DELETE ON orcamento_item
  FOR EACH ROW EXECUTE FUNCTION orcamento_item_imutavel();

CREATE OR REPLACE FUNCTION orcamento_valores_imutaveis() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'RASCUNHO' AND (
       NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.desconto IS DISTINCT FROM OLD.desconto OR
       NEW.total IS DISTINCT FROM OLD.total OR NEW.validade IS DISTINCT FROM OLD.validade OR
       NEW.contato_id IS DISTINCT FROM OLD.contato_id OR NEW.condicoes IS DISTINCT FROM OLD.condicoes) THEN
    RAISE EXCEPTION 'orçamento % já enviado: crie uma nova versão', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orcamento_valores_imutaveis
  BEFORE UPDATE ON orcamento
  FOR EACH ROW EXECUTE FUNCTION orcamento_valores_imutaveis();

-- -----------------------------------------------------------------------------
-- 4. Row Level Security (SEG-1)
-- -----------------------------------------------------------------------------
-- A aplicação conecta com um papel SEM ownership das tabelas e SEM BYPASSRLS
-- (ex.: ebisu_app) e, no início de cada transação, executa:
--   SELECT set_config('app.tenant_id', '<uuid>', true);   -- true = local à transação
-- Sem contexto, current_setting devolve NULL e nenhuma linha é visível.

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Tabelas com tenant_id
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = current_schema() AND c.column_name = 'tenant_id'
       AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolamento ON %I
         USING (tenant_id = app_tenant_id())
         WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- O próprio tenant
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolamento ON tenant
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

-- Tabelas filhas sem tenant_id: isolamento pelo pai
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('etapa_funil',                'funil_id',     'funil'),
      ('historico_etapa_negocio',    'negocio_id',   'negocio'),
      ('orcamento_status_historico', 'orcamento_id', 'orcamento'),
      ('os_status_historico',        'os_id',        'ordem_servico')
    ) AS v(tabela, fk, pai)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tabela);
    EXECUTE format(
      'CREATE POLICY tenant_isolamento ON %1$I
         USING (EXISTS (SELECT 1 FROM %3$I p WHERE p.id = %1$I.%2$I))
         WITH CHECK (EXISTS (SELECT 1 FROM %3$I p WHERE p.id = %1$I.%2$I))',
      r.tabela, r.fk, r.pai);
  END LOOP;
END $$;

ALTER TABLE requisito_etapa ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisito_etapa FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolamento ON requisito_etapa
  USING (EXISTS (SELECT 1 FROM etapa_funil e WHERE e.id = requisito_etapa.etapa_id))
  WITH CHECK (EXISTS (SELECT 1 FROM etapa_funil e WHERE e.id = requisito_etapa.etapa_id));

ALTER TABLE papel_permissao ENABLE ROW LEVEL SECURITY;
ALTER TABLE papel_permissao FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolamento ON papel_permissao
  USING (EXISTS (SELECT 1 FROM papel p WHERE p.id = papel_permissao.papel_id))
  WITH CHECK (EXISTS (SELECT 1 FROM papel p WHERE p.id = papel_permissao.papel_id));

-- usuario, refresh_token e permissao são globais: acessadas só pelo módulo de
-- auth com um papel de banco próprio (ebisu_auth), nunca pelo ebisu_app.
