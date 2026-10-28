# F3 · PR 3a: idempotência

STATUS: APPROVED (usuário, 2026-10-28)

O PR 3 da F3 foi dividido em dois (usuário, 2026-10-28): 3a, idempotência; 3b, audit log. Com
isso, a F3 passa a ter 7 PRs. Este entrega a `Idempotency-Key` (spec §5.1, D-A07, SEG-7) dentro
do `executarComando`.

## Objetivo

Repetir um POST de domínio com a mesma `Idempotency-Key` devolve a mesma resposta e não duplica
efeitos. Mandar a mesma chave com outro pedido dá 422 `idempotencia_divergente`. Mandar a mesma
chave enquanto a primeira requisição ainda roda dá 409 `idempotencia_em_andamento`.

## Fora deste PR

- Audit log (PR 3b).
- Job `idempotencia.limpar` (spec §5.6): o worker ainda não tem filas (infra da F10, onda 3).
  Até lá, uma chave vencida é apagada quando alguém a reutiliza. Fica como pendência.
- API keys (PR 5): a regra vale do mesmo jeito para elas, com `apiKeyId` no lugar do membro.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Onde vale:** todo POST com `@Permissao` exige `Idempotency-Key`, sem marca extra. Fica fechado por padrão: um POST novo já nasce idempotente. As rotas de auth (`@Publica`, `@SoAutenticado`) ignoram o cabeçalho, como no PR 1 | §5.1, D-A07 |
| 2 | **Formato:** a chave é um UUID (§5.1). Ausente ou inválida: 422 `validacao` com `campo: "Idempotency-Key"` | §5.1 |
| 3 | **Concorrência:** trava não bloqueante por (conta, chave), `pg_try_advisory_xact_lock`. Se outra requisição com a mesma chave está rodando, a resposta é 409 `idempotencia_em_andamento` na hora | usuário, 2026-10-28 |
| 4 | **Mesma transação:** o resultado do comando é gravado na mesma transação dos efeitos (`status = CONCLUIDA`). Efeito e resposta salva nunca se separam. Se a API cair no meio, tudo volta e não sobra linha presa. O estado `EM_PROCESSAMENTO` do schema não é usado | usuário, 2026-10-28 |
| 5 | **Só sucesso é memorizado.** Se o comando falha, a transação desfaz tudo e não grava nada, então repetir a chave executa de novo (ex.: depois de corrigir um 422 de regra) | consequência da 4 |
| 6 | **O que define "o mesmo pedido":** o hash SHA-256 de método, rota (o molde, ex.: `/v1/contatos/:id/...`), parâmetros de rota, empresa (`X-Empresa-Id`), autor (membro ou API key) e corpo em JSON canônico (chaves ordenadas). Se qualquer um muda, a resposta é 422 `idempotencia_divergente`. Incluir o autor impede que outra pessoa da conta, com a mesma chave, leia a resposta de alguém | §5.1, segurança |
| 7 | **A resposta salva** é a saída do comando em JSON. A primeira resposta também passa por esse mesmo JSON, então primeira e repetição saem byte a byte iguais e as duas passam pela validação do contrato. Em rota 204, a resposta salva é `null`. O status HTTP vem do `@Contrato` da rota, e `status_http` fica nulo | §5.1 |
| 8 | **Validade de 24 h** (`expira_em`). Uma chave vencida reaproveitada é apagada e o pedido roda como novo | §5.1 |
| 9 | **Isolamento:** a tabela tem `tenant_id` e já está sob o RLS. A mesma chave em outra conta é outra chave | SEG-1 |
| 10 | **OpenAPI:** o POST de domínio mostra o cabeçalho `Idempotency-Key` obrigatório e a resposta 409 | §5.1 |

## Estrutura

- `apps/api/src/core/idempotencia/idempotencia.ts`:
  - lê e valida o cabeçalho;
  - calcula o hash do pedido (decisão 6);
  - grava e relê a resposta.
- `core/rbac/guarda-contexto.ts`: nos POST com `@Permissao`, põe `idempotencia: { chave, hash }` no
  `ContextoDaRequisicao`.
- `core/tx/executar.ts`: quando o contexto traz `idempotencia`, o `executarComando` segue esta ordem
  dentro da transação:
  1. trava a chave;
  2. procura a resposta salva e a devolve (ou dá 422);
  3. se não achar, roda o comando e grava o resultado.
- `core/openapi/gerar-documento.ts`: cabeçalho e 409 (decisão 10).
- Documentação:
  - spec §5.4 (opção `idempotencia` do `executarComando`, EM_PROCESSAMENTO sem uso);
  - README da API.

## Testes (Vitest + Supertest + Testcontainers)

Sobre o controller de contatos de teste da suíte de isolamento (`test/isolamento`):

- **Repetição:**
  - mesmo corpo e mesma chave: mesma resposta (status e corpo) e só um contato criado;
  - PATCH e DELETE ignoram o cabeçalho, porque a regra é só de POST (decisão 1).
- **Divergência:** mesma chave com outro corpo, outra empresa, outro membro ou outra rota dá 422
  `idempotencia_divergente`, e nada é criado.
- **Em andamento:** outra conexão segura a trava da chave e a requisição leva 409. É determinístico,
  sem corrida de tempo.
- **Falha não é memorizada:** um POST que falha (ex.: 422 de FK) e é repetido depois com dado
  válido, mesma chave, executa.
- **Cabeçalho:** ausente ou não-UUID dá 422. As rotas de auth continuam sem exigir.
- **Validade:** com `expira_em` no passado, a chave roda como nova.
- **Contas:** a mesma chave em duas contas cria um registro em cada uma.
- **OpenAPI:** o POST de domínio mostra o cabeçalho e o 409.
- **Sabotagens:** sem a trava, sem a checagem do hash, sem o autor no hash, gravando fora da
  transação, sem a validade.

## Rollout e rollback

- Sem migração e sem segredo novo: a tabela `idempotencia_requisicao` já existe desde a F1.
- O web já manda `Idempotency-Key` em todo POST (`apps/web/src/api/cliente.ts`) e mantém a chave
  na repetição depois do refresh.
- Rollback: reverter o PR. As linhas gravadas vencem sozinhas em 24 h.

## Revisão

Duas trilhas independentes: corretude e segurança. A idempotência é guarda de integridade dos
comandos, e o hash por autor é uma fronteira de acesso.
