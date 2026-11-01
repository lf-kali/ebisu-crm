# F4 · PR 2a: funil, negócios, tarefas e completude

STATUS: APPROVED (usuário, 2026-11-01)

O PR 2 da F4 foi dividido em dois (usuário, 2026-11-01):

- **2a (este):** funil, negócios, tarefas e completude. O mover depende das tarefas e da
  completude, então os três andam juntos.
- **2b:** atividades (a timeline).

Depois do 2a vem a tela do quadro de negócios, junto com a seção "CRM" de Configurações (funil,
origens e motivos).

## Objetivo

- Ler e editar o funil da empresa: nomes, ordem, probabilidade, SLA, cor e requisitos das etapas.
- CRUD de negócios e os comandos `MoverNegocio`, `PerderNegocio` e nutrir.
  - O negócio só avança com os requisitos obrigatórios da etapa atual atendidos (CRM-3).
  - Perder exige motivo (CRM-4).
- CRUD de tarefas e `POST /{id}/concluir`. Ao entrar numa etapa, o negócio ganha as tarefas dos
  requisitos do tipo TAREFA.
- Completude do negócio e do contato, e `campos_faltantes` do contato, calculados a partir dos
  requisitos.

## Fora deste PR

- **Atividades:** ficam para o PR 2b.
- **Ganho:** só pela conversão do orçamento, na F6 (usuário, 2026-11-01).
- **Ciclo de vida além de LEAD_QUALIFICADO:** oportunidade, cliente e recorrente vêm na F6 e na F7.
- **Do scoring, na F11:** scores, temperatura, quadrante, próximas ações e eventos de domínio
  (`negocio.movido`).
- **Captura de lead (PR 3):** cria o negócio na etapa 1 quando houver interesse.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas do funil:** <ul><li>`GET /v1/funil` traz o funil padrão da empresa, com as etapas em ordem e os requisitos. A permissão é `negocio.read`, porque o quadro e a ficha precisam das etapas.</li><li>`PATCH /v1/funil` exige `config.crm`.</li></ul> | spec §5.3, CRM-5 |
| 2 | **Editar o funil:** o corpo traz todas as etapas existentes, pelo id. <ul><li>Cada etapa pode mudar nome, ordem, probabilidade (0 a 100), SLA, cor e a lista de requisitos, que é trocada inteira. Requisito sem id é novo.</li><li>Etapas não são criadas nem apagadas no MVP (a spec fala em "editar nomes/ordem/requisitos").</li><li>As etapas de tipo GANHO, PERDIDO e NUTRICAO continuam uma de cada e ficam depois das ABERTA.</li><li>Requisito CAMPO só aceita chaves de uma lista fechada (`contato.nome`, `contato.email`, `contato.canal_preferido`, `negocio.tipo_dispositivo`, `negocio.descricao_problema` etc.). REGRA só aceita as regras que o código implementa. TAREFA exige `titulo_tarefa`.</li><li>Chave fora da lista dá 422 no campo.</li><li>Salvar recalcula a completude dos negócios abertos e dos contatos da empresa, na mesma transação.</li></ul> | spec §4 F4, CRM-6 |
| 3 | **Rotas de negócio:** <ul><li>`GET /v1/negocios`: paginada, com `filtro[etapa_id]`, `filtro[status]`, `filtro[responsavel_id]`, `filtro[contato_id]` e `?q=` no título.</li><li>`GET /{id}`: traz `requisitos` da etapa atual, cada um com `atendido` (o "o que falta").</li><li>`POST` com `negocio.create`, `PATCH /{id}` com `negocio.update` e `versao_registro`, `DELETE /{id}` (soft delete) com `negocio.delete`.</li><li>Escopo PROPRIO pelo `responsavel_id`, como nos contatos.</li></ul> | spec §5.3, D-A08 |
| 4 | **Criar negócio:** <ul><li>Campos: `contato_id` (contato visível e não excluído), `titulo`, `interesse`, `tipo_dispositivo`, `descricao_problema`, `urgencia`, `valor_estimado`, `previsao_fechamento` e `responsavel_id` (mesma regra do contato: PROPRIO grava a si mesmo).</li><li>O negócio nasce na primeira etapa ABERTA do funil padrão, com as tarefas dela.</li><li>Etapa, status, completude e `fechado_em` só aparecem na resposta.</li></ul> | CRM-6 |
| 5 | **Mover (`POST /{id}/mover`, `negocio.update`):** o corpo é `{ etapa_id, versao_registro }`. <ul><li>O destino precisa ser uma etapa ABERTA do mesmo funil. GANHO dá 409 `transicao_invalida` até a F6; PERDIDO e NUTRICAO têm rotas próprias.</li><li>Avançar (ordem maior) exige os requisitos obrigatórios da etapa atual atendidos. Senão, 409 `requisitos_pendentes` com a lista. Voltar não exige.</li><li>Negócio em NUTRICAO volta para ABERTO ao ser movido para uma etapa ABERTA, sem a checagem. PERDIDO não reabre no MVP (409).</li><li>Efeitos: grava `historico_etapa_negocio` (com os segundos na etapa), `entrou_etapa_em` e incrementa `versao_registro`.</li><li>Cria as tarefas dos requisitos TAREFA da nova etapa, sem duplicar uma tarefa do mesmo requisito que já esteja pendente ou concluída, e recalcula a completude.</li></ul> | CRM-3, D-A08, invariantes §3.2 |
| 6 | **Ciclo de vida (CRM-2):** quando o negócio avança da etapa de qualificação, o contato LEAD passa a LEAD_QUALIFICADO. A etapa de qualificação é a segunda etapa ABERTA por ordem: o nome é editável, a posição é o que a define. Os demais passos ficam na F6 e na F7 (usuário, 2026-11-01) | CRM-2 |
| 7 | **Perder (`POST /{id}/perder`):** o corpo é `{ motivo_perda_id, versao_registro }`. <ul><li>O motivo precisa estar ativo na empresa.</li><li>O negócio fica PERDIDO, vai para a etapa PERDIDO e ganha `fechado_em`.</li><li>As tarefas pendentes e em andamento do negócio são canceladas.</li><li>Fica registrado no histórico.</li></ul> | CRM-4, invariantes §3.2 |
| 8 | **Nutrir (`POST /{id}/nutrir`):** o corpo é `{ nba_adiada_ate, versao_registro }`, com a data de reativação no futuro. <ul><li>O negócio fica NUTRICAO e vai para a etapa Nutrição.</li><li>As tarefas de requisito pendentes são canceladas; as manuais continuam.</li><li>Reativar é o mover da decisão 5.</li></ul> | spec §5.3 |
| 9 | **Tarefas:** <ul><li>`GET /v1/tarefas`: em ordem de vencimento, com `filtro[status]`, `filtro[responsavel_id]`, `filtro[negocio_id]`, `filtro[contato_id]` e `filtro[vence_ate]`.</li><li>`GET /{id}`, `POST` e `PATCH` com título, descrição, prioridade, `vence_em`, responsável e status (PENDENTE ou EM_ANDAMENTO).</li><li>`POST /{id}/concluir` grava CONCLUIDA e `concluida_em`. Uma tarefa de requisito concluída recalcula a completude do negócio.</li><li>`DELETE /{id}` cancela (CANCELADA, 204); a tarefa não some.</li><li>Tarefa concluída ou cancelada não muda mais (409 `transicao_invalida`).</li><li>Escopo PROPRIO pelo `responsavel_id`. Tarefa ligada a negócio ou contato exige vê-lo.</li></ul> | spec §5.3 |
| 10 | **Completude, um único escritor (CRM-6):** o serviço de completude é o único que grava `negocio.completude`, `contato.completude_perfil` e `contato.campos_faltantes`; a F11 o estende com os scores. <ul><li>No negócio: a fração dos requisitos da etapa atual atendidos (100 sem requisitos).</li><li>No contato: a fração dos requisitos sobre o contato (CAMPO `contato.*` e as regras de contato) nas etapas ABERTA do funil padrão. `campos_faltantes` lista as chaves não atendidas.</li><li>Recalcula quando o contato, os consentimentos, o negócio ou o funil mudam, ou quando uma tarefa de requisito é concluída.</li></ul> | CRM-6, D-P12 |
| 11 | **Regras (REGRA) com o que já existe:** <ul><li>`contato_tem_meio_contato`, `contato_tem_origem`, `consentimento_transacional` (no canal preferido, a situação mais recente concedida).</li><li>`dispositivo_ou_orcamento_remoto`: por ora só o dispositivo, porque o orçamento remoto chega na F6.</li><li>`orcamento_revisado` (opcional no seed): não atendido até a F6.</li><li>Uma regra desconhecida conta como não atendida.</li></ul> | invariantes §3.2 |
| 12 | **Isolamento:** `/v1/negocios` e `/v1/tarefas` entram na matriz `testarIsolamento`; o funil, num teste próprio (cada empresa vê e edita só o seu) | F3 PR 6 |

