# F3 · PR 2: contexto por requisição, empresa e permissões

STATUS: APPROVED (usuário, 2026-10-28)

Segundo dos 6 PRs da F3 (spec §4 F3). Entrega o `TxContext` (spec §5.4), a validação de
`X-Empresa-Id` (SEG-3), o `@Permissao` com escopo (SEG-4) e a base da suíte de isolamento. Ainda
não existe rota de domínio: o PR prova tudo com um controller que só existe nos testes. As frentes
de domínio (F4 em diante) só plugam suas rotas nessa base.

## Objetivo

Toda rota da API declara se é pública, só autenticada ou de domínio. Quando é de domínio, ela
recebe um contexto já validado: tenant, empresa, membro e permissões. Os dados só são acessados
por `executarComando`, que abre a transação com o tenant definido.

## Fora deste PR

- Idempotência, audit log e despacho de eventos dentro do `executarComando` (PR 3).
- API keys (PR 5): o campo `apiKeyId` existe no contexto, mas fica sempre `null` neste PR.
- Rotas que cruzam empresas (relatório consolidado). Entram depois, com um decorator próprio que
  exige o escopo TENANT.
- Troca da API simulada pela real no web: vira um PR próprio logo depois deste.
- Rate limit em refresh, troca de conta e logout, CORS e trust proxy (pendências do PR 1, que vão
  para o PR 5 e para o PR de deploy).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Fechado por padrão.** Um guard global exige que toda rota declare exatamente uma marca: `@Publica()`, `@SoAutenticado()` (token sem empresa: `/v1/eu`, troca de conta) ou `@Permissao('recurso.acao')`. Rota sem marca dá 500 em qualquer chamada e é barrada pelo teste de cobertura | segurança |
| 2 | `@Permissao` aceita só chaves do catálogo (`CATALOGO_PERMISSOES`). Um teste falha se alguma rota usar uma chave fora dele | §3.3 |
| 3 | `X-Empresa-Id` é obrigatório nas rotas com `@Permissao`. Sem o cabeçalho, ou com um valor que não é UUID: 422 `validacao`, com `campo: "X-Empresa-Id"`. Empresa de outro tenant, inativa ou fora das atribuições do membro: 403 `empresa_nao_autorizada`. Falta a permissão: 403 `sem_permissao` | §5.1, §5.2, SEG-3 |
| 4 | **Revalidação em toda requisição autenticada**, sem cache. O usuário precisa estar ativo, o membro `ATIVO` e do mesmo usuário, e a conta `TRIAL` ou `ATIVO`. Se não, 401 `nao_autenticado`, a mesma resposta do login. Um access token emitido antes de uma suspensão para de valer na hora, sem esperar os 15 min | usuário, 2026-10-28 |
| 5 | Escopo TENANT vale o mesmo que EMPRESA neste PR: a rota sempre acessa só a empresa do cabeçalho | usuário, 2026-10-28 |
| 6 | No `TxContext`, `permissoes` vira `ReadonlyMap<chave, escopo>` em vez de `ReadonlySet<string>`. Sem o escopo, o repositório não consegue aplicar o PROPRIO (SEG-4). A spec §5.4 é atualizada neste PR | SEG-4 |
| 7 | O `emitir` sai do `TxContext` até existir o despachante de eventos (`core/eventos`). Um `emitir` que só descarta eventos sumiria com eles em silêncio | §5.5 |
| 8 | O guard valida numa transação curta de leitura. O comando roda noutra, aberta pelo `executarComando`. Se o membro for desativado entre as duas, o comando ainda termina: a janela dura o tempo da requisição, e a próxima já leva 401 | custo × simplicidade |
| 9 | PROPRIO no repositório: `filtroDeEscopo(ctx, chave, campo)` devolve `{ [campo]: membroId }` quando o escopo é PROPRIO e `{}` nos outros casos. Toda consulta de domínio também filtra por `empresa_id: ctx.empresaId` (a FK composta cobre as escritas, SEG-2) | SEG-2, SEG-4 |
| 10 | Lint: fora de `core/tx`, `core/banco`, `modules/auth`, `modules/eu` e dos arquivos `*.repositorio.ts`, nenhum arquivo importa `@ebisu/db`/`@prisma/client` | §7 |
| 11 | O OpenAPI das rotas com `@Permissao` passa a mostrar o cabeçalho `X-Empresa-Id` e as respostas 401, 403 e 422 | §5.1 |

