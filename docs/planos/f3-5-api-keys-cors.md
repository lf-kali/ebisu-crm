# F3 · PR 5: API keys e CORS

STATUS: APPROVED (usuário, 2026-10-31)

Integrações máquina a máquina entram com `X-Api-Key` (spec §5.1, D-T05). Quem administra a empresa
cria, lista, edita e revoga as chaves. A chave do formulário do site, visível no JavaScript da
página, é de outro tipo: só vale nas rotas públicas e só a partir das origens cadastradas (CORS).
Ainda não há rota de negócio que aceite chave; a primeira é a captura de lead da F4
(`POST /v1/publico/capturas`). Aqui ficam a gestão, a autenticação no guard e o CORS, provados por
rotas que só existem nos testes.

## Objetivo

- CRUD de API keys por empresa, com o segredo mostrado uma vez só.
- O guard autentica a chave nas rotas que a aceitam, com o escopo dela no lugar das permissões do
  membro, e o audit log registra a chave como autora.
- CORS por origem nas rotas `/v1/publico/*`; as demais rotas continuam sem CORS (o web usa a mesma
  origem, pelo proxy do Vite e, em produção, pelo proxy reverso).

## Fora deste PR

- `POST /v1/publico/capturas` e qualquer rota de negócio com chave (F4).
- Tela do web (configurações de API keys): PR de web depois da F3.
- Chave de teste (`ebk_test_`), rotação automática e webhooks de saída: fora do MVP.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Só rotas marcadas aceitam chave:** a rota declara que aceita chave; sem isso, `X-Api-Key` não autentica e a rota pede o Bearer de sempre. Rota nova nasce fechada, então um comando que conta com um membro (responsável, escopo PROPRIO) nunca roda sem membro por engano | usuário, 2026-10-31 |
| 2 | **Dois tipos de chave:** <ul><li>**servidor** (sem origens): vale nas rotas `@Permissao(chave, { apiKey: true })`; se a requisição traz `Origin` (veio de um navegador), 403 `sem_permissao`, para que uma chave de servidor colada num site não funcione;</li><li>**navegador** (com origens): vale só nas rotas da marca nova `@ApiKeyPublica(chave)`, todas sob `/v1/publico/*`, e só com um `Origin` da lista. Escopo único: `lead.create`.</li></ul> O tipo é fixo depois de criado. Quem copiar a chave do site só captura lead | usuário, 2026-10-31 |
| 3 | **A chave é da empresa:** quando quem criou é suspenso ou perde a permissão, a chave continua. A lista mostra quem criou e o último uso; revogar é manual. Risco aceito: quem saiu pode ter guardado o segredo | usuário, 2026-10-31 |
| 4 | **Gestão por empresa** (`@Permissao('config.api_keys')`, com `X-Empresa-Id`, porque a chave pertence a uma empresa): <ul><li>`GET /v1/api-keys` (paginada por id, inclui revogadas com `revogada_em`) e `GET /v1/api-keys/{id}`;</li><li>`POST /v1/api-keys` (`{ nome, tipo, escopos, origens_cors?, expira_em? }`, 201, idempotente);</li><li>`PATCH /v1/api-keys/{id}` (`nome`, `escopos`, `origens_cors`);</li><li>`DELETE /v1/api-keys/{id}` (revoga, 204; revogar de novo também dá 204).</li></ul> Chave de outra empresa ou conta: 404 | §5.3 |
| 5 | **Escopos sem escalada:** os escopos da chave de servidor precisam estar no catálogo, não podem ser `config.*` e precisam ser permissões que quem cria (ou edita) tem na empresa inteira, com escopo EMPRESA ou TENANT (uma permissão só PROPRIO não entra, porque na chave valeria na empresa; revisão); senão 422. Ao menos um escopo. A chave de navegador tem exatamente `["lead.create"]`. Na requisição, cada escopo vale com escopo EMPRESA (não há membro para o PROPRIO) | segurança |
| 6 | **Formato e guarda do segredo:** `ebk_live_` + 32 bytes aleatórios em base64url. O prefixo exibido (`ebk_live_` + 8 caracteres) é único e serve para achar a chave; no banco fica só o SHA-256 do token inteiro, comparado em tempo constante (o token tem 256 bits de entropia: argon2 não acrescenta nada e custaria CPU a cada requisição). O token só aparece na resposta do `POST`. A resposta guardada para a repetição idempotente vai **sem** o token: repetir o `POST` devolve a chave sem o segredo, e quem perdeu o segredo revoga e cria outra | segurança, SEG-7 |
| 7 | **Autenticação no guard:** `X-Api-Key` junto com `Authorization` dá 401 (pedido ambíguo). A chave é procurada pelo prefixo com o `ebisu_auth` (ainda não se sabe a conta; política de leitura como a do convite) e precisa: hash igual, não revogada, não vencida, empresa ativa, conta em teste ou ativa, tipo certo para a marca da rota. Qualquer falha dessas: 401 `nao_autenticado`, sem dizer qual. Escopo que falta: 403 `sem_permissao`. Na rota de domínio, a empresa é a da chave; um `X-Empresa-Id` diferente dá 403 `empresa_nao_autorizada` | SEG-3, SEG-6 |
| 8 | **Contexto e autoria:** `membroId` nulo e `apiKeyId` preenchido. A idempotência usa `apikey:<id>` como autor no hash. O audit log já grava `ator_api_key_id` (PR 3b). O `ultimo_uso` é atualizado pelo `ebisu_app`, no máximo uma vez por minuto por chave, para não gravar a cada requisição | spec §5.4, PR 3b |
| 9 | **CORS só em `/v1/publico/*`:** <ul><li>preflight (`OPTIONS`) responde 204 a qualquer origem, com `POST`, os cabeçalhos `Content-Type`, `X-Api-Key` e `Idempotency-Key`, `Max-Age` de 10 minutos e `Vary: Origin`. O preflight não traz a chave, então não dá para conferir a origem nele;</li><li>na requisição de fato, o guard confere o `Origin` contra a lista da chave e só então a resposta ganha `Access-Control-Allow-Origin` com a origem exata. Erro de chave ou de origem não leva o cabeçalho, e o navegador não deixa o site ler a resposta;</li><li>nunca `Allow-Credentials` nem `*`.</li></ul> Fora de `/v1/publico/*`, nenhum cabeçalho de CORS, nem no preflight | spec §5.3 |
| 10 | **Origens cadastradas:** `https://host[:porta]`, sem caminho, sem curinga, normalizadas em minúsculas; `http://` só para `localhost` e `127.0.0.1`. De 1 a 10 por chave, sem repetição. Fora disso, 422 | segurança |
| 11 | **Limites (§7):** nas rotas públicas com chave, 60 requisições por minuto por chave e 30 por minuto por IP; falha de autenticação por chave conta 20 por minuto por IP, para ninguém varrer prefixos. O limite do IP vem antes e a cota da chave só conta quem está dentro dele, para um IP sozinho não esgotar a chave do site para todos (revisão). 429 com `Retry-After` | §7 |
| 12 | **Migração:** coluna `tipo` (`SERVIDOR`, `NAVEGADOR`) com CHECK (navegador ⇔ tem origens); `escopos` e `origens_cors` `NOT NULL` com padrão vazio; política `auth_leitura` em `api_key` (só `SELECT`) para o `ebisu_auth`; o trigger de auditoria ignora o `UPDATE` que só muda o `ultimo_uso` (implementação). A tabela está vazia em todo ambiente, então a migração é segura | SEG-6 |

