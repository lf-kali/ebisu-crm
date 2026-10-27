-- =============================================================================
-- ebisuCRM — migração inicial (v0.2-MVP)
-- 1–4: tabelas geradas pelo Prisma (schema.prisma) + complemento SQL
--      (CHECKs, índices parciais, triggers append-only e RLS — docs/invariantes.md).
-- 5:   papéis de banco ebisu_app / ebisu_auth e permissões (SEG-6).
-- =============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusTenant" AS ENUM ('TRIAL', 'ATIVO', 'SUSPENSO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusMembro" AS ENUM ('CONVIDADO', 'ATIVO', 'SUSPENSO');

-- CreateEnum
CREATE TYPE "EscopoPermissao" AS ENUM ('PROPRIO', 'EMPRESA', 'TENANT');

-- CreateEnum
CREATE TYPE "TipoDocumentoSequencia" AS ENUM ('ORCAMENTO', 'ORDEM_SERVICO', 'COMPRA');

-- CreateEnum
CREATE TYPE "StatusIdempotencia" AS ENUM ('EM_PROCESSAMENTO', 'CONCLUIDA');

-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "CanalComunicacao" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "CicloVida" AS ENUM ('LEAD', 'LEAD_QUALIFICADO', 'OPORTUNIDADE', 'CLIENTE', 'RECORRENTE', 'INATIVO');

-- CreateEnum
CREATE TYPE "Temperatura" AS ENUM ('FRIO', 'MORNO', 'QUENTE');

-- CreateEnum
CREATE TYPE "QuadranteLead" AS ENUM ('PRONTO_PARA_COMPRAR', 'CULTIVAR', 'PROSPECTAR', 'TRABALHAR_DEPOIS');

