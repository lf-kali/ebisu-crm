# F3 · PR 4b-1: membros e papéis

STATUS: APPROVED (usuário, 2026-10-28)

O PR 4b da F3 foi dividido em dois (usuário, 2026-10-28): 4b-1, membros e papéis; 4b-2, convites
com o outbox mínimo de e-mail e o worker. Este é o 4b-1. Sem migração.

## Objetivo

Quem administra a conta vê os membros, edita o cargo, suspende e reativa, e define em quais
empresas cada membro tem cada papel. Só um dono (OWNER) mexe no papel de dono, e a conta nunca
fica sem um dono ativo.

## Fora deste PR

- Convites, outbox de e-mail, worker e aceite do convite (PR 4b-2). Até lá, membro novo só entra
  pelo cadastro (o dono) ou pelo seed.
- Editor de papéis (criar papel, mudar permissões): P1, como no schema. Aqui só se listam os
  papéis padrão.
- Tela do web (configurações de membros): PR de web depois do 4b-2.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas da conta** (`@PermissaoNaConta`, do PR 4a): membros e papéis valem para a conta inteira. Ler e editar membros pede `config.membros`; listar papéis e trocar atribuições pede `config.rbac`. As duas em escopo TENANT, num papel atribuído a todas as empresas | §5.3, PR 4a |
| 2 | **Rotas:** <ul><li>`GET /v1/membros` (paginada por id) e `GET /v1/membros/{id}`: usuário (nome, e-mail), status, cargo e atribuições (papel e empresa, ou todas);</li><li>`PATCH /v1/membros/{id}`: `cargo` e `status` (`ATIVO` ou `SUSPENSO`);</li><li>`PUT /v1/membros/{id}/atribuicoes`: troca o conjunto inteiro de atribuições (`[{ papel_id, empresa_id \| null }]`, ao menos uma, sem repetição);</li><li>`GET /v1/papeis`: papéis da conta com as permissões e o escopo de cada uma.</li></ul> | §5.3 |
| 3 | **Só um dono mexe no dono:** dar ou tirar o papel OWNER, e suspender ou reativar um membro que é OWNER, exige que quem faz seja OWNER (atribuição de todas as empresas). Senão, 403 `sem_permissao`. Um ADMIN não se promove a dono | usuário, 2026-10-28 |
| 4 | **Sempre um dono ativo:** tirar o OWNER do último dono ativo, ou suspender o último dono ativo, dá 409 `transicao_invalida`. As duas operações travam os donos da conta (advisory lock da transação) para duas mudanças simultâneas não deixarem a conta sem dono | segurança |
| 5 | **OWNER só em todas as empresas:** atribuição de OWNER com `empresa_id` dá 422 | coerência do papel |
| 6 | **Ninguém suspende a si mesmo** (409 `transicao_invalida`): evita que alguém se tranque fora sem querer | UX, segurança |
| 7 | **Referências:** papel e empresa precisam ser da conta (senão 422, sem revelar se existem em outra conta, como o `comReferencias`). Empresa inativa também dá 422 | SEG-2 |
| 8 | **Efeito da suspensão:** nada novo a fazer. O guard já recusa o membro suspenso em toda requisição (401), e o refresh não renova sessão sem vínculo ativo. O teste prova os dois | PR 1, PR 2 |
| 9 | **Auditoria:** `membro` e `atribuicao_papel` já estão no trigger do audit log (PR 3b). O `PUT` apaga e recria as atribuições que mudaram, e as que não mudaram ficam como estão | PR 3b |

## Estrutura

- `packages/contracts/src/plataforma/membros.ts` (novo): `Membro`, `ListaMembros`, `EdicaoMembro`,
  `EntradaAtribuicoes`, `Papel`, `ListaPapeis` e as rotas.
- `apps/api/src/modules/membros`: controller, comandos e repositório (membros e papéis no mesmo
  módulo); registro no `app.module.ts`.
- OpenAPI regenerado. README da API: regra do dono.

## Testes

- **Membros:** lista paginada e leitura; edição do cargo; suspender e reativar; o membro suspenso
  leva 401 na próxima requisição e no refresh; ninguém suspende a si mesmo.
- **Atribuições:** troca o conjunto; a próxima requisição do membro já usa as permissões novas
  (`/v1/eu`); papel ou empresa de outra conta, empresa inativa, lista vazia ou repetida dão 422;
  OWNER numa empresa só dá 422.
- **Dono:** ADMIN não dá nem tira OWNER, nem suspende um dono (403); dono dá OWNER a outro membro;
  o último dono não perde o OWNER nem é suspenso (409); com dois donos, um tira o OWNER do outro;
  remoção concorrente (outra transação segurando a trava dos donos) não deixa a conta sem dono.
- **Acesso:** sem `config.membros` ou sem `config.rbac` dá 403; escopo EMPRESA ou papel de uma
  empresa só dá 403; membro de outra conta dá 404.
- **Papéis:** lista os papéis padrão com permissões e escopos.
- **Sabotagens:** sem a regra do dono; sem a checagem do último dono; sem a trava; sem a
  checagem de autossuspensão; sem validar a empresa da atribuição.

## Rollout e rollback

- Sem migração e sem segredo novo. Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: é autorização (quem dá papel a quem).
