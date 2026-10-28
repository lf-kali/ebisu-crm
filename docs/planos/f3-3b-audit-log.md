# F3 · PR 3b: audit log automático

STATUS: APPROVED (usuário, 2026-10-28)

Segunda metade do antigo PR 3 da F3 (usuário, 2026-10-28). Entrega o audit log automático nos
comandos (spec §4 F3, SEG-8). O mecanismo é um trigger no banco, escolha do usuário em 2026-10-28.

## Objetivo

Toda criação, alteração ou exclusão nas tabelas de negócio grava uma linha em `audit_log`. A
linha leva o autor (membro ou API key), o `request_id`, o IP e os **nomes** das colunas
alteradas, nunca os valores (SEG-8). Isso vale para qualquer escrita: Prisma, `updateMany` ou SQL
manual, sem nada no código do comando.

## Fora deste PR

- Endpoint de leitura do audit log, que entra com uma tela de configurações.
- `acao` `bulk_*` para lotes. Quando os lotes existirem (F4), o comando informa a ação pelo
  contexto da transação, do mesmo jeito que o autor. Neste PR, cada linha do lote vira um
  create, update ou delete.
- Auditoria de `tenant` (suspensão e cancelamento da conta): fica para o PR de cadastro e operação
  de contas.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | Uma função genérica `auditar()` com trigger `AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW` nas tabelas de negócio (lista na decisão 6) | usuário, 2026-10-28 |
| 2 | **SEG-8, só nomes.** `diff = {"campos": [...]}` com os nomes das colunas: no INSERT, as colunas não nulas; no UPDATE, as que mudaram (sem `updated_at`); no DELETE, `null`. Um UPDATE que não muda nada não grava linha | SEG-8 |
| 3 | **Ação** (enum do schema): INSERT vira `create` e DELETE vira `delete`. No UPDATE: `deleted_at` preenchido (soft delete) vira `delete`; `anonimizado_em` preenchido vira `anonimizar`; mudança em `status` vira `status_change`; o resto vira `update` | schema `audit_log.acao` |
| 4 | **Autor e requisição** vêm do contexto da transação: `app.membro_id`, `app.api_key_id`, `app.request_id` e `app.ip`, definidos com `set_config(..., true)` só por `comTenant` (`packages/db/src/tenancy.ts`), como o tenant. O `executarComando` passa esses dados, e o guard põe o IP (`req.ip`) no contexto. Sem contexto (seed, job, manutenção), o autor fica nulo | spec §5.4, SEG-6 |
| 5 | **Tenant e empresa da linha:** o tenant é o `tenant_id` da própria linha; nas tabelas filhas, sem essa coluna, é o `app.tenant_id` da transação. A empresa é o `empresa_id` da linha, quando existe. Se não há tenant (escrita privilegiada, sem contexto, numa tabela filha), não se grava auditoria: a aplicação nunca escreve assim, porque o RLS impede | SEG-1 |
| 6 | **Tabelas de fora** (lista fechada; uma tabela nova precisa entrar no trigger ou nesta lista, senão um teste falha). São de três tipos: <ul><li>globais e de autenticação: `tenant`, `usuario`, `refresh_token`, `permissao`;</li><li>técnicas: `audit_log`, `idempotencia_requisicao`, `sequencia_documento`, `notificacao`, `job_lote`;</li><li>registros append-only que já gravam o membro (`membro_id`): `historico_etapa_negocio`, `orcamento_status_historico`, `os_status_historico`, `dispositivo_evento`, `movimento_estoque`, `pagamento`.</li></ul> `consentimento` é append-only, mas não grava o autor, por isso entra no audit | escolha de escopo |
| 7 | **Id da entidade:** é a coluna `id`. Em `papel_permissao`, que não tem `id`, é o `papel_id`; o trigger recebe o nome da coluna como argumento | schema |
| 8 | `audit_log` continua append-only (trigger `bloquear_alteracao` da F1) e sob o RLS. O trigger roda com o papel de quem escreve (`SECURITY INVOKER`), então o `ebisu_app` só grava auditoria da própria conta | SEG-1, SEG-6 |

## Estrutura

- `packages/db/prisma/migrations/<data>_audit_log/migration.sql`: função `auditar()` e triggers nas
  tabelas da decisão 1.
- `packages/db/src/tenancy.ts`: `comTenant` aceita `ator?: { membroId, apiKeyId, requestId, ip }`
  e define os `app.*` na mesma transação, junto do tenant.
- `apps/api`:
  - `ContextoDaRequisicao` ganha `ip`, preenchido pelo guard;
  - o `executarComando` passa o autor para o `comTenant`.
- Documentação:
  - spec §5.4 (o audit é do banco);
  - `docs/invariantes.md` (SEG-8: onde é garantido);
  - README da API.

## Testes

- **`packages/db` (Testcontainers):**
  - insert, update, soft delete, delete, `status` e `anonimizado_em` geram a ação certa, com os
    nomes certos;
  - UPDATE sem mudança não gera linha;
  - nenhum valor gravado aparece no `diff` (procura o e-mail, o nome e o telefone no JSON);
  - autor e `request_id` vêm do `comTenant`, e ficam nulos sem `ator`;
  - tabela filha sem `tenant_id` usa o tenant da transação;
  - `papel_permissao` usa o `papel_id`;
  - um tenant não grava nem lê auditoria de outro;
  - toda tabela do schema está no trigger ou na lista de fora.
- **`apps/api`:** um POST e um PATCH do controller de teste geram auditoria com membro,
  `request_id` (o mesmo do cabeçalho `X-Request-Id`), IP e campos. Uma repetição idempotente não
  gera auditoria nova.
- **Sabotagens:**
  - gravar valores no `diff`;
  - tirar o autor;
  - não excluir o `updated_at`;
  - tirar o trigger de uma tabela;
  - trocar o tenant da linha pelo do contexto.

## Rollout e rollback

- **Migração:** aditiva (função e triggers). Rollback é uma migração que remove os triggers e a
  função; o `audit_log` já gravado fica.
- **Custo:** um INSERT a mais por linha escrita. Em operações em lote, uma linha de auditoria por
  linha alterada. Fica para medir no teste de carga (§6.3).
- **Depois do merge:** `pnpm db:migrate`.

## Revisão

Duas trilhas independentes: corretude e segurança (RLS, SEG-8 e migração).
