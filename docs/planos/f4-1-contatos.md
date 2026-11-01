# F4 · PR 1: contatos, consentimentos, origens e motivos de perda

STATUS: APPROVED (usuário, 2026-11-01)

A F4 (CRM) foi dividida em cinco PRs de API, com as telas intercaladas (usuário, 2026-11-01):

1. contatos, consentimentos, origens e motivos de perda (este);
2. funil, negócios, atividades, tarefas e completude;
3. captura de lead;
4. APIs em massa e CSV;
5. anonimização.

Depois deste PR vem a tela de contatos (F13-CRM).

## Objetivo

- CRUD de contatos por empresa, com dedupe por e-mail, telefone e WhatsApp (CRM-1). E-mail e
  telefone são normalizados, e a busca `?q=` vale por nome, e-mail e telefone.
- Consentimentos LGPD por canal e finalidade, só acrescentados (revogar é um registro novo).
- CRUD de origens de lead e de motivos de perda, que o funil e a captura usam nos próximos PRs.

## Fora deste PR

- Captura de lead (PR 3). A restauração de contato excluído (D-P10) é da captura: o `POST` manual
  não restaura.
- `ciclo_vida`, scores, temperatura, quadrante, completude e `campos_faltantes` (CRM-2, CRM-6).
  Aparecem na resposta, mas não são aceitos na entrada; quem os calcula chega nos PRs 2, F6/F7
  e F11.
- Anonimização (PR 5), lote e CSV (PR 4).

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Rotas de contato** (domínio, com `X-Empresa-Id`): <ul><li>`GET /v1/contatos` (paginada, mais recentes primeiro, com `?q=` e `filtro[origem_id]`, `filtro[responsavel_id]`, `filtro[ciclo_vida]`) e `GET /v1/contatos/{id}`, ambas com `contato.read`;</li><li>`POST`, com `contato.create`;</li><li>`PATCH /{id}`, com `contato.update`;</li><li>`DELETE /{id}` (soft delete, 204), com `contato.delete`.</li></ul> Escopo PROPRIO: só os contatos em que a pessoa é responsável, como na matriz da F3 | spec §5.3, SEG-4 |
| 2 | **Normalização:** <ul><li>e-mail: trim e minúsculas em `email_normalizado`; o `email` guarda o que foi digitado;</li><li>telefone e WhatsApp: E.164 com a biblioteca `libphonenumber-js`, Brasil como país padrão (`(11) 98765-4321` vira `+5511987654321`) e `+DDI` para outros países; número inválido dá 422 no campo.</li></ul> A resposta traz o E.164 | spec §4 F4 |
| 3 | **Dedupe (CRM-1):** e-mail, telefone ou WhatsApp que já existe num contato não excluído da empresa dá 409 `duplicado` com `id_existente` e o campo que repetiu. Vale no `POST` e no `PATCH`. Os índices únicos parciais do banco fecham a corrida entre dois pedidos simultâneos (mesmo 409). Todo contato precisa de ao menos um meio de contato (422, como o CHECK do banco) | CRM-1, spec §5.2 |
| 4 | **Campos aceitos:** `tipo_pessoa`, `nome`, `documento` (CPF para PF e CNPJ para PJ, com dígitos conferidos), `email`, `telefone`, `whatsapp`, `canal_preferido`, `data_nascimento`, `endereco` (`{cep, logradouro, numero, complemento, bairro, cidade, uf}`), `origem_id`, `responsavel_id` e `observacoes`. Os campos derivados ficam só na resposta. `origem_id` precisa ser uma origem ativa da empresa; `responsavel_id`, um membro ativo com acesso à empresa. Fora disso, 422 | CRM-2, CRM-6, SEG-2 |
| 5 | **Busca `?q=`:** nome sem diferenciar maiúsculas nem acentos (`Joao` acha `João`), e-mail por trecho e telefone pelos dígitos. O nome ganha a coluna `nome_busca` (minúsculas e sem acento), gravada pelo repositório em toda escrita e preenchida na migração para os contatos existentes, sem extensão nova. Coluna gerada no banco ficou de fora porque o Prisma 6 não a representa e o teste de drift entre schema e migrações a acusaria (implementação). Com 50 mil contatos por empresa, a varredura cabe na meta de 300 ms; índice de trigramas fica para quando a medição pedir | spec §6.3 |
| 6 | **Consentimentos:** <ul><li>`POST /v1/contatos/{id}/consentimentos` (`contato.update`) com `{ canal, finalidade, concedido, base_legal, evidencia? }`;</li><li>`GET /v1/contatos/{id}/consentimentos` traz o histórico.</li></ul> O contato devolve a situação atual por canal e finalidade (o registro mais recente). Nunca se edita nem se apaga um consentimento | LGPD, schema |
| 7 | **Origens e motivos de perda:** CRUD `/v1/origens` e `/v1/motivos-perda` com `config.crm` (leitura com `contato.read`, porque as telas de contato e negócio listam as opções). Nome único na empresa (409 `duplicado`). `DELETE` desativa (`ativo = false`), porque contatos e negócios os referenciam | spec §5.3 |
| 8 | **Isolamento:** `/v1/contatos`, `/v1/origens` e `/v1/motivos-perda` entram na matriz `testarIsolamento` da F3 | F3 PR 6 |

## Estrutura

- **Migração** `nome_busca` em `contato`, com o preenchimento dos existentes.
- **Contratos** `packages/contracts/src/crm/`: `contatos.ts`, `consentimentos.ts`, `origens.ts`,
  `motivos-perda.ts`.
- **API** `apps/api/src/modules/contatos/`, `origens/` e `motivos-perda/` (controller, comandos,
  repositório), mais `core/normalizacao/` (e-mail, telefone, CPF).
- **Seed:** as origens e os motivos padrão da empresa já existem (`semearPadroesEmpresa`).
- OpenAPI regenerado; README da API (dedupe e normalização).

## Testes

- **Unidade:** normalização de e-mail e telefone (fixo, celular, com e sem DDI, inválido) e
  dígitos de CPF.
- **Contatos (API):**
  - CRUD completo;
  - dedupe no `POST` e no `PATCH` (409 com `id_existente`);
  - excluído não bloqueia um novo com o mesmo e-mail;
  - corrida de dois `POST` iguais (um 201, um 409);
  - sem meio de contato: 422;
  - campos derivados recusados;
  - origem de outra empresa ou inativa: 422;
  - responsável sem acesso: 422;
  - busca por nome sem acento, por e-mail e por telefone formatado;
  - filtros;
  - PROPRIO só vê os seus;
  - idempotência do `POST`;
  - auditoria (só os nomes das colunas).
- **Consentimentos:** acrescentar e revogar; histórico; situação atual no contato.
- **Origens e motivos:** CRUD; nome repetido (409); desativar mantém as referências.
- **Isolamento:** a matriz nos três recursos.
- **Sabotagens:** sem normalizar o telefone, dedupe só pelo e-mail, aceitar campo derivado, busca
  sensível a acento, consentimento editável.

## Rollout e rollback

- Migração aditiva (coluna `nome_busca`). Depois do merge: `pnpm db:migrate`. Dependência nova:
  `libphonenumber-js` (API). Rollback: reverter o PR e remover a coluna.

## Revisão

Duas trilhas independentes, corretude e segurança: dados pessoais (PII) e LGPD.
