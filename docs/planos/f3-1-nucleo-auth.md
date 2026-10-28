# F3 · PR 1: núcleo de autenticação

STATUS: APPROVED (usuário, 2026-10-28)

Primeiro dos 6 PRs da F3 (spec §4 F3). Implementa na API o contrato de auth que o web já usa
pela API simulada (`packages/contracts/src/plataforma`, PR #15).

## Objetivo

Login, refresh rotativo com detecção de reuso, troca de conta, logout e `GET /v1/eu` funcionando
contra o banco real, com os papéis `ebisu_auth` (auth) e `ebisu_app` (dados sob RLS).

## Fora deste PR

- Guard de `TxContext`, `X-Empresa-Id` e `@Permissao` nas rotas de domínio (PR 2).
- Idempotência e audit log (PR 3). As rotas de auth **ignoram** a `Idempotency-Key`: um
  cache de idempotência nunca pode devolver um token antigo.
- Cadastro de conta, convites e CRUD de empresas e membros (PR 4).
- API keys e CORS (PR 5).
- Troca da simulação pela API real no web (depois do PR 2).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | JWT EdDSA (Ed25519) com `jose`; chave privada PEM em `AUTH_JWT_CHAVE_PRIVADA`, `kid` em `AUTH_JWT_KID`; claims `sub` (usuário), `tid` (tenant), `mid` (membro), `exp` 15 min | usuário, 2026-10-28 |
| 2 | Senha com argon2id (`@node-rs/argon2`, parâmetros OWASP: m=19 MiB, t=2, p=1) | D-T05 |
| 3 | Refresh token: 32 bytes aleatórios, guardado só como hash SHA-256; rotação a cada uso; reuso de um token já rotacionado revoga a família inteira | D-T05, spec F3 |
| 4 | Cookie do refresh: `__Host-ebisu_refresh`, `HttpOnly; Secure; SameSite=Strict; Path=/`. Prefixo `__Host-` exige `Path=/`, `Secure` e nenhum `Domain`. Em dev (http://localhost) o navegador aceita `Secure`. Validade de 30 dias | §5.1, revisão do #15 |
| 5 | A sessão pertence a uma conta: migração **aditiva** põe `tenant_id` em `refresh_token`; a família mantém a conta; a "conta usada por último" vem da família mais recente do usuário | revisão do #15 |
| 6 | E-mail normalizado (`trim` + minúsculas) no login; migração cria índice único em `lower(email)` | revisão do #15 |
| 7 | Rate limit do login no Redis (já no compose), janela fixa por IP e por e-mail; estouro dá 429 `limite_excedido` com `Retry-After` | §7, revisão do #15 |
| 8 | Erro único `nao_autenticado` (401), com hash argon2id fictício quando o e-mail não existe, para e-mail inexistente, senha errada e usuário sem conta ativa | revisão do #15 |
| 9 | CSRF em refresh, logout e trocar-conta: confere `Origin` contra `WEB_ORIGENS` (sem Origin, recusa) e só por POST. O `Content-Type` não é exigido: o cliente web não manda corpo em refresh e logout, e Origin + `SameSite=Strict` já fecham o CSRF | revisão do #15; ajustado na implementação |
| 10 | Refresh revalida usuário ativo e membro `ATIVO` na conta da família; se falhar, 401 e revoga a família | revisão final do #15 |
| 11 | `GET /v1/eu`: permissões efetivas por empresa = união dos papéis da empresa e dos papéis "todas as empresas" (`empresa_id` nulo), com o maior escopo (TENANT > EMPRESA > PROPRIO) | contrato `RespostaEu` |
| 12 | Política de senha (mín. 12, máx. 128, lista local de senhas comuns) entra com o cadastro, no PR 4. Neste PR, o login só aceita a senha | usuário, 2026-10-28 |

## Estrutura

- `packages/db`:
  - migração aditiva (`refresh_token.tenant_id` + índice; índice único em `lower(usuario.email)`);
  - exporta o helper de banco de teste (`@ebisu/db/teste`) para a API.
- `apps/api/src/core/config`: env validado com Zod; falha na subida se faltar segredo.
- `apps/api/src/core/banco`: dois clientes Prisma, `ebisu_auth` e `ebisu_app` (este só via `comTenant`).
- `apps/api/src/modules/auth`: serviço de senha, tokens e sessões; controller das 4 rotas; guard
  Bearer mínimo para `trocar-conta` e `/v1/eu` (o guard completo é do PR 2).
- `apps/api/src/modules/eu`: `GET /v1/eu`.
- OpenAPI regenerado com as rotas novas.

## Testes (Vitest + Supertest + Testcontainers, D-T07)

- **Contrato:** toda resposta validada pelos schemas de `@ebisu/contracts` (o interceptor já faz isso).
- **Login:**
  - sucesso;
  - e-mail com maiúsculas e espaços;
  - e-mail inexistente e senha errada, com a mesma resposta e o mesmo código;
  - usuário sem conta ativa;
  - 422;
  - rate limit, que dá 429 com `Retry-After`.
- **Cookie:** atributos exatos e ausência de `refresh_token` no corpo.
- **Refresh:**
  - rotação;
  - reuso do token antigo, que revoga a família (o token novo também para de valer);
  - conta mantida;
  - membro desativado;
  - token expirado;
  - CSRF (sem JSON, `Origin` estranho).
- **Troca de conta:**
  - conta do usuário;
  - conta alheia, que dá 404;
  - família anterior revogada.
- **Logout:** revoga a família; repetido dá 401.
- **`/v1/eu`:**
  - permissões efetivas por empresa (casos de união e de maior escopo);
  - sem empresas;
  - token de outro tenant não vê nada (RLS).
- **Sabotagens** em cada guarda de segurança.

## Rollout e rollback

- **Migrações:** são aditivas. `tenant_id` é nulo para linhas antigas (não há refresh tokens reais
  ainda); rollback = migração reversa que derruba a coluna e o índice.
- **Segredos novos** no `.env.example` com valores de dev, e um script `pnpm auth:chaves` que gera o
  par Ed25519 local. Nenhum segredo versionado.
- **Web:** continua na simulação até o PR 2; nada muda para quem usa `pnpm dev`.

## Revisão

Duas trilhas independentes: corretude e segurança (auth, segredos e RLS são nível XL).
