# F4 · Web 1: tela de contatos (lista, ficha, formulário e consentimentos)

STATUS: APPROVED (usuário, 2026-11-01)

Primeira tela intercalada da F4 (usuário, 2026-11-01): a parte da F13-CRM que a API do PR 1 já
entrega. Com este PR, o atendente cadastra, busca, edita e exclui contatos e registra
consentimentos pela UI, e o E2E passa a cobrir o CRUD de contatos.

## Objetivo

- Em `/contatos`, quem tem `contato.read`:
  - busca por nome, e-mail ou telefone e filtra por origem, responsável e ciclo de vida;
  - abre a ficha do contato, com os dados e os consentimentos.
- Quem tem `contato.create`, `contato.update` ou `contato.delete` cria, edita, exclui e registra
  consentimentos. Todas as regras continuam na API; a tela esconde o que a pessoa não pode e
  mostra o 409 de duplicado com o caminho para o contato que já existe.
- A API ganha uma rota leve com os responsáveis possíveis, para quem não administra membros
  (usuário, 2026-11-01).

## Fora deste PR

- Administração de origens, motivos de perda e etapas: numa seção "CRM" de Configurações, no PR
  da tela do funil (usuário, 2026-11-01). Aqui as origens só aparecem para escolher.
- Score, temperatura, quadrante, "o que falta" e motivos do score: chegam com F11 e o PR 2.
  A ficha mostra só o ciclo de vida.
- Painel do CRM, quadro de negócios e importação CSV (PRs seguintes da F4).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas:** <ul><li>`/contatos`: lista;</li><li>`/contatos/novo`: formulário de criação;</li><li>`/contatos/$id`: ficha;</li><li>`/contatos/$id/editar`: o mesmo formulário, preenchido.</li></ul> A busca e os filtros ficam na URL (`?q=&origem=&responsavel=&ciclo=`), validados pelo roteador: dá para voltar, recarregar e compartilhar a lista filtrada | spec §4 F13-CRM |
| 2 | **Lista:** tabela paginada por cursor com nome, e-mail, telefone (WhatsApp quando não houver telefone), origem, responsável e ciclo de vida. A busca espera 300 ms depois da digitação e só consulta com 2 caracteres ou mais (o mínimo do contrato). Origem e responsável aparecem pelo nome, a partir das listas de opções | API PR 1, decisão 1 |
| 3 | **Formulário:** tipo de pessoa, nome, documento (CPF ou CNPJ conforme o tipo), e-mail, telefone, WhatsApp, canal preferido, data de nascimento, endereço, origem, responsável e observações. Valida com o contrato antes de enviar; campo vazio não vai no `POST` e vira `null` no `PATCH` (remove o valor). Os erros 422 da API caem no campo certo | API PR 1, decisões 2 e 4 |
| 4 | **Duplicado (409):** a mensagem fica no campo que repetiu ("Já existe um contato com este e-mail"). Quando a API devolve `id_existente`, aparece o link "Abrir contato existente"; sem ele (escopo PROPRIO e contato de outra pessoa), só a mensagem | CRM-1, API PR 1 |
| 5 | **Responsável:** select com os responsáveis possíveis da decisão 6, mais "Sem responsável". Quem só tem `contato.create` como PROPRIO não vê o select: a API grava a própria pessoa | SEG-4, API PR 1 |
| 6 | **Rota nova `GET /v1/membros/opcoes`** (domínio, com `X-Empresa-Id`) e `contato.read`: devolve só `id` e `nome` dos membros ativos com acesso à empresa atual (atribuição na empresa ou em todas), em ordem de nome, sem paginação (limite de 500). Não traz e-mail, cargo nem papéis. Fica declarada antes de `/v1/membros/:id`. Entra na matriz de isolamento | usuário, 2026-11-01 |
| 7 | **Ficha:** cabeçalho com nome, tipo e ciclo de vida; dados de contato (telefones formatados), endereço, origem, responsável e observações; botões Editar e Excluir (este com confirmação, soft delete) conforme a permissão | spec §4 F13-CRM |
| 8 | **Consentimentos na ficha:** a situação atual por canal e finalidade (concedido, revogado ou sem registro) e o histórico abaixo. "Registrar consentimento" abre um diálogo com canal, finalidade, conceder ou revogar e base legal; a evidência vai como `{ origem: 'tela' }`. Nada é editado nem apagado, como na API | LGPD, API PR 1, decisão 6 |
| 9 | **Telefone na tela:** E.164 do Brasil aparece como `(11) 98765-4321`; de outro país, como veio (`+351 912345678`). Uma função pequena no web, sem trazer a biblioteca de telefone para o navegador | implementação |
| 10 | **API simulada (MSW):** ganha contatos, consentimentos, origens e as opções de responsável, com as regras que a tela mostra (dedupe com `id_existente`, busca sem acento, filtros, PROPRIO) | F12 |
| 11 | **E2E:** o dono cria um contato, tenta criar outro com o mesmo telefone e segue o link para o existente, acha o contato buscando o nome sem acento, edita, registra um consentimento e exclui | spec §4 F13 |
| 12 | **Pendência do PR 1:** teste de API de que o `PATCH` do nome regrava `nome_busca` (a busca acha pelo nome novo e não pelo antigo) | revisão do PR 1 |

## Estrutura

- **API:** rota de opções em `apps/api/src/modules/membros/` (controller, serviço, repositório),
  contrato `OpcoesResponsavel` em `packages/contracts`, OpenAPI regenerado e README.
- **Web:** `apps/web/src/routes/_app/contatos/` (`index.tsx`, `novo.tsx`, `$id/index.tsx`,
  `$id/editar.tsx`) e `apps/web/src/contatos/` (consultas, formulário, diálogo de consentimento,
  formatação de telefone e documento).
- **Simulação:** `apps/web/src/simulacao/contatos-simulada.ts`.
- **E2E:** `apps/e2e/testes/contatos.spec.ts`.
- DESIGN.md: telas de contatos.

## Testes

- **API:** opções de responsável (só ativos com acesso à empresa; sem e-mail; PROPRIO também
  vê; sem `contato.read` dá 403); a rota na matriz de isolamento; `nome_busca` no `PATCH`.
- **Componente (Vitest + MSW + axe), por tela:**
  - caminho feliz;
  - estados vazio, carregando e erro;
  - tela oculta sem `contato.read`; botões ocultos sem a permissão de escrita;
  - busca com espera e mínimo de 2 caracteres; filtros na URL;
  - 409 com e sem `id_existente`; 422 no campo; `null` no `PATCH` ao esvaziar um campo;
  - PROPRIO sem o select de responsável;
  - consentimento: conceder, revogar e situação atualizada;
  - nenhuma violação do axe.
- **Unidade:** formatação de telefone (BR fixo, BR celular, outro país).
- **E2E:** a jornada da decisão 11.
- **Acessibilidade:** Lighthouse ≥ 90 na lista, na ficha e no formulário, anotado no DESIGN.md.

## Rollout e rollback

- Sem migração e sem variável nova. Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: a rota nova expõe nomes de membros (RBAC e
dados pessoais) e as telas mostram e editam dados pessoais de contatos.
