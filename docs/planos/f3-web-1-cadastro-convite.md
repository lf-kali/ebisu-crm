# F3 · Web 1: cadastro, aceite do convite e Playwright

STATUS: APPROVED (usuário, 2026-10-31)

As telas web da F3 foram divididas em dois PRs (usuário, 2026-10-31): este, com a entrada pública
(cadastro e aceite do convite); o próximo, com Configurações (empresas, membros e papéis, convites,
API keys). O Playwright entra neste PR (usuário, 2026-10-31), com o caminho feliz de ponta a ponta
contra a API real, como pede o "pronto quando" da F13.

## Objetivo

- Uma conta nova nasce pela UI: `/cadastro` cria a conta, a primeira empresa e o dono, e já entra.
- Quem recebe o convite por e-mail abre o link, cria o acesso (ou confirma a senha) e cai na conta
  que convidou.
- `pnpm e2e` roda o caminho "cadastrar → convidar → aceitar pelo link do e-mail" contra API, worker
  e web reais, localmente e no CI.

## Fora deste PR

- Telas de Configurações (próximo PR). Neste, o E2E convida pela API.
- Recuperação de senha: não está na spec do MVP.
- Confirmação de e-mail no cadastro: fora do MVP (PR 4a, decisão 1).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **`/cadastro`** (tela de entrada, fora do AppShell), com o formulário do `EntradaRegistro`: seu nome, e-mail, senha, nome da conta, razão social, nome fantasia e CNPJ opcional. Agrupado em "Você" e "Sua empresa". A senha mostra a regra antes do envio (12 a 128 caracteres, sem conter nome ou e-mail, não pode ser comum). Links "Criar conta" no login e "Já tenho conta" no cadastro | PR 4a, DESIGN.md |
| 2 | **Respostas do cadastro:** 201 abre a sessão e vai para o Painel; 422 de senha fraca vai para o campo senha ("Senha fraca: …"); 401 (e-mail já cadastrado com outra senha) mostra "Este e-mail já tem cadastro. Use a senha dele para criar outra conta, ou entre." com link para o login; 429 mostra quando tentar de novo (`Retry-After`); o resto pelo `ErroDaApi` | PR 4a, decisões 4 e 5 |
| 3 | **`/convite#token=…`**: a tela lê o token do fragmento e o tira da barra de endereço na hora (`history.replaceState`), para não ficar no histórico, em captura de tela nem no `Referer`. Recarregar a página depois disso mostra "Abra de novo o link do e-mail". O token fica só em memória | PR 4b-2, decisão 3 |
| 4 | **Consulta e formulário pela `acao`:** `CRIAR_ACESSO` pede nome e senha nova (com a regra); `SENHA_ATUAL` pede a senha que a pessoa já usa; `NOVA_SENHA` pede senha nova e avisa que as outras sessões desse e-mail serão encerradas. Mostra a conta e o e-mail do convite. 410 vira "Este convite não vale mais (vencido, usado ou cancelado). Peça um novo a quem convidou."; 409 `duplicado`, "Você já é membro desta conta" com link para entrar | PR 4b-2, decisões 6 e 7 |
| 5 | **Sessão:** `criarSessao` ganha `registrar` e `aceitarConvite`, pelo mesmo caminho do `entrar` (nova geração, cache limpo e empresa esquecida antes, como no login), para uma sessão anterior na mesma aba não vazar para a nova | F12 |
| 6 | **API simulada (MSW)** ganha cadastro, consulta e aceite, para os testes de componente e para o `VITE_API_SIMULADA` | F12 |
| 7 | **Playwright** num pacote próprio (`apps/e2e`): <ul><li>sobe API e worker compilados e o web (`vite preview` com o proxy de `/v1`) em portas próprias (API 3101, web 5181), sem colidir com o `pnpm dev`;</li><li>usa um banco só dele (`ebisu_e2e`, recriado e migrado a cada rodada, com o catálogo de permissões) no Postgres do docker compose, e o Redis no banco lógico 15, esvaziado no início (os limites de cadastro não acumulam entre rodadas);</li><li>lê o e-mail do convite pela API do Mailpit;</li><li>Chromium só, no MVP.</li></ul> | usuário, 2026-10-31; spec §4 F13 |
| 8 | **CI:** job `e2e` com o docker compose (Postgres, Redis, Mailpit), `pnpm build`, os navegadores do Playwright em cache e o relatório como artefato quando falha | §4 F0 |

## Estrutura

- `apps/web/src/routes/cadastro.tsx` e `apps/web/src/routes/convite.tsx`.
- `apps/web/src/auth/sessao.ts`: `registrar`, `aceitarConvite`.
- `apps/web/src/simulacao/`: os handlers novos.
- `apps/e2e/`: `playwright.config.ts`, `preparar.ts` (banco e Redis), `mailpit.ts`,
  `testes/entrada.spec.ts`.
- `.github/workflows/ci.yml`: job `e2e`. README da raiz: `pnpm e2e`.

## Testes

- **Componente (Vitest + MSW + axe):** cadastro com sucesso entra no Painel; senha fraca no campo;
  e-mail existente com senha errada mostra a mensagem com link; 429 com o tempo; convite com cada
  `acao`; o token some da URL ao abrir; link vencido (410); já membro (409); recarregar sem token;
  axe sem violações nas duas telas.
- **Sessão (unidade):** `registrar` e `aceitarConvite` trocam a geração (um refresh atrasado não
  reinstala a sessão anterior).
- **E2E:** cadastrar pela UI → Painel com a empresa; convidar pela API; o worker manda o e-mail ao
  Mailpit; abrir o link → criar acesso → Painel da conta que convidou; o link usado de novo mostra
  "não vale mais".
- **Acessibilidade:** Lighthouse ≥ 90 nas duas telas (DESIGN.md), medido e anotado.

## Rollout e rollback

- Sem migração. Dependência nova: `@playwright/test` (só no `apps/e2e`). Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: telas de autenticação pública, o token do
convite no navegador e a sessão.