-- CreateEnum
CREATE TYPE "TipoOrigem" AS ENUM ('FORMULARIO_SITE', 'ORCAMENTO_ONLINE', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE_ADS', 'INDICACAO', 'BALCAO', 'TELEFONE', 'IMPORTACAO', 'MANUAL', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusCaptura" AS ENUM ('RECEBIDA', 'PROCESSADA', 'DUPLICADA', 'REJEITADA');

-- CreateEnum
CREATE TYPE "FinalidadeConsentimento" AS ENUM ('TRANSACIONAL', 'MARKETING');

-- CreateEnum
CREATE TYPE "TipoEtapa" AS ENUM ('ABERTA', 'GANHO', 'PERDIDO', 'NUTRICAO');

-- CreateEnum
CREATE TYPE "TipoRequisito" AS ENUM ('CAMPO', 'TAREFA', 'REGRA');

-- CreateEnum
CREATE TYPE "InteresseNegocio" AS ENUM ('REPARO', 'DIAGNOSTICO', 'MANUTENCAO_PREVENTIVA', 'RECUPERACAO_DADOS', 'UPGRADE', 'VENDA_PRODUTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "Urgencia" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');

-- CreateEnum
CREATE TYPE "StatusNegocio" AS ENUM ('ABERTO', 'GANHO', 'PERDIDO', 'NUTRICAO');

-- CreateEnum
CREATE TYPE "TipoAtividade" AS ENUM ('LIGACAO', 'WHATSAPP', 'EMAIL', 'SMS', 'VISITA_LOJA', 'REUNIAO', 'NOTA', 'NOTA_TECNICA', 'FORMULARIO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "DirecaoAtividade" AS ENUM ('ENTRADA', 'SAIDA', 'INTERNA');

-- CreateEnum
CREATE TYPE "StatusTarefa" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Prioridade" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "OrigemTarefa" AS ENUM ('MANUAL', 'REQUISITO_ETAPA', 'PROXIMA_ACAO', 'AUTOMACAO');

-- CreateEnum
CREATE TYPE "TipoAcao" AS ENUM ('LIGAR', 'ENVIAR_WHATSAPP', 'ENVIAR_EMAIL', 'ENVIAR_SMS', 'COMPLETAR_PERFIL', 'IDENTIFICAR_DISPOSITIVO', 'ELABORAR_ORCAMENTO', 'FOLLOW_UP_ORCAMENTO', 'AGENDAR_ENTRADA', 'OFERECER_UPSELL', 'REATIVAR_CLIENTE', 'PEDIR_AVALIACAO');

-- CreateEnum
CREATE TYPE "TipoDispositivo" AS ENUM ('CELULAR', 'TABLET', 'NOTEBOOK', 'DESKTOP', 'ALL_IN_ONE', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusDispositivo" AS ENUM ('ATIVO', 'INATIVO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "TipoEventoDispositivo" AS ENUM ('CADASTRO', 'ENTRADA', 'INSPECAO', 'DIAGNOSTICO', 'ORCAMENTO', 'PECA_SUBSTITUIDA', 'SERVICO_EXECUTADO', 'TESTE_QUALIDADE', 'SAIDA', 'RETORNO_GARANTIA', 'TROCA_PROPRIETARIO', 'OBSERVACAO');

-- CreateEnum
CREATE TYPE "CategoriaAcessorio" AS ENUM ('ALIMENTACAO', 'CONECTIVIDADE', 'PROTECAO', 'ARMAZENAMENTO', 'PERIFERICO', 'OUTRO');

-- CreateEnum
CREATE TYPE "PadraoTomada" AS ENUM ('TIPO_A', 'TIPO_C', 'TIPO_N');

-- CreateEnum
CREATE TYPE "TipoConector" AS ENUM ('USB_C', 'USB_A', 'MICRO_USB', 'LIGHTNING', 'P2', 'THUNDERBOLT_3', 'THUNDERBOLT_4', 'USB3_TIPO_B', 'MAGSAFE', 'PROPRIETARIO', 'SD', 'MICRO_SD');

-- CreateEnum
CREATE TYPE "ClasseVelocidade" AS ENUM ('CLASSE_4', 'CLASSE_6', 'CLASSE_10', 'UHS_I_U1', 'UHS_I_U3', 'UHS_II', 'UHS_III', 'V30', 'V60', 'V90');

-- CreateEnum
CREATE TYPE "Conectividade" AS ENUM ('COM_FIO', 'BLUETOOTH', 'DONGLE_2_4GHZ', 'BLUETOOTH_E_2_4GHZ');

-- CreateEnum
CREATE TYPE "LayoutTeclado" AS ENUM ('ABNT2', 'US_INTERNACIONAL', 'UK', 'OUTRO');

-- CreateEnum
CREATE TYPE "MomentoInspecao" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "StatusOrcamento" AS ENUM ('RASCUNHO', 'ENVIADO', 'VISUALIZADO', 'APROVADO', 'APROVADO_PARCIAL', 'REPROVADO', 'EXPIRADO', 'CANCELADO', 'CONVERTIDO');

-- CreateEnum
CREATE TYPE "CanalDecisao" AS ENUM ('LINK_PUBLICO', 'WHATSAPP', 'PRESENCIAL', 'TELEFONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "CanalEntrada" AS ENUM ('BALCAO', 'SITE', 'WHATSAPP', 'TELEFONE', 'COLETA');

-- CreateEnum
CREATE TYPE "TipoItem" AS ENUM ('PRODUTO', 'SERVICO');

-- CreateEnum
CREATE TYPE "StatusOS" AS ENUM ('ABERTA', 'EM_DIAGNOSTICO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_PECAS', 'EM_REPARO', 'EM_TESTES', 'PRONTA', 'ENTREGUE', 'SEM_REPARO', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoOS" AS ENUM ('REPARO', 'GARANTIA', 'MANUTENCAO_PREVENTIVA', 'CORTESIA');

-- CreateEnum
CREATE TYPE "StatusPeca" AS ENUM ('PENDENTE', 'A_COMPRAR', 'APLICADA', 'DEVOLVIDA');

-- CreateEnum
CREATE TYPE "CategoriaAnexo" AS ENUM ('FOTO_ENTRADA', 'FOTO_SAIDA', 'FOTO_REPARO', 'LAUDO', 'NOTA_FISCAL', 'TERMO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusCompra" AS ENUM ('RASCUNHO', 'RECEBIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA_COMPRA', 'SAIDA_OS', 'DEVOLUCAO_CLIENTE', 'DEVOLUCAO_FORNECEDOR', 'AJUSTE_ENTRADA', 'AJUSTE_SAIDA', 'PERDA', 'ESTORNO');

-- CreateEnum
CREATE TYPE "TipoTitulo" AS ENUM ('PAGAR', 'RECEBER');

-- CreateEnum
CREATE TYPE "StatusTitulo" AS ENUM ('ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "CategoriaFinanceira" AS ENUM ('RECEITA_SERVICO', 'RECEITA_PRODUTO', 'COMPRA_MERCADORIA', 'DESPESA_OPERACIONAL', 'OUTRA');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('PIX', 'DINHEIRO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoLancamentoPagamento" AS ENUM ('PAGAMENTO', 'ESTORNO');

-- CreateEnum
CREATE TYPE "EventoNotificacao" AS ENUM ('ORCAMENTO_ENVIADO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_REPROVADO', 'ORCAMENTO_EXPIRANDO', 'OS_ABERTA', 'OS_STATUS_ALTERADO', 'OS_AGUARDANDO_APROVACAO', 'OS_AGUARDANDO_PECAS', 'OS_PRONTA', 'OS_ENTREGUE', 'GARANTIA_EXPIRANDO', 'LEAD_FOLLOW_UP', 'PESQUISA_SATISFACAO');

-- CreateEnum
CREATE TYPE "StatusNotificacao" AS ENUM ('PENDENTE', 'ENVIANDO', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoJobLote" AS ENUM ('LEAD_CRIAR', 'LEAD_ATUALIZAR', 'LEAD_EXCLUIR', 'LEAD_IMPORTAR_CSV', 'ITEM_IMPORTAR_CSV');

-- CreateEnum
CREATE TYPE "StatusJob" AS ENUM ('NA_FILA', 'PROCESSANDO', 'CONCLUIDO', 'CONCLUIDO_COM_ERROS', 'FALHOU');

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plano" TEXT NOT NULL DEFAULT 'free',
    "status" "StatusTenant" NOT NULL DEFAULT 'TRIAL',
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "razao_social" TEXT NOT NULL,
    "nome_fantasia" TEXT NOT NULL,
    "cnpj" TEXT,
    "inscricao_est" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" JSONB,
    "logo_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "moeda" TEXT NOT NULL DEFAULT 'BRL',
    "config" JSONB NOT NULL DEFAULT '{}',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "senha_hash" TEXT,
    "avatar_url" TEXT,
    "ultimo_login" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "familia" UUID NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "revogado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membro" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "status" "StatusMembro" NOT NULL DEFAULT 'CONVIDADO',
    "cargo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papel" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissao" (
    "chave" TEXT NOT NULL,
    "recurso" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,

    CONSTRAINT "permissao_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "papel_permissao" (
    "papel_id" UUID NOT NULL,
    "permissao_chave" TEXT NOT NULL,
    "escopo" "EscopoPermissao" NOT NULL DEFAULT 'EMPRESA',

    CONSTRAINT "papel_permissao_pkey" PRIMARY KEY ("papel_id","permissao_chave")
);

-- CreateTable
CREATE TABLE "atribuicao_papel" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membro_id" UUID NOT NULL,
    "papel_id" UUID NOT NULL,
    "empresa_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atribuicao_papel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "escopos" TEXT[],
    "origens_cors" TEXT[],
    "ultimo_uso" TIMESTAMP(3),
    "expira_em" TIMESTAMP(3),
    "revogada_em" TIMESTAMP(3),
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequencia_documento" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoDocumentoSequencia" NOT NULL,
    "formato" TEXT NOT NULL,
    "periodo" TEXT NOT NULL DEFAULT '',
    "proximo" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequencia_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID,
    "ator_membro_id" UUID,
    "ator_api_key_id" UUID,
    "entidade_tipo" TEXT NOT NULL,
    "entidade_id" UUID NOT NULL,
    "acao" TEXT NOT NULL,
    "diff" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotencia_requisicao" (
    "tenant_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "rota" TEXT NOT NULL,
    "hash_payload" TEXT NOT NULL,
    "status" "StatusIdempotencia" NOT NULL DEFAULT 'EM_PROCESSAMENTO',
    "status_http" INTEGER,
    "resposta" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotencia_requisicao_pkey" PRIMARY KEY ("tenant_id","chave")
);

-- CreateTable
CREATE TABLE "contato" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo_pessoa" "TipoPessoa" NOT NULL DEFAULT 'PF',
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "email" TEXT,
    "email_normalizado" TEXT,
    "telefone_e164" TEXT,
    "whatsapp_e164" TEXT,
    "canal_preferido" "CanalComunicacao",
    "data_nascimento" DATE,
    "endereco" JSONB,
    "ciclo_vida" "CicloVida" NOT NULL DEFAULT 'LEAD',
    "origem_id" UUID,
    "responsavel_id" UUID,
    "score_fit" INTEGER NOT NULL DEFAULT 0,
    "score_engajamento" INTEGER NOT NULL DEFAULT 0,
    "score_total" INTEGER NOT NULL DEFAULT 0,
    "temperatura" "Temperatura" NOT NULL DEFAULT 'FRIO',
    "quadrante" "QuadranteLead" NOT NULL DEFAULT 'TRABALHAR_DEPOIS',
    "completude_perfil" INTEGER NOT NULL DEFAULT 0,
    "campos_faltantes" TEXT[],
    "score_motivos" JSONB NOT NULL DEFAULT '[]',
    "score_regras_versao" TEXT,
    "score_calculado_em" TIMESTAMP(3),
    "nba_adiada_ate" TIMESTAMP(3),
    "ultima_interacao_em" TIMESTAMP(3),
    "convertido_em" TIMESTAMP(3),
    "ltv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "anonimizado_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "origem_lead" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoOrigem" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "origem_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "captura_lead" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID,
    "origem_id" UUID,
    "evento" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "landing_page" TEXT,
    "referrer" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "idempotency_key" TEXT,
    "status" "StatusCaptura" NOT NULL DEFAULT 'RECEBIDA',
    "erro" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captura_lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consentimento" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID NOT NULL,
    "canal" "CanalComunicacao" NOT NULL,
    "finalidade" "FinalidadeConsentimento" NOT NULL,
    "concedido" BOOLEAN NOT NULL,
    "base_legal" TEXT NOT NULL,
    "evidencia" JSONB,
    "coletado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consentimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funil" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etapa_funil" (
    "id" UUID NOT NULL,
    "funil_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" "TipoEtapa" NOT NULL DEFAULT 'ABERTA',
    "probabilidade" INTEGER NOT NULL DEFAULT 0,
    "sla_horas" INTEGER,
    "cor" TEXT,

    CONSTRAINT "etapa_funil_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requisito_etapa" (
    "id" UUID NOT NULL,
    "etapa_id" UUID NOT NULL,
    "tipo" "TipoRequisito" NOT NULL,
    "chave" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "titulo_tarefa" TEXT,

    CONSTRAINT "requisito_etapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negocio" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID NOT NULL,
    "funil_id" UUID NOT NULL,
    "etapa_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "interesse" "InteresseNegocio" NOT NULL DEFAULT 'REPARO',
    "tipo_dispositivo" "TipoDispositivo",
    "dispositivo_id" UUID,
    "descricao_problema" TEXT,
    "urgencia" "Urgencia",
    "valor_estimado" DECIMAL(14,2),
    "previsao_fechamento" DATE,
    "status" "StatusNegocio" NOT NULL DEFAULT 'ABERTO',
    "motivo_perda_id" UUID,
    "responsavel_id" UUID,
    "entrou_etapa_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechado_em" TIMESTAMP(3),
    "completude" INTEGER NOT NULL DEFAULT 0,
    "nba_adiada_ate" TIMESTAMP(3),
    "versao_registro" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "motivo_perda" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "motivo_perda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_etapa_negocio" (
    "id" UUID NOT NULL,
    "negocio_id" UUID NOT NULL,
    "de_etapa_id" UUID,
    "para_etapa_id" UUID NOT NULL,
    "membro_id" UUID,
    "segundos_na_etapa" INTEGER,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_etapa_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atividade" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID,
    "negocio_id" UUID,
    "os_id" UUID,
    "tipo" "TipoAtividade" NOT NULL,
    "direcao" "DirecaoAtividade" NOT NULL DEFAULT 'INTERNA',
    "assunto" TEXT,
    "conteudo" TEXT,
    "resultado" TEXT,
    "minutos" INTEGER,
    "membro_id" UUID,
    "metadados" JSONB,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atividade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarefa" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID,
    "negocio_id" UUID,
    "os_id" UUID,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "StatusTarefa" NOT NULL DEFAULT 'PENDENTE',
    "prioridade" "Prioridade" NOT NULL DEFAULT 'NORMAL',
    "origem" "OrigemTarefa" NOT NULL DEFAULT 'MANUAL',
    "requisito_id" UUID,
    "acao" "TipoAcao",
    "regra_chave" TEXT,
    "vence_em" TIMESTAMP(3),
    "responsavel_id" UUID,
    "concluida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoDispositivo" NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "cor" TEXT,
    "numero_serie" TEXT,
    "imei" TEXT,
    "imei_2" TEXT,
    "armazenamento_gb" INTEGER,
    "especificacoes" JSONB NOT NULL DEFAULT '{}',
    "proprietario_atual_id" UUID,
    "status" "StatusDispositivo" NOT NULL DEFAULT 'ATIVO',
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivo_proprietario" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "dispositivo_id" UUID NOT NULL,
    "contato_id" UUID NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ate" TIMESTAMP(3),

    CONSTRAINT "dispositivo_proprietario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositivo_evento" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "dispositivo_id" UUID NOT NULL,
    "tipo" "TipoEventoDispositivo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "os_id" UUID,
    "orcamento_id" UUID,
    "item_id" UUID,
    "membro_id" UUID,
    "dados" JSONB,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispositivo_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_acessorio" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaAcessorio" NOT NULL,
    "tem_padrao_tomada" BOOLEAN NOT NULL DEFAULT false,
    "tem_tipo_conector" BOOLEAN NOT NULL DEFAULT false,
    "tem_potencia_watts" BOOLEAN NOT NULL DEFAULT false,
    "tem_capacidade" BOOLEAN NOT NULL DEFAULT false,
    "tem_classe_velocidade" BOOLEAN NOT NULL DEFAULT false,
    "tem_conectividade_sem_fio" BOOLEAN NOT NULL DEFAULT false,
    "tem_layout" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipo_acessorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acessorio_recebido" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "orcamento_id" UUID,
    "os_id" UUID,
    "tipo_acessorio_id" UUID NOT NULL,
    "padrao_tomada" "PadraoTomada",
    "tipo_conector" "TipoConector",
    "potencia_watts" INTEGER,
    "capacidade" TEXT,
    "classe_velocidade" "ClasseVelocidade",
    "conectividade" "Conectividade",
    "layout_teclado" "LayoutTeclado",
    "cor" TEXT,
    "detalhes" TEXT,
    "devolvido_em" TIMESTAMP(3),

    CONSTRAINT "acessorio_recebido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_modelo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_dispositivo" "TipoDispositivo" NOT NULL,
    "momento" "MomentoInspecao" NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "itens" JSONB NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "checklist_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspecao" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "dispositivo_id" UUID NOT NULL,
    "orcamento_id" UUID,
    "os_id" UUID,
    "modelo_id" UUID,
    "momento" "MomentoInspecao" NOT NULL,
    "itens_snapshot" JSONB NOT NULL,
    "respostas" JSONB NOT NULL DEFAULT '{}',
    "estado_externo" TEXT NOT NULL,
    "liga_normalmente" BOOLEAN,
    "bloqueio_removido" BOOLEAN NOT NULL DEFAULT false,
    "bloqueio_observacao" TEXT,
    "observacoes" TEXT,
    "termo_versao" TEXT,
    "termo_aceito_em" TIMESTAMP(3),
    "termo_aceito_por" TEXT,
    "termo_canal" "CanalDecisao",
    "realizada_por" UUID,
    "realizada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspecao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "orcamento_pai_id" UUID,
    "contato_id" UUID NOT NULL,
    "negocio_id" UUID,
    "tipo_dispositivo" "TipoDispositivo" NOT NULL,
    "dispositivo_id" UUID,
    "canal_entrada" "CanalEntrada" NOT NULL DEFAULT 'BALCAO',
    "descricao_problema" TEXT NOT NULL,
    "diagnostico" TEXT,
    "status" "StatusOrcamento" NOT NULL DEFAULT 'RASCUNHO',
    "validade" DATE NOT NULL,
    "prazo_execucao_dias" INTEGER,
    "garantia_dias" INTEGER,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_aprovado" DECIMAL(14,2),
    "condicoes" TEXT,
    "observacoes" TEXT,
    "token_publico" TEXT NOT NULL,
    "enviado_em" TIMESTAMP(3),
    "visualizado_em" TIMESTAMP(3),
    "decidido_em" TIMESTAMP(3),
    "decidido_via" "CanalDecisao",
    "decisao_evidencia" JSONB,
    "motivo_reprovacao" TEXT,
    "responsavel_id" UUID,
    "criado_por" UUID,
    "versao_registro" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "orcamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_status_historico" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "de_status" "StatusOrcamento",
    "para_status" "StatusOrcamento" NOT NULL,
    "membro_id" UUID,
    "observacao" TEXT,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_status_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "item_id" UUID,
    "tipo" "TipoItem" NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "preco_unitario" DECIMAL(14,2) NOT NULL,
    "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "custo_unitario" DECIMAL(14,2),
    "opcional" BOOLEAN NOT NULL DEFAULT false,
    "aprovado" BOOLEAN,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "orcamento_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordem_servico" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo" "TipoOS" NOT NULL DEFAULT 'REPARO',
    "contato_id" UUID NOT NULL,
    "dispositivo_id" UUID NOT NULL,
    "orcamento_id" UUID,
    "negocio_id" UUID,
    "os_origem_id" UUID,
    "status" "StatusOS" NOT NULL DEFAULT 'ABERTA',
    "prioridade" "Prioridade" NOT NULL DEFAULT 'NORMAL',
    "canal_entrada" "CanalEntrada" NOT NULL DEFAULT 'BALCAO',
    "descricao_problema" TEXT NOT NULL,
    "diagnostico_tecnico" TEXT,
    "solucao_aplicada" TEXT,
    "tecnico_id" UUID,
    "local_bancada" TEXT,
    "prazo" TIMESTAMP(3) NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "entregue_em" TIMESTAMP(3),
    "entregue_a" TEXT,
    "garantia_dias" INTEGER,
    "garantia_ate" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "custo_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacoes_internas" TEXT,
    "criado_por" UUID,
    "versao_registro" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ordem_servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "os_status_historico" (
    "id" UUID NOT NULL,
    "os_id" UUID NOT NULL,
    "de_status" "StatusOS",
    "para_status" "StatusOS" NOT NULL,
    "membro_id" UUID,
    "observacao" TEXT,
    "notificar" BOOLEAN NOT NULL DEFAULT true,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "os_status_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordem_servico_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "os_id" UUID NOT NULL,
    "item_id" UUID,
    "tipo" "TipoItem" NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "preco_unitario" DECIMAL(14,2) NOT NULL,
    "desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "custo_unitario" DECIMAL(14,2),
    "status_peca" "StatusPeca",
    "tecnico_id" UUID,
    "garantia_dias" INTEGER,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ordem_servico_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID,
    "orcamento_id" UUID,
    "os_id" UUID,
    "dispositivo_id" UUID,
    "compra_id" UUID,
    "categoria" "CategoriaAnexo" NOT NULL DEFAULT 'OUTRO',
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "publico" BOOLEAN NOT NULL DEFAULT false,
    "enviado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedor" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "contato_nome" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "site" TEXT,
    "prazo_entrega_dias" INTEGER,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoItem" NOT NULL,
    "sku" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "categoria" TEXT,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "controla_estoque" BOOLEAN NOT NULL DEFAULT true,
    "preco_venda" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "preco_compra" DECIMAL(14,2),
    "custo_medio" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoque_atual" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "estoque_minimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "fornecedor_padrao_id" UUID,
    "tempo_estimado_min" INTEGER,
    "garantia_dias" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compra" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "fornecedor_id" UUID,
    "documento_fiscal" TEXT,
    "data" DATE NOT NULL,
    "status" "StatusCompra" NOT NULL DEFAULT 'RASCUNHO',
    "frete" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outras_despesas" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "criado_por" UUID,
    "recebida_em" TIMESTAMP(3),
    "versao_registro" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compra_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "compra_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custo_unitario" DECIMAL(14,2) NOT NULL,
    "custo_unitario_final" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "compra_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimento_estoque" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "chave_operacao" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "valor_total" DECIMAL(14,2) NOT NULL,
    "saldo_apos" DECIMAL(14,3) NOT NULL,
    "custo_medio_apos" DECIMAL(14,4) NOT NULL,
    "compra_item_id" UUID,
    "os_item_id" UUID,
    "movimento_estornado_id" UUID,
    "motivo" TEXT,
    "membro_id" UUID,
    "ocorreu_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titulo_financeiro" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoTitulo" NOT NULL,
    "categoria" "CategoriaFinanceira" NOT NULL,
    "descricao" TEXT NOT NULL,
    "contato_id" UUID,
    "fornecedor_id" UUID,
    "compra_id" UUID,
    "os_id" UUID,
    "valor" DECIMAL(14,2) NOT NULL,
    "valor_pago" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vencimento" DATE NOT NULL,
    "status" "StatusTitulo" NOT NULL DEFAULT 'ABERTO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "titulo_financeiro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamento" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "titulo_id" UUID NOT NULL,
    "tipo" "TipoLancamentoPagamento" NOT NULL DEFAULT 'PAGAMENTO',
    "valor" DECIMAL(14,2) NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "taxa" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "referencia_externa" TEXT,
    "pagamento_estornado_id" UUID,
    "membro_id" UUID,
    "pago_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelo_mensagem" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "evento" "EventoNotificacao" NOT NULL,
    "canal" "CanalComunicacao" NOT NULL,
    "assunto" TEXT,
    "corpo" TEXT NOT NULL,
    "whatsapp_template" TEXT,
    "whatsapp_idioma" TEXT DEFAULT 'pt_BR',
    "status_os" "StatusOS"[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "modelo_mensagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "contato_id" UUID NOT NULL,
    "orcamento_id" UUID,
    "os_id" UUID,
    "negocio_id" UUID,
    "evento" "EventoNotificacao" NOT NULL,
    "canal" "CanalComunicacao" NOT NULL,
    "chave_dedupe" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "modelo_id" UUID,
    "variaveis" JSONB NOT NULL,
    "conteudo" TEXT,
    "status" "StatusNotificacao" NOT NULL DEFAULT 'PENDENTE',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "provedor" TEXT,
    "provedor_msg_id" TEXT,
    "erro" TEXT,
    "agendada_para" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviada_em" TIMESTAMP(3),
    "entregue_em" TIMESTAMP(3),
    "lida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_lote" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "tipo" "TipoJobLote" NOT NULL,
    "status" "StatusJob" NOT NULL DEFAULT 'NA_FILA',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processados" INTEGER NOT NULL DEFAULT 0,
    "sucesso" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "parametros" JSONB NOT NULL,
    "erros" JSONB,
    "arquivo_key" TEXT,
    "idempotency_key" TEXT,
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizado_em" TIMESTAMP(3),

    CONSTRAINT "job_lote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "empresa_tenant_id_idx" ON "empresa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_tenant_id_id_key" ON "empresa"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_tenant_id_cnpj_key" ON "empresa"("tenant_id", "cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_usuario_id_idx" ON "refresh_token"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "membro_tenant_id_usuario_id_key" ON "membro"("tenant_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "membro_tenant_id_id_key" ON "membro"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "papel_tenant_id_chave_key" ON "papel"("tenant_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "papel_tenant_id_id_key" ON "papel"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "atribuicao_papel_membro_id_papel_id_empresa_id_key" ON "atribuicao_papel"("membro_id", "papel_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_prefixo_key" ON "api_key"("prefixo");

-- CreateIndex
CREATE UNIQUE INDEX "sequencia_documento_empresa_id_tipo_periodo_key" ON "sequencia_documento"("empresa_id", "tipo", "periodo");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entidade_tipo_entidade_id_idx" ON "audit_log"("tenant_id", "entidade_tipo", "entidade_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_ocorreu_em_idx" ON "audit_log"("tenant_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "idempotencia_requisicao_expira_em_idx" ON "idempotencia_requisicao"("expira_em");

-- CreateIndex
CREATE INDEX "contato_empresa_id_email_normalizado_idx" ON "contato"("empresa_id", "email_normalizado");

-- CreateIndex
CREATE INDEX "contato_empresa_id_telefone_e164_idx" ON "contato"("empresa_id", "telefone_e164");

-- CreateIndex
CREATE INDEX "contato_empresa_id_whatsapp_e164_idx" ON "contato"("empresa_id", "whatsapp_e164");

-- CreateIndex
CREATE INDEX "contato_empresa_id_quadrante_score_total_idx" ON "contato"("empresa_id", "quadrante", "score_total");

-- CreateIndex
CREATE INDEX "contato_empresa_id_ciclo_vida_idx" ON "contato"("empresa_id", "ciclo_vida");

-- CreateIndex
CREATE UNIQUE INDEX "contato_empresa_id_id_key" ON "contato"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "origem_lead_empresa_id_nome_key" ON "origem_lead"("empresa_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "origem_lead_empresa_id_id_key" ON "origem_lead"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "captura_lead_empresa_id_recebido_em_idx" ON "captura_lead"("empresa_id", "recebido_em");

-- CreateIndex
CREATE INDEX "captura_lead_contato_id_recebido_em_idx" ON "captura_lead"("contato_id", "recebido_em");

-- CreateIndex
CREATE UNIQUE INDEX "captura_lead_empresa_id_idempotency_key_key" ON "captura_lead"("empresa_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "consentimento_contato_id_canal_finalidade_coletado_em_idx" ON "consentimento"("contato_id", "canal", "finalidade", "coletado_em");

-- CreateIndex
CREATE UNIQUE INDEX "funil_empresa_id_id_key" ON "funil"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "etapa_funil_funil_id_ordem_key" ON "etapa_funil"("funil_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "etapa_funil_funil_id_id_key" ON "etapa_funil"("funil_id", "id");

-- CreateIndex
CREATE INDEX "negocio_empresa_id_status_etapa_id_idx" ON "negocio"("empresa_id", "status", "etapa_id");

-- CreateIndex
CREATE INDEX "negocio_contato_id_idx" ON "negocio"("contato_id");

-- CreateIndex
CREATE UNIQUE INDEX "negocio_empresa_id_id_key" ON "negocio"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_perda_empresa_id_nome_key" ON "motivo_perda"("empresa_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "motivo_perda_empresa_id_id_key" ON "motivo_perda"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "historico_etapa_negocio_negocio_id_ocorreu_em_idx" ON "historico_etapa_negocio"("negocio_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "atividade_contato_id_ocorreu_em_idx" ON "atividade"("contato_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "atividade_negocio_id_ocorreu_em_idx" ON "atividade"("negocio_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "atividade_os_id_ocorreu_em_idx" ON "atividade"("os_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "tarefa_empresa_id_responsavel_id_status_vence_em_idx" ON "tarefa"("empresa_id", "responsavel_id", "status", "vence_em");

-- CreateIndex
CREATE INDEX "dispositivo_empresa_id_imei_idx" ON "dispositivo"("empresa_id", "imei");

-- CreateIndex
CREATE INDEX "dispositivo_empresa_id_numero_serie_idx" ON "dispositivo"("empresa_id", "numero_serie");

-- CreateIndex
CREATE INDEX "dispositivo_proprietario_atual_id_idx" ON "dispositivo"("proprietario_atual_id");

-- CreateIndex
CREATE UNIQUE INDEX "dispositivo_empresa_id_id_key" ON "dispositivo"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "dispositivo_proprietario_dispositivo_id_desde_idx" ON "dispositivo_proprietario"("dispositivo_id", "desde");

-- CreateIndex
CREATE INDEX "dispositivo_evento_dispositivo_id_ocorreu_em_idx" ON "dispositivo_evento"("dispositivo_id", "ocorreu_em");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_acessorio_tenant_id_nome_key" ON "tipo_acessorio"("tenant_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_acessorio_tenant_id_id_key" ON "tipo_acessorio"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_modelo_tenant_id_id_key" ON "checklist_modelo"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "inspecao_os_id_momento_idx" ON "inspecao"("os_id", "momento");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_token_publico_key" ON "orcamento"("token_publico");

-- CreateIndex
CREATE INDEX "orcamento_empresa_id_status_validade_idx" ON "orcamento"("empresa_id", "status", "validade");

-- CreateIndex
CREATE INDEX "orcamento_contato_id_idx" ON "orcamento"("contato_id");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_empresa_id_numero_versao_key" ON "orcamento"("empresa_id", "numero", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "orcamento_empresa_id_id_key" ON "orcamento"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "orcamento_status_historico_orcamento_id_ocorreu_em_idx" ON "orcamento_status_historico"("orcamento_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "orcamento_item_orcamento_id_idx" ON "orcamento_item"("orcamento_id");

-- CreateIndex
CREATE INDEX "ordem_servico_empresa_id_status_prazo_idx" ON "ordem_servico"("empresa_id", "status", "prazo");

-- CreateIndex
CREATE INDEX "ordem_servico_empresa_id_tecnico_id_status_idx" ON "ordem_servico"("empresa_id", "tecnico_id", "status");

-- CreateIndex
CREATE INDEX "ordem_servico_dispositivo_id_idx" ON "ordem_servico"("dispositivo_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordem_servico_empresa_id_numero_key" ON "ordem_servico"("empresa_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ordem_servico_empresa_id_id_key" ON "ordem_servico"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ordem_servico_empresa_id_orcamento_id_key" ON "ordem_servico"("empresa_id", "orcamento_id");

-- CreateIndex
CREATE INDEX "os_status_historico_os_id_ocorreu_em_idx" ON "os_status_historico"("os_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "ordem_servico_item_os_id_idx" ON "ordem_servico_item"("os_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordem_servico_item_empresa_id_id_key" ON "ordem_servico_item"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "anexo_os_id_idx" ON "anexo"("os_id");

-- CreateIndex
CREATE INDEX "anexo_orcamento_id_idx" ON "anexo"("orcamento_id");

-- CreateIndex
CREATE INDEX "anexo_dispositivo_id_idx" ON "anexo"("dispositivo_id");

-- CreateIndex
CREATE UNIQUE INDEX "fornecedor_empresa_id_id_key" ON "fornecedor"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "item_empresa_id_nome_idx" ON "item"("empresa_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "item_empresa_id_sku_key" ON "item"("empresa_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "item_empresa_id_id_key" ON "item"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compra_empresa_id_numero_key" ON "compra"("empresa_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "compra_empresa_id_id_key" ON "compra"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compra_item_empresa_id_id_key" ON "compra_item"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "movimento_estoque_item_id_ocorreu_em_idx" ON "movimento_estoque"("item_id", "ocorreu_em");

-- CreateIndex
CREATE INDEX "movimento_estoque_empresa_id_tipo_ocorreu_em_idx" ON "movimento_estoque"("empresa_id", "tipo", "ocorreu_em");

-- CreateIndex
CREATE UNIQUE INDEX "movimento_estoque_empresa_id_chave_operacao_key" ON "movimento_estoque"("empresa_id", "chave_operacao");

-- CreateIndex
CREATE UNIQUE INDEX "movimento_estoque_empresa_id_id_key" ON "movimento_estoque"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "movimento_estoque_empresa_id_movimento_estornado_id_key" ON "movimento_estoque"("empresa_id", "movimento_estornado_id");

-- CreateIndex
CREATE INDEX "titulo_financeiro_empresa_id_tipo_status_vencimento_idx" ON "titulo_financeiro"("empresa_id", "tipo", "status", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "titulo_financeiro_empresa_id_id_key" ON "titulo_financeiro"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "pagamento_titulo_id_idx" ON "pagamento"("titulo_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamento_empresa_id_id_key" ON "pagamento"("empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamento_empresa_id_pagamento_estornado_id_key" ON "pagamento"("empresa_id", "pagamento_estornado_id");

-- CreateIndex
CREATE UNIQUE INDEX "modelo_mensagem_empresa_id_evento_canal_key" ON "modelo_mensagem"("empresa_id", "evento", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "modelo_mensagem_empresa_id_id_key" ON "modelo_mensagem"("empresa_id", "id");

-- CreateIndex
CREATE INDEX "notificacao_status_agendada_para_idx" ON "notificacao"("status", "agendada_para");

-- CreateIndex
CREATE INDEX "notificacao_os_id_idx" ON "notificacao"("os_id");

-- CreateIndex
CREATE INDEX "notificacao_orcamento_id_idx" ON "notificacao"("orcamento_id");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_empresa_id_chave_dedupe_key" ON "notificacao"("empresa_id", "chave_dedupe");

-- CreateIndex
CREATE UNIQUE INDEX "notificacao_provedor_provedor_msg_id_key" ON "notificacao"("provedor", "provedor_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_lote_empresa_id_idempotency_key_key" ON "job_lote"("empresa_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "empresa" ADD CONSTRAINT "empresa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membro" ADD CONSTRAINT "membro_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membro" ADD CONSTRAINT "membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papel" ADD CONSTRAINT "papel_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papel_permissao" ADD CONSTRAINT "papel_permissao_papel_id_fkey" FOREIGN KEY ("papel_id") REFERENCES "papel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papel_permissao" ADD CONSTRAINT "papel_permissao_permissao_chave_fkey" FOREIGN KEY ("permissao_chave") REFERENCES "permissao"("chave") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atribuicao_papel" ADD CONSTRAINT "atribuicao_papel_tenant_id_membro_id_fkey" FOREIGN KEY ("tenant_id", "membro_id") REFERENCES "membro"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atribuicao_papel" ADD CONSTRAINT "atribuicao_papel_tenant_id_papel_id_fkey" FOREIGN KEY ("tenant_id", "papel_id") REFERENCES "papel"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atribuicao_papel" ADD CONSTRAINT "atribuicao_papel_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequencia_documento" ADD CONSTRAINT "sequencia_documento_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotencia_requisicao" ADD CONSTRAINT "idempotencia_requisicao_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_empresa_id_origem_id_fkey" FOREIGN KEY ("empresa_id", "origem_id") REFERENCES "origem_lead"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contato" ADD CONSTRAINT "contato_tenant_id_responsavel_id_fkey" FOREIGN KEY ("tenant_id", "responsavel_id") REFERENCES "membro"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "origem_lead" ADD CONSTRAINT "origem_lead_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captura_lead" ADD CONSTRAINT "captura_lead_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captura_lead" ADD CONSTRAINT "captura_lead_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "captura_lead" ADD CONSTRAINT "captura_lead_empresa_id_origem_id_fkey" FOREIGN KEY ("empresa_id", "origem_id") REFERENCES "origem_lead"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funil" ADD CONSTRAINT "funil_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etapa_funil" ADD CONSTRAINT "etapa_funil_funil_id_fkey" FOREIGN KEY ("funil_id") REFERENCES "funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requisito_etapa" ADD CONSTRAINT "requisito_etapa_etapa_id_fkey" FOREIGN KEY ("etapa_id") REFERENCES "etapa_funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_empresa_id_funil_id_fkey" FOREIGN KEY ("empresa_id", "funil_id") REFERENCES "funil"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_funil_id_etapa_id_fkey" FOREIGN KEY ("funil_id", "etapa_id") REFERENCES "etapa_funil"("funil_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_empresa_id_motivo_perda_id_fkey" FOREIGN KEY ("empresa_id", "motivo_perda_id") REFERENCES "motivo_perda"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negocio" ADD CONSTRAINT "negocio_tenant_id_responsavel_id_fkey" FOREIGN KEY ("tenant_id", "responsavel_id") REFERENCES "membro"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motivo_perda" ADD CONSTRAINT "motivo_perda_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_etapa_negocio" ADD CONSTRAINT "historico_etapa_negocio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade" ADD CONSTRAINT "atividade_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade" ADD CONSTRAINT "atividade_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade" ADD CONSTRAINT "atividade_empresa_id_negocio_id_fkey" FOREIGN KEY ("empresa_id", "negocio_id") REFERENCES "negocio"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atividade" ADD CONSTRAINT "atividade_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_empresa_id_negocio_id_fkey" FOREIGN KEY ("empresa_id", "negocio_id") REFERENCES "negocio"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_requisito_id_fkey" FOREIGN KEY ("requisito_id") REFERENCES "requisito_etapa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefa" ADD CONSTRAINT "tarefa_tenant_id_responsavel_id_fkey" FOREIGN KEY ("tenant_id", "responsavel_id") REFERENCES "membro"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo" ADD CONSTRAINT "dispositivo_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo" ADD CONSTRAINT "dispositivo_empresa_id_proprietario_atual_id_fkey" FOREIGN KEY ("empresa_id", "proprietario_atual_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_proprietario" ADD CONSTRAINT "dispositivo_proprietario_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_proprietario" ADD CONSTRAINT "dispositivo_proprietario_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_proprietario" ADD CONSTRAINT "dispositivo_proprietario_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_evento" ADD CONSTRAINT "dispositivo_evento_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_evento" ADD CONSTRAINT "dispositivo_evento_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_evento" ADD CONSTRAINT "dispositivo_evento_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_evento" ADD CONSTRAINT "dispositivo_evento_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispositivo_evento" ADD CONSTRAINT "dispositivo_evento_empresa_id_item_id_fkey" FOREIGN KEY ("empresa_id", "item_id") REFERENCES "item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_acessorio" ADD CONSTRAINT "tipo_acessorio_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessorio_recebido" ADD CONSTRAINT "acessorio_recebido_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessorio_recebido" ADD CONSTRAINT "acessorio_recebido_tenant_id_tipo_acessorio_id_fkey" FOREIGN KEY ("tenant_id", "tipo_acessorio_id") REFERENCES "tipo_acessorio"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessorio_recebido" ADD CONSTRAINT "acessorio_recebido_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessorio_recebido" ADD CONSTRAINT "acessorio_recebido_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_modelo" ADD CONSTRAINT "checklist_modelo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspecao" ADD CONSTRAINT "inspecao_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspecao" ADD CONSTRAINT "inspecao_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspecao" ADD CONSTRAINT "inspecao_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspecao" ADD CONSTRAINT "inspecao_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspecao" ADD CONSTRAINT "inspecao_tenant_id_modelo_id_fkey" FOREIGN KEY ("tenant_id", "modelo_id") REFERENCES "checklist_modelo"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_empresa_id_negocio_id_fkey" FOREIGN KEY ("empresa_id", "negocio_id") REFERENCES "negocio"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento" ADD CONSTRAINT "orcamento_empresa_id_orcamento_pai_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_pai_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_status_historico" ADD CONSTRAINT "orcamento_status_historico_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item" ADD CONSTRAINT "orcamento_item_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item" ADD CONSTRAINT "orcamento_item_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_item" ADD CONSTRAINT "orcamento_item_empresa_id_item_id_fkey" FOREIGN KEY ("empresa_id", "item_id") REFERENCES "item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_negocio_id_fkey" FOREIGN KEY ("empresa_id", "negocio_id") REFERENCES "negocio"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_tenant_id_tecnico_id_fkey" FOREIGN KEY ("tenant_id", "tecnico_id") REFERENCES "membro"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico" ADD CONSTRAINT "ordem_servico_empresa_id_os_origem_id_fkey" FOREIGN KEY ("empresa_id", "os_origem_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "os_status_historico" ADD CONSTRAINT "os_status_historico_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "ordem_servico"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico_item" ADD CONSTRAINT "ordem_servico_item_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico_item" ADD CONSTRAINT "ordem_servico_item_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_servico_item" ADD CONSTRAINT "ordem_servico_item_empresa_id_item_id_fkey" FOREIGN KEY ("empresa_id", "item_id") REFERENCES "item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_empresa_id_dispositivo_id_fkey" FOREIGN KEY ("empresa_id", "dispositivo_id") REFERENCES "dispositivo"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_empresa_id_compra_id_fkey" FOREIGN KEY ("empresa_id", "compra_id") REFERENCES "compra"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_empresa_id_fornecedor_padrao_id_fkey" FOREIGN KEY ("empresa_id", "fornecedor_padrao_id") REFERENCES "fornecedor"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra" ADD CONSTRAINT "compra_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra" ADD CONSTRAINT "compra_empresa_id_fornecedor_id_fkey" FOREIGN KEY ("empresa_id", "fornecedor_id") REFERENCES "fornecedor"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_item" ADD CONSTRAINT "compra_item_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_item" ADD CONSTRAINT "compra_item_empresa_id_compra_id_fkey" FOREIGN KEY ("empresa_id", "compra_id") REFERENCES "compra"("empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_item" ADD CONSTRAINT "compra_item_empresa_id_item_id_fkey" FOREIGN KEY ("empresa_id", "item_id") REFERENCES "item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_empresa_id_item_id_fkey" FOREIGN KEY ("empresa_id", "item_id") REFERENCES "item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_empresa_id_compra_item_id_fkey" FOREIGN KEY ("empresa_id", "compra_item_id") REFERENCES "compra_item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_empresa_id_os_item_id_fkey" FOREIGN KEY ("empresa_id", "os_item_id") REFERENCES "ordem_servico_item"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimento_estoque" ADD CONSTRAINT "movimento_estoque_empresa_id_movimento_estornado_id_fkey" FOREIGN KEY ("empresa_id", "movimento_estornado_id") REFERENCES "movimento_estoque"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_empresa_id_fornecedor_id_fkey" FOREIGN KEY ("empresa_id", "fornecedor_id") REFERENCES "fornecedor"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_empresa_id_compra_id_fkey" FOREIGN KEY ("empresa_id", "compra_id") REFERENCES "compra"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulo_financeiro" ADD CONSTRAINT "titulo_financeiro_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_empresa_id_titulo_id_fkey" FOREIGN KEY ("empresa_id", "titulo_id") REFERENCES "titulo_financeiro"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamento" ADD CONSTRAINT "pagamento_empresa_id_pagamento_estornado_id_fkey" FOREIGN KEY ("empresa_id", "pagamento_estornado_id") REFERENCES "pagamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_mensagem" ADD CONSTRAINT "modelo_mensagem_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_contato_id_fkey" FOREIGN KEY ("empresa_id", "contato_id") REFERENCES "contato"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_orcamento_id_fkey" FOREIGN KEY ("empresa_id", "orcamento_id") REFERENCES "orcamento"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_os_id_fkey" FOREIGN KEY ("empresa_id", "os_id") REFERENCES "ordem_servico"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_negocio_id_fkey" FOREIGN KEY ("empresa_id", "negocio_id") REFERENCES "negocio"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_empresa_id_modelo_id_fkey" FOREIGN KEY ("empresa_id", "modelo_id") REFERENCES "modelo_mensagem"("empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_lote" ADD CONSTRAINT "job_lote_tenant_id_empresa_id_fkey" FOREIGN KEY ("tenant_id", "empresa_id") REFERENCES "empresa"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


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

-- =============================================================================
-- 5. Papéis de banco e permissões (SEG-6)
-- -----------------------------------------------------------------------------
-- Os papéis nascem NOLOGIN e sem senha. LOGIN e senha são definidos fora da
-- migração por `pnpm db:papeis` (packages/db/scripts/configurar-papeis.mjs).
-- Nenhum dos dois é dono das tabelas nem tem BYPASSRLS: o RLS vale sempre.
--
-- ebisu_app  → API e worker. Tudo sob RLS por tenant. Sem acesso às tabelas
--              globais de autenticação (usuario, refresh_token, permissao).
-- ebisu_auth → módulo de auth. Lê e grava usuario/refresh_token, lê o catálogo
--              de permissões e LÊ (só leitura) membro/tenant/empresa de qualquer
--              tenant, para resolver os vínculos do usuário no login.
--
-- Migrações futuras: toda tabela nova recebe GRANT explícito (não há default
-- privileges) e só ebisu_app/ebisu_auth acessam tabelas com RLS forçado,
-- exceto as globais de auth — o teste de integração do pacote verifica.
--
-- Limitação conhecida: a FK membro.usuario_id é checada com os privilégios do
-- dono, então ebisu_app distingue um usuario.id existente de um inexistente ao
-- gravar membro. A criação de membros fica restrita a fluxos controlados (F3).
-- =============================================================================

-- Papéis são globais do cluster: se já existirem (outro banco do mesmo cluster),
-- são reaproveitados, mas a migração aborta se algum puder ignorar o RLS.
DO $$
DECLARE papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['ebisu_app', 'ebisu_auth'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', papel);
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel
                   AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)) THEN
      RAISE EXCEPTION 'Papel % já existe com SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB; corrija antes de migrar', papel;
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO ebisu_app, ebisu_auth;

-- ebisu_app: todas as tabelas de negócio (todas têm RLS), exceto as globais de auth.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ebisu_app;
REVOKE ALL ON usuario, refresh_token, permissao FROM ebisu_app;
-- Histórico de migrações do Prisma (sem RLS): nenhum papel da aplicação o acessa.
-- Ausente no shadow database do `prisma migrate dev`, daí a guarda.
DO $$
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON _prisma_migrations FROM ebisu_app, ebisu_auth;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION app_tenant_id() TO ebisu_app, ebisu_auth;

-- ebisu_auth: tabelas globais de autenticação
GRANT SELECT, INSERT, UPDATE, DELETE ON usuario, refresh_token TO ebisu_auth;
GRANT SELECT ON permissao TO ebisu_auth;

-- ebisu_auth: leitura de vínculos entre tenants no login (políticas permissivas
-- somam-se à tenant_isolamento; para os demais papéis nada muda).
GRANT SELECT ON membro, tenant, empresa TO ebisu_auth;
CREATE POLICY auth_leitura ON membro  FOR SELECT TO ebisu_auth USING (true);
CREATE POLICY auth_leitura ON tenant  FOR SELECT TO ebisu_auth USING (true);
CREATE POLICY auth_leitura ON empresa FOR SELECT TO ebisu_auth USING (true);
