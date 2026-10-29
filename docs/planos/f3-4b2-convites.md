# F3 · PR 4b-2: convites, outbox de e-mail e aceite

STATUS: APPROVED (usuário, 2026-10-29)

Segunda metade do antigo PR 4b (usuário, 2026-10-28). Quem administra a conta convida uma pessoa
por e-mail, já com os papéis dela; a pessoa abre o link, entra (ou cria o acesso) e vira membro.
O e-mail sai por um outbox mínimo, enviado pelo worker por SMTP (Mailpit em dev). O provedor de
verdade (Resend) e as filas (BullMQ) ficam para a F10.

## Objetivo

- Convidar, listar, reenviar e revogar convites pela API da conta.
- Aceitar o convite pelo link: cria o usuário, confere a senha do usuário existente ou assume o
  e-mail não verificado (decisão 10 do PR 4a), e devolve a sessão já na conta que convidou.
- O worker envia os e-mails do outbox, com nova tentativa em caso de falha.

## Fora deste PR

- Provedor Resend, BullMQ, modelos de e-mail editáveis e webhooks de entrega (F10).
- Telas do web (convidar e aceitar): PR de web depois deste. O link aponta para a rota do web
  que essa tela vai ter.
- Recuperação de senha por e-mail: não está na spec do MVP.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas da conta** (`@PermissaoNaConta('config.membros')`): <ul><li>`POST /v1/membros/convites` (`{ email, atribuicoes }`, idempotente);</li><li>`GET /v1/membros/convites` (pendentes, paginado);</li><li>`POST /v1/membros/convites/{id}/reenviar`;</li><li>`DELETE /v1/membros/convites/{id}` (revoga, 204).</li></ul> Convidar com papéis é dar papéis: além de `config.membros`, exige `config.rbac` (403). Convidar como dono (OWNER) exige ser dono, como no PR 4b-1 | §5.3, PR 4b-1 |
| 2 | **O convite** vale 7 dias e uma vez só. Guarda o e-mail normalizado e as atribuições pedidas (validadas como no `PUT` de atribuições). E-mail que já é membro da conta: 409 `duplicado`. Convite pendente para o mesmo e-mail: 409 `duplicado` com `id_existente` (use reenviar) | segurança |
| 3 | **Token:** 32 bytes aleatórios (base64url) no link, só o hash SHA-256 no banco. O token é gerado pelo worker na hora do envio e o hash é gravado no convite; nenhum token fica guardado em claro. Reenviar gera um token novo e o anterior deixa de valer. O link vai no fragmento (`{WEB_URL}/convite#token=...`), que o navegador não manda a servidores nem a logs | segurança |
| 4 | **Outbox mínimo** (`email_saida`, só para e-mails do sistema): o convite e a linha do outbox nascem na mesma transação. A linha guarda o tipo (`CONVITE`) e o id do convite, nunca o conteúdo nem o token | usuário, 2026-10-28 |
| 5 | **Worker:** a cada poucos segundos, reivindica linhas pendentes de todas as contas com `FOR UPDATE SKIP LOCKED`, por uma função `SECURITY DEFINER` que devolve só `(id, tenant_id)` e põe um prazo de 5 minutos. Para cada linha, abre uma transação da conta (`comTenant`, `ebisu_app`), gera o token, grava o hash e monta o e-mail; envia por SMTP fora da transação; marca enviado. Falha: nova tentativa com espera crescente, até 5; depois, `FALHOU`. Se o worker cair no meio, o prazo vence e outro reenvia (com token novo) | §4 F10 |
| 6 | **Aceite público** (`@Publica`, só JSON, limite por IP): <ul><li>`POST /v1/auth/convites/consultar { token }`: conta, e-mail e o que a tela deve pedir (nome e senha nova, ou a senha atual);</li><li>`POST /v1/auth/convites/aceitar { token, nome?, senha }`: devolve a sessão (201, cookie), aberta na conta que convidou.</li></ul> Token inválido, vencido, usado ou revogado: 410 `link_invalido` | §5.3 |
| 7 | **Quem aceita:** <ul><li>e-mail sem usuário: cria o usuário com a senha (política do PR 4a) e o nome, já verificado;</li><li>usuário verificado: exige a senha dele (401 se errada), como escolheu o usuário;</li><li>usuário não verificado: define a senha nova, encerra todas as sessões dele e o marca verificado (decisão 10 do PR 4a);</li><li>usuário inativo: 401.</li></ul> | usuário, 2026-10-28 |
| 8 | **No aceite**, o convite é revalidado: se a pessoa já virou membro, 409 `duplicado`; se um papel ou empresa sumiu ou foi desativada, 409 `transicao_invalida` (peça outro convite). O membro nasce `ATIVO` com as atribuições do convite, e o convite fica marcado como aceito. O autor no audit log é o novo membro | PR 4b-1 |
| 9 | **Papéis de banco:** o `ebisu_auth` ganha leitura de `convite` de todas as contas (como já lê `membro`, `tenant` e `empresa` no login), para achar o convite pelo hash do token. O resto do aceite é como o cadastro: usuário pelo `ebisu_auth`, membro pelo `ebisu_app` | SEG-6, PR 4a |
| 10 | **Auditoria:** `convite` entra no trigger do audit log. `email_saida` é técnica e fica de fora, como `notificacao` | PR 3b |