## Estrutura

- `apps/api/src/core/rbac/`:
  - `marcas.ts` com `@Publica`, `@SoAutenticado` e `@Permissao`;
  - `guarda-contexto.ts`, o guard global (`APP_GUARD`): Bearer, revalidação, empresa e permissão;
  - `permissoes.ts` com o cálculo de permissões por empresa, que sai de `modules/eu`, e o
    `filtroDeEscopo`.
- `apps/api/src/core/tx/`:
  - `contexto.ts` com `TxContext` e `Comando`;
  - `executar.ts` com `executarComando(contextoDaRequisicao, comando, entrada)`, sobre `comTenant`;
  - um decorator de parâmetro `@Contexto()` para o controller.
- `modules/auth` e `modules/eu`:
  - trocam o `GuardaBearer` próprio pelas marcas;
  - o `GuardaOrigem` continua nas três rotas de cookie;
  - o `/v1/eu` passa a usar a revalidação do guard (e ganha o bloqueio de conta suspensa).
- `apps/api/test/isolamento/`:
  - `cenario.ts`: duas contas; a conta A tem as empresas A1 e A2; membros de A1, de A2, um
    membro com escopo PROPRIO e um admin de todas as empresas;
  - `contatos-de-teste.controller.ts`, que só existe no teste: listar, ler, criar, editar e
    excluir `contato` via `executarComando`;
  - `isolamento.test.ts`, a matriz da seção Testes, escrita como helper reaproveitável pelas
    frentes de domínio.
- Documentação: spec §5.4 (decisões 6 e 7) e o README da API (como declarar uma rota).

## Testes (Vitest + Supertest + Testcontainers)

- **Marcas:**
  - toda rota do app tem exatamente uma marca;
  - toda chave usada em `@Permissao` existe no catálogo;
  - uma rota sem marca recusa a chamada.
- **Cabeçalho:** ausente, não-UUID, empresa de outra conta, empresa inativa, empresa fora das
  atribuições, e atribuição com `empresa_id` nulo (vale para todas as empresas).
- **Revalidação:** com um token ainda válido, dá 401 quando:
  - o usuário foi desativado;
  - o membro foi suspenso ou removido;
  - a conta foi suspensa ou cancelada (também no `/v1/eu`).
- **Isolamento, membro de A1:**
  - não lê pelo id um contato de A2 nem da conta B (404);
  - não lista A2 (403);
  - a lista de A1 não traz linhas de A2;
  - editar e excluir um contato de A2 pelo id, com o cabeçalho de A1, dá 404 e não altera nada;
  - criar em A1 um contato com referência a um registro de A2 falha (FK composta) e não revela
    se o registro existe.
- **PROPRIO:** só vê e edita os contatos em que é o responsável. Um contato de outro membro na
  mesma empresa dá 404.
- **Sem contexto:** uma consulta fora do `executarComando` não vê nenhuma linha (já coberto em
  `packages/db`; aqui confirmado pelo cliente `ebisu_app` da API).
- **Sabotagens** em cada guarda: tirar o filtro de empresa, a checagem de atribuição, a
  revalidação e o PROPRIO. Cada sabotagem precisa derrubar pelo menos um teste.

## Rollout e rollback

- Não há migração nem segredo novo.
- O web continua na simulação. A troca para a API real vem no PR seguinte.
- Rollback é reverter o PR. Nenhum dado é gravado de um jeito novo.

## Revisão

Duas trilhas independentes, corretude e segurança (auth e RBAC são nível XL).
