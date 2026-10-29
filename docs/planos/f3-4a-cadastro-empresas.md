# F3 · PR 4a: cadastro de conta e empresas

STATUS: APPROVED (usuário, 2026-10-28)

O PR 4 da F3 foi dividido em dois (usuário, 2026-10-28): 4a, cadastro e empresas; 4b, membros,
papéis e convites com um outbox mínimo de e-mail. Este é o 4a.

## Objetivo

- **Cadastro:** quem chega pelo `POST /v1/auth/registrar` cria uma conta (tenant) já com a
  primeira empresa e entra como dono (OWNER), com sessão aberta.
- **Empresas:** quem tem `config.empresa` em toda a conta lista, cria, edita e desativa empresas
  pelo `/v1/empresas`.

## Fora deste PR

- Membros, papéis, atribuições e convites (PR 4b).
- Confirmação de e-mail no cadastro: fica fora do MVP (usuário, 2026-10-28).
- Telas do web (cadastro e configurações de empresas): entram num PR de web depois do 4b.
- API keys (PR 5).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Cadastro sem confirmação de e-mail:** a resposta já é a sessão (`RespostaSessao`, 201, cookie de refresh), como no login | usuário, 2026-10-28 |
| 2 | **Corpo:** `{ nome, email, senha, conta: { nome }, empresa: { razao_social, nome_fantasia, cnpj? } }`. E-mail normalizado (trim + minúsculas). Só JSON, como no login | §5.3, PR 1 |
| 3 | **Política de senha:** 12 a 128 caracteres; recusa as senhas de uma lista local de senhas vazadas comuns com 12 ou mais caracteres e recusa senha que contenha o e-mail ou o nome. A lista sai da SecLists (licença MIT): as senhas de 12 a 128 caracteres do `xato-net-10-million-passwords-1000000.txt`, num arquivo versionado. Erro 422 `validacao` no campo `senha`, sem dizer qual regra falhou além de "senha fraca" | usuário (decisão da F3), OWASP ASVS 2.1 |
| 4 | **E-mail já cadastrado:** o mesmo usuário pode ter várias contas. Se o e-mail existe, o cadastro só cria a conta nova se a senha conferir com a do usuário (argon2id); senão, 401 `nao_autenticado`, como no login. Isso revela, com rate limit, que o e-mail existe: é inevitável sem confirmação de e-mail, e fica registrado | segurança × decisão 1 |
| 5 | **Rate limit:** por IP (5 por hora) e por e-mail (5 por hora), como no login; estouro dá 429 com `Retry-After` | §7 |
| 6 | **Ordem e papéis de banco:** o usuário é gravado pelo `ebisu_auth` e a conta pelo `ebisu_app`, em duas transações. Se a segunda falha, sobra um usuário sem conta, que não entra (o login dá 401). Repetir o cadastro com a mesma senha cai na decisão 4 e conclui | SEG-6 |
| 7 | **A conta nasce** em TRIAL, com slug derivado do nome (sufixo numérico se houver colisão), os padrões da conta e da empresa (`semearPadroesTenant`, `semearPadroesEmpresa`) e o membro OWNER com atribuição em todas as empresas (`empresa_id` nulo). Tudo numa transação do `ebisu_app` com o tenant novo no contexto. O autor da auditoria é o próprio membro | seeds da F1, PR 3b |
| 8 | **Rotas da conta, sem empresa:** o CRUD de empresas usa uma marca nova, `@PermissaoNaConta('config.empresa')`. Ela não pede `X-Empresa-Id` e exige a permissão com escopo TENANT numa atribuição de todas as empresas (`empresa_id` nulo). É o decorator previsto no PR 2 (decisão 5). Os POST dela também são idempotentes, com a empresa nula no hash | PR 2, PR 3a |
| 9 | **CRUD de empresas:** <ul><li>`GET` lista e `GET /{id}` lê;</li><li>`POST` cria e semeia os padrões da empresa;</li><li>`PATCH` edita;</li><li>`DELETE` desativa (`ativo = false`, 204).</li></ul> Não dá para desativar a última empresa ativa (409 `transicao_invalida`). O CNPJ, quando vem, passa pela validação dos dígitos verificadores (422 se inválido) e não pode se repetir na conta (409 `duplicado`, com `id_existente`) | §5.1 |

## Estrutura

- `packages/contracts/src/plataforma`:
  - `auth.ts`: `EntradaRegistro` e a rota `registrar`;
  - `empresas.ts` (novo): `Empresa`, `EntradaEmpresa`, `EdicaoEmpresa` e a lista;
  - o validador de CNPJ fica em `comum/`.
- `apps/api/src/modules/auth`:
  - `politica-senha.ts` e `senhas-vazadas.txt`;
  - `registro.service.ts`;
  - a rota no `auth.controller.ts`.
- `apps/api/src/core/rbac`: a marca `@PermissaoNaConta`, que o guard resolve.
- `apps/api/src/modules/empresas`: controller, serviço e repositório; registro no `app.module.ts`.
- OpenAPI regenerado. Documentação: README da API (rotas da conta) e spec §5.3, se precisar.

## Testes

- **Cadastro:**
  - cria conta, empresa, padrões, OWNER e sessão;
  - o `/v1/eu` mostra a empresa com todas as permissões;
  - e-mail com maiúsculas e espaços é normalizado;
  - e-mail existente com a senha certa cria uma segunda conta; com a senha errada dá 401;
  - senha curta, longa, vazada, com o e-mail ou com o nome dá 422;
  - rate limit dá 429;
  - corpo que não é JSON dá 422;
  - slug repetido ganha sufixo;
  - a auditoria registra a criação com o autor certo.
- **Empresas:**
  - CRUD completo;
  - desativar a última empresa dá 409 `transicao_invalida`;
  - CNPJ inválido dá 422 e CNPJ repetido dá 409 `duplicado`;
  - sem `config.empresa` com TENANT dá 403;
  - membro com `config.empresa` só numa empresa (escopo EMPRESA) dá 403;
  - empresa de outra conta dá 404;
  - POST repetido com a mesma `Idempotency-Key` devolve a mesma empresa;
  - a empresa nova já tem os padrões (funil, origens, motivos de perda).
- **Sabotagens:**
  - sem a lista de senhas vazadas;
  - sem a checagem de senha do e-mail existente;
  - sem o escopo TENANT na marca da conta;
  - sem a trava da última empresa;
  - sem o rate limit.

## Rollout e rollback

- Sem migração. O arquivo da lista de senhas vazadas é versionado e tem algumas centenas de KB.
- Rollback: reverter o PR. As contas criadas continuam válidas.

## Revisão

Duas trilhas independentes, corretude e segurança: é auth pública (cadastro) e RBAC novo (marca
da conta).