## Estrutura

- **Migração** `20261031000000_api_keys`: tipo, CHECK, NOT NULL, leitura do `ebisu_auth`.
- **`@ebisu/db`:** `gerarApiKey()` (token, prefixo, hash) e `hashDaApiKey()`, ao lado de
  `gerarTokenConvite`.
- **Contratos:** `plataforma/api-keys.ts` (`EntradaApiKey`, `EdicaoApiKey`, `ApiKey`,
  `ApiKeyCriada` com o token, `ListaApiKeys`) e as rotas.
- **API:**
  - `core/rbac`: opção `{ apiKey: true }` em `@Permissao`, marca `@ApiKeyPublica`, autenticação
    por chave no guard (`chaves-api.ts`, para o guard não passar de tamanho);
  - `core/cors`: middleware das rotas públicas;
  - `core/idempotencia`: resposta guardada sem o token;
  - `modules/api-keys`: controller, comandos e repositório.
- **OpenAPI** regenerado, com o esquema de segurança `X-Api-Key`. README da API: tipos de chave e
  CORS.

## Testes

- **Gestão:** criar dos dois tipos e ver o token só no `POST`; o banco guarda só o hash; repetir o
  `POST` com a mesma `Idempotency-Key` devolve a chave sem token; listar, ler, editar, revogar (e
  revogar de novo); escopo fora do catálogo, `config.*`, que o criador não tem, ou navegador com
  escopo diferente de `lead.create`: 422; origem inválida, com caminho, `http` fora de localhost,
  repetida ou mais de 10: 422; sem `config.api_keys`: 403; chave de outra empresa: 404.
- **Guard (rotas de teste):** chave de servidor entra na rota marcada e o comando vê `apiKeyId` e a
  empresa da chave; a mesma chave numa rota sem a marca: 401; chave revogada, vencida, de empresa
  desativada, de conta suspensa, com segredo errado ou prefixo inexistente: 401; escopo faltando:
  403; `X-Empresa-Id` de outra empresa: 403; com `Authorization` junto: 401; chave de servidor com
  `Origin`: 403; chave de navegador na rota de domínio: 401; chave de servidor na rota pública:
  401; criador suspenso: a chave continua; o audit log grava a chave como autora; `ultimo_uso` é
  atualizado e não regrava dentro do minuto.
- **CORS:** preflight em `/v1/publico/*` com os cabeçalhos certos; requisição de origem cadastrada
  recebe `Access-Control-Allow-Origin` exato; origem fora da lista: 403 sem o cabeçalho; rota fora
  de `/v1/publico/*`: sem cabeçalho de CORS, nem no preflight.
- **Limites:** 61ª requisição da mesma chave no minuto: 429; 21 falhas de chave do mesmo IP: 429.
- **Banco:** o `ebisu_auth` lê `api_key` de qualquer conta e não escreve; o CHECK do tipo recusa
  navegador sem origem e servidor com origem.
- **Marcas:** toda rota `@ApiKeyPublica` fica sob `/v1/publico/`.
- **Sabotagens:** comparar sem o hash (aceitar qualquer segredo do prefixo); ignorar `revogada_em`;
  ignorar o tipo da chave; não conferir o `Origin`; aceitar escopo que o criador não tem; guardar o
  token na resposta idempotente; aceitar chave em rota sem a marca.

## Rollout e rollback

- Migração aditiva sobre tabela vazia. Depois do merge: `pnpm db:migrate`. Sem variável nova.
- Deploy: o proxy reverso precisa repassar `OPTIONS` e o cabeçalho `Origin` em `/v1/publico/*`.
- Rollback: reverter o PR; a migração de volta tira a coluna `tipo`, o CHECK e a política. Chaves
  criadas param de funcionar (não há rota de negócio que as use ainda).

## Revisão

Duas trilhas independentes, corretude e segurança: autenticação nova, segredo, papel de banco com
leitura entre contas e CORS.