## Estrutura

- **Migração:** tabelas `convite` e `email_saida` (RLS por conta), política de leitura do
  `ebisu_auth` em `convite`, função `reivindicar_email_saida(limite, prazo)`, trigger de
  auditoria.
- **Contratos:** `plataforma/convites.ts` (`EntradaConvite`, `Convite`, `ListaConvites`,
  `EntradaTokenConvite`, `ConsultaConvite`, `EntradaAceite`).
- **API:**
  - `modules/membros`: comandos e rotas dos convites;
  - `modules/auth`: consulta e aceite (`convites.service.ts`).
- **Worker:** `@ebisu/db`, `nodemailer`, configuração (`DATABASE_URL_APP`, `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_REMETENTE`, `WEB_URL`), laço de envio com encerramento limpo.
- **Documentação:** README (convites, worker e Mailpit) e `.env.example`.

## Testes

- **Convites (API):** criar com papéis; sem `config.rbac`, 403; OWNER por não dono, 403; e-mail
  já membro ou convite pendente, 409; listar, reenviar, revogar; outra conta, 404; idempotência do
  POST; a linha do outbox nasce junto e não guarda o token.
- **Aceite (API):** os quatro casos da decisão 7; token errado, vencido, usado, revogado ou
  substituído por reenvio: 410; papel removido antes do aceite: 409; a sessão abre na conta
  certa; as sessões antigas do usuário não verificado caem; o `/v1/eu` mostra os papéis do
  convite; limite por IP.
- **Worker (Testcontainers + Mailpit ou SMTP falso):** envia o e-mail com o link e o token que
  aceita o convite; duas instâncias não enviam a mesma linha; falha de SMTP agenda nova tentativa e
  para em `FALHOU`; prazo vencido é reivindicado de novo.
- **Banco:** `ebisu_app` não lê `email_saida` de outra conta; a função só devolve ids; o
  `ebisu_auth` só lê `convite`, não escreve.
- **Sabotagens:** token em claro no outbox; aceite sem conferir a senha do usuário verificado;
  aceite sem encerrar as sessões do não verificado; convite com papéis sem `config.rbac`; reuso do
  token; sem `SKIP LOCKED`.

## Rollout e rollback

- Migração aditiva, com os grants dela. Depois do merge: `pnpm db:migrate`.
- Variáveis novas do worker: `WEB_URL` (base do link) e `SMTP_REMETENTE`. Em dev, o Mailpit do
  docker compose recebe os e-mails (`http://localhost:8025`).
- Rollback: reverter o PR e remover as tabelas e a função. Convites pendentes se perdem.

## Revisão

Duas trilhas independentes, corretude e segurança: rota pública de auth, token de convite,
papéis de banco novos e função `SECURITY DEFINER`.