## Estrutura

- **Contratos** `packages/contracts/src/crm/`: `funil.ts`, `negocios.ts`, `tarefas.ts`.
- **API** `apps/api/src/modules/`:
  - `funil/`, `negocios/` e `tarefas/`, cada um com controller, comandos e repositório;
  - `completude/` (regras e o serviço), chamado pelos comandos de contato, consentimento,
    negócio, tarefa e funil.
- **Sem migração:** as tabelas, os CHECKs de CRM-4, o índice de CRM-5 e as políticas de RLS já
  existem.
- OpenAPI regenerado e README da API (funil, CRM-3 e completude).

## Testes

- **Funil:** lê o padrão; edita nomes, ordem e requisitos; recusa chave desconhecida, etapa
  faltando ou fora de ordem; `config.crm` para editar; a completude é recalculada depois da edição.
- **Negócios:** CRUD; PROPRIO; `versao_registro` desatualizado dá 409; contato de outra empresa ou
  excluído dá 422.
- **Mover:**
  - avançar sem requisito dá 409 com a lista; com os requisitos atendidos, avança;
  - voltar não exige requisitos;
  - Ganho dá 409;
  - histórico e tarefas criados, sem duplicar ao voltar e avançar de novo;
  - o contato vira LEAD_QUALIFICADO ao sair da qualificação.
- **Perder e nutrir:** motivo obrigatório e ativo; `fechado_em`; tarefas canceladas; reativar
  pela nutrição.
- **Tarefas:** CRUD; concluir recalcula a completude; concluída ou cancelada não muda; PROPRIO.
- **Completude:** valores do negócio e do contato e `campos_faltantes` em cada mudança.
- **Isolamento:** a matriz nos dois recursos; o funil por empresa.
- **Sabotagens:**
  - avançar ignorando os requisitos;
  - tarefa duplicada ao reentrar na etapa;
  - perder sem cancelar as tarefas;
  - completude gravada fora do serviço;
  - mover sem conferir a versão.

## Rollout e rollback

- Sem migração e sem variável nova. Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: as rotas novas aplicam RBAC e escopo PROPRIO,
e a edição do funil muda regras que valem para a empresa inteira.
