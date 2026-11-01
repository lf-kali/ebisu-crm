# F3 · Web 2: Configurações (empresas, membros e papéis, convites, API keys)

STATUS: APPROVED (usuário, 2026-11-01)

Segunda metade das telas web da F3 (usuário, 2026-10-31). É a parte da F13-CFG que a F3 já
entrega na API: empresas, membros e papéis, convites e API keys. Funil e requisitos ficam para a
F4; modelos de mensagem, para a F10. Com este PR, o dono administra a conta inteira pela UI, e o
E2E passa a convidar pela tela em vez de pela API.

## Objetivo

- Em `/configuracoes`, quem tem as permissões de configuração:
  - lista, cria, edita e desativa empresas;
  - vê os membros, edita o cargo, suspende ou reativa e troca os papéis de cada um;
  - convida, reenvia e revoga convites;
  - cria, edita e revoga API keys.
- Todas as regras de negócio continuam na API. A tela esconde o que a pessoa não pode e mostra os
  erros 403, 409, 422 e 429 com a mensagem certa.

## Fora deste PR

- Editor de papéis (criar papel, mudar permissões): é P1 na API.
- Funil, origens, motivos de perda (F4) e modelos de mensagem (F10).
- Uma rota real que use a API key: a primeira é a captura de lead da F4.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas:** <ul><li>`/configuracoes`: índice com um cartão por seção, só as que a pessoa pode ver;</li><li>`/configuracoes/empresas`;</li><li>`/configuracoes/membros`: membros e, logo abaixo, os convites pendentes;</li><li>`/configuracoes/membros/$id`: cargo, status e papéis;</li><li>`/configuracoes/api-keys`: chaves da empresa atual.</li></ul> | spec §4 F13-CFG |
| 2 | **Quem vê o quê:** empresas pedem `config.empresa`; membros e convites, `config.membros`; editar papéis, `config.rbac`; API keys, `config.api_keys`. As três primeiras são da conta, então a seção só aparece com escopo TENANT na empresa atual. O item "Configurações" do menu aparece com qualquer uma delas. Se a API ainda assim negar (por exemplo, TENANT só numa empresa), a tela mostra "Sem acesso" | API F3 (PRs 4a, 4b, 5) |
| 3 | **Empresas:** tabela com nome fantasia, razão social, CNPJ formatado e situação. Criar e editar num diálogo com o formulário do contrato. Desativar pede confirmação. A última empresa ativa (409) e o CNPJ repetido (409 `duplicado`, no campo) têm mensagem própria. Criar ou desativar uma empresa atualiza o `/v1/eu` (seletor de empresa) | PR 4a, decisão 9 |
| 4 | **Membros:** tabela com nome, e-mail, cargo, papéis e situação. A página do membro edita o cargo, suspende ou reativa (com confirmação; a pessoa não vê o botão para si mesma) e troca os papéis por um editor de linhas "papel × empresa (ou todas)". O papel Dono só aparece com "todas as empresas". As regras do dono vêm da API e aparecem com a mensagem dela: 403 "só um dono…", 409 "a conta precisa de um dono ativo" | PR 4b-1, decisões 3 a 6 |
| 5 | **Convites:** "Convidar" abre um diálogo com o e-mail e o mesmo editor de papéis. A lista de pendentes mostra o e-mail, os papéis, o vencimento e a situação do envio, com reenviar e revogar (este com confirmação). O 409 `duplicado` mostra "já é membro" ou "já tem convite pendente (reenvie)". O 429 diz quando tentar de novo | PR 4b-2, decisões 1, 2 e 11 |
| 6 | **API keys:** tabela com nome, tipo, prefixo, escopos, último uso e situação (ativa, vencida ou revogada). <ul><li>Criar, num diálogo: tipo (servidor ou site), nome, expiração opcional; para servidor, os escopos são caixas de seleção só com o que a pessoa pode dar (catálogo sem `config.*`, com EMPRESA ou TENANT na empresa atual); para site, as origens, uma por linha.</li><li>Depois de criar, o token aparece uma vez num diálogo próprio, com "Copiar" e o aviso de que não será mostrado de novo. Fechar o diálogo descarta o token da memória.</li><li>Editar o nome, os escopos ou as origens; revogar com confirmação.</li></ul> | PR 5, decisões 2, 5 e 6 |
| 7 | **Componentes novos no `packages/ui`:** `dialog` e `alert-dialog` (shadcn, sobre o Radix que o pacote já usa), com o foco opaco que o teste de contraste exige. Listas de opção são `<select>` nativo estilizado e as caixas são `<input type="checkbox">`: acessíveis sem trabalho extra e simples de testar. O DESIGN.md registra os dois componentes e o editor de papéis | DESIGN.md |
| 8 | **API simulada (MSW):** ganha empresas, membros, papéis, convites e API keys, com as regras que as telas precisam exibir (dono, última empresa, duplicados, token só na criação) | F12 |
| 9 | **E2E:** o dono convida pela tela de membros (não mais pela API). Um cenário novo cria uma chave de servidor, vê o token uma única vez e a revoga | spec §4 F13 |

## Estrutura

- `packages/ui/src/components/ui/dialog.tsx` e `alert-dialog.tsx`.
- `apps/web/src/routes/_app/configuracoes/`: `index.tsx`, `empresas.tsx`, `membros/index.tsx`,
  `membros/$id.tsx`, `api-keys.tsx`.
- `apps/web/src/configuracoes/`: consultas (TanStack Query), o editor de papéis, os formulários
  dos diálogos e o diálogo do token.
- `apps/web/src/layout/navegacao.ts`: o item Configurações com a regra da decisão 2.
- `apps/web/src/simulacao/`: os handlers novos, num arquivo próprio.
- `apps/e2e/testes/`: convite pela tela e o cenário de API key.
- DESIGN.md: componentes novos e telas de Configurações.

## Testes

- **Componente (Vitest + MSW + axe), por tela:**
  - caminho feliz;
  - estados vazio, carregando e erro;
  - seção oculta sem a permissão;
  - mensagens de 403, 409, 422 e 429;
  - nenhuma violação do axe.
- **Casos específicos:**
  - o papel Dono só com "todas as empresas";
  - sem botão de suspender a si mesmo;
  - o token só no diálogo da criação e fora do cache depois de fechado;
  - os escopos oferecidos excluem `config.*` e o que a pessoa só tem como PROPRIO;
  - criar ou desativar empresa atualiza o seletor.
- **E2E:** cadastro → convidar pela tela → aceitar pelo link; criar API key → token uma vez →
  revogar.
- **Acessibilidade:** Lighthouse ≥ 90 nas quatro telas, medido e anotado no DESIGN.md.

## Rollout e rollback

- Sem migração e sem variável nova. Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: as telas administram papéis (RBAC) e mostram o
token da API key.
