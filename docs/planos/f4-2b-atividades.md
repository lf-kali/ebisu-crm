# F4 · PR 2b: atividades (a timeline)

STATUS: APPROVED (usuário, 2026-11-03)

Segunda metade do PR 2 da F4 (usuário, 2026-11-01). Depois dele vem a tela do quadro de negócios,
com a seção "CRM" de Configurações.

## Objetivo

- Registrar as interações com o contato e o negócio: ligação, WhatsApp, e-mail, SMS, visita à
  loja, reunião e nota interna.
- Listar a timeline do contato e do negócio, da mais recente à mais antiga.
- Manter `contato.ultima_interacao_em`, que a F11 usa no engajamento e no INATIVO (CRM-2).

## Fora deste PR

- **Nota técnica da bancada** (`NOTA_TECNICA`, ligada à OS): fica para a F7.
- **Atividades geradas pelo sistema** (`SISTEMA`, `FORMULARIO`): nascem na captura (PR 3) e nas
  automações. Aqui elas só aparecem na lista e não podem ser editadas.
- **Timeline unificada com o histórico de etapas e os orçamentos:** vem nas telas (F13).
- **Engajamento e scores:** ficam para a F11.

## Decisões

| #   | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Origem                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **Rotas** (domínio, com `X-Empresa-Id`): <ul><li>`GET /v1/atividades`, paginada da mais recente à mais antiga (`ocorreu_em`, desempate pelo id), com `filtro[contato_id]`, `filtro[negocio_id]` e `filtro[tipo]`, e `GET /{id}`, ambas com `atividade.read`;</li><li>`POST`, com `atividade.create`;</li><li>`PATCH /{id}`, com `atividade.update`;</li><li>`DELETE /{id}`, com `atividade.delete`.</li></ul> Escopo PROPRIO pelo autor (`membro_id`). API key não entra                                                                                                                           | spec §5.3, SEG-4        |
| 2   | **Registrar:** <ul><li>`tipo` é um de LIGACAO, WHATSAPP, EMAIL, SMS, VISITA_LOJA, REUNIAO ou NOTA;</li><li>`direcao` é ENTRADA ou SAIDA, obrigatória fora da nota; a nota é sempre INTERNA;</li><li>`assunto`, `conteudo` e `resultado` (ex.: "não atendeu") são opcionais;</li><li>`ocorreu_em` vale agora por padrão e pode ser no passado (registrar a ligação de ontem), mas não mais de 5 minutos no futuro (422);</li><li>o autor é quem age.</li></ul>                                                                                                                                      | schema                  |
| 3   | **Vínculo:** <ul><li>`contato_id`, `negocio_id` ou os dois, ao menos um (422).</li><li>Só com o negócio, o contato é o dele. Com os dois, precisam combinar.</li><li>O contato precisa estar visível em `contato.read` e o negócio em `negocio.read`, como nas tarefas.</li></ul>                                                                                                                                                                                                                                                                                                                  | F4 PR 2a, decisão 9     |
| 4   | **Corrigir (usuário, 2026-11-01):** <ul><li>Com PROPRIO em `atividade.update` ou `atividade.delete`, o autor edita ou apaga a própria atividade nas primeiras 24 horas depois de registrá-la. Depois disso, 409 `transicao_invalida`.</li><li>Com EMPRESA ou TENANT, corrige qualquer uma, a qualquer tempo.</li><li>`PATCH` muda `assunto`, `conteudo`, `resultado`, `direcao` e `ocorreu_em`; tipo e vínculo não mudam.</li><li>Atividades SISTEMA e FORMULARIO nunca mudam (409).</li><li>O audit log registra a correção (quem, quando e as colunas mudadas, sem os valores, SEG-8).</li></ul> | usuário                 |
| 5   | **Quando foi registrada:** o prazo de 24 horas conta do registro, não de `ocorreu_em`, que pode ser no passado. A tabela ganha a coluna `registrada_em` (padrão `now()`), numa migração aditiva                                                                                                                                                                                                                                                                                                                                                                                                    | implementação           |
| 6   | **Última interação:** <ul><li>Uma atividade com direção ENTRADA ou SAIDA leva `contato.ultima_interacao_em` para a maior `ocorreu_em` das interações do contato. A nota interna não conta.</li><li>Editar ou apagar recalcula esse valor, na mesma transação.</li></ul>                                                                                                                                                                                                                                                                                                                            | CRM-2, invariantes §3.1 |
| 7   | **Isolamento:** `/v1/atividades` entra na matriz `testarIsolamento`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | F3 PR 6                 |

## Estrutura

- **Migração:** `registrada_em` em `atividade`, preenchida com `ocorreu_em` nas linhas que já
  existem.
- **Contrato** `packages/contracts/src/crm/atividades.ts`.
- **API** `apps/api/src/modules/atividades/` (controller, comandos e repositório).
- OpenAPI regenerado e README da API.

## Testes

- **Registrar:**
  - os tipos aceitos;
  - SISTEMA, FORMULARIO e NOTA_TECNICA recusados;
  - direção obrigatória fora da nota;
  - a nota fica INTERNA;
  - `ocorreu_em` no futuro dá 422;
  - sem vínculo dá 422;
  - contato e negócio que não combinam dão 422;
  - contato ou negócio invisível para o PROPRIO dá 422.
- **Timeline:** ordem por `ocorreu_em` com paginação e desempate; filtros por contato, negócio e
  tipo.
- **Corrigir:**
  - o autor PROPRIO edita e apaga dentro das 24 horas, e recebe 409 depois (prazo simulado pela
    coluna);
  - não mexe na atividade de outra pessoa (404);
  - EMPRESA corrige depois do prazo;
  - SISTEMA nunca muda.
- **Última interação:** sobe com a interação, ignora a nota, e volta ao valor anterior ao apagar ou
  editar a data.
- **Isolamento:** a matriz no recurso.
- **Sabotagens:**
  - prazo de 24 horas ignorado;
  - a nota conta como interação;
  - PROPRIO vê a atividade de outra pessoa;
  - apagar sem recalcular a última interação.

## Rollout e rollback

- Migração aditiva (`registrada_em`). Depois do merge: `pnpm db:migrate`. Rollback: reverter o PR
  e remover a coluna.

## Revisão

Duas trilhas independentes, corretude e segurança: a rota nova aplica RBAC e escopo PROPRIO, e a
timeline guarda dados pessoais das conversas com o contato.
