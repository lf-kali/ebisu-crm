# @ebisu/api

API REST `/v1` do ebisuCRM (NestJS). Spec: [`docs/spec-mvp.md`](../../docs/spec-mvp.md) §5.

## Como declarar uma rota

Toda rota tem um `@Contrato` (schemas de entrada e saída, que também geram o `openapi.json`) e
**exatamente uma** marca de acesso. Rota sem marca, ou com duas, responde 500 e o teste de marcas
falha no CI.

| Marca                               | Quando                                                  | O guard confere                                                                                          |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@Publica()`                        | Saúde, login, refresh, logout                           | Nada                                                                                                     |
| `@SoAutenticado()`                  | Rotas da pessoa, sem empresa (`/v1/eu`, troca de conta) | Bearer válido; usuário ativo; membro `ATIVO`; conta `TRIAL`/`ATIVO`                                      |
| `@Permissao('recurso.acao')`        | Toda rota de domínio                                    | O mesmo, mais `X-Empresa-Id` ativa e atribuída ao membro, e a permissão nessa empresa                    |
| `@PermissaoNaConta('recurso.acao')` | Rotas da conta, sem empresa (`/v1/empresas`)            | O mesmo que `@SoAutenticado`, mais a permissão com escopo TENANT num papel atribuído a todas as empresas |
| `@ApiKeyPublica('recurso.acao')`    | Rotas da chave de navegador, sob `/v1/publico/`         | `X-Api-Key` de navegador válida, com o escopo e um `Origin` cadastrado nela (sem Bearer)                 |

Nas rotas da conta, o comando recebe um `TxContextDaConta` (`empresaId: null`; use
`@ContextoConta()` no lugar de `@Contexto()`). Um papel com a permissão em escopo EMPRESA, ou
atribuído a uma empresa só, não abre essas rotas: elas mexem na conta inteira. Os POST delas também
exigem `Idempotency-Key`.

A chave de `@Permissao` (e de `@PermissaoNaConta`) precisa existir no catálogo (`packages/db/src/seeds/catalogo-permissoes.ts`);
se não existir, a API não sobe. As respostas de erro seguem o catálogo da spec §5.2:

| Situação                                         | Resposta                               |
| ------------------------------------------------ | -------------------------------------- |
| Sem token, token inválido ou sessão desativada   | 401 `nao_autenticado`                  |
| `X-Empresa-Id` ausente ou não-UUID               | 422 `validacao` (campo `X-Empresa-Id`) |
| Empresa inativa, de outra conta ou não atribuída | 403 `empresa_nao_autorizada`           |
| Falta a permissão                                | 403 `sem_permissao`                    |
| Registro de outra empresa ou conta               | 404 `nao_encontrado` (nunca 403)       |

## Membros e o dono da conta

`/v1/membros` (`config.membros`) e `/v1/papeis` e as atribuições (`config.rbac`) são rotas da conta.
Só um dono (OWNER em todas as empresas) dá ou tira o papel de dono e suspende ou reativa um dono;
ninguém muda o próprio status; e a conta nunca fica sem um dono ativo (409 `transicao_invalida`).
As mudanças de status e de atribuições passam pela trava dos donos da conta (`travarDonos`, advisory
lock da transação), para duas mudanças simultâneas não deixarem a conta sem dono.

## Convites

`POST /v1/membros/convites` (`config.membros` e `config.rbac`; dono só por um dono) grava o convite
e uma linha em `email_saida`, na mesma transação. O worker reivindica as linhas de todas as contas
por `reivindicar_email_saida()` (única passagem entre contas, devolve só ids), gera o token no
envio e grava só o hash. O aceite é público (`/v1/auth/convites/consultar` e `/aceitar`, só JSON,
limite por IP): e-mail novo cria o acesso; usuário verificado precisa da senha dele; usuário não
verificado define senha nova e perde as sessões antigas. Link inválido, vencido, usado ou
revogado: 410 `link_invalido`. Convidar e reenviar têm limite (30 por hora por conta, 3 por dia por e-mail de destino e por convite reenviado, 5 por dia em conta com menos de 24 h; no sistema, 300 por hora para contas antigas e 100 para contas novas). Os limites da conta vêm antes do comando e o teto global só conta convite enfileirado; a repetição idempotente não gasta cota.

## API keys e CORS

`/v1/api-keys` (`config.api_keys`, rota de domínio) cria, lista, edita e revoga as chaves da empresa.
O token (`ebk_live_…`) só aparece na resposta do `POST`; no banco fica só o SHA-256, e a repetição
idempotente devolve `token: null`. Os escopos de uma chave precisam ser permissões que quem cria tem
na empresa inteira (EMPRESA ou TENANT, não PROPRIO), nunca `config.*`.

A chave só autentica onde a rota pede: `@Permissao('recurso.acao', { apiKey: true })` aceita a chave
de **servidor** (o comando roda com `membroId: null`, `apiKeyId` preenchido e a empresa da chave), e
`@ApiKeyPublica` aceita a de **navegador**. Sem a opção, `X-Api-Key` é ignorado. Antes de abrir uma
rota para chave, confira que o comando funciona sem membro (responsável, escopo PROPRIO).

| Situação                                                                                    | Resposta                     |
| ------------------------------------------------------------------------------------------- | ---------------------------- |
| Chave inválida, revogada, vencida, de empresa ou conta inativa                              | 401 `nao_autenticado`        |
| Chave do tipo errado para a rota, ou junto com `Authorization`                              | 401 `nao_autenticado`        |
| Chave de servidor vinda de navegador (com `Origin`)                                         | 403 `sem_permissao`          |
| Chave de navegador com `Origin` fora da lista                                               | 403 `sem_permissao`          |
| Falta o escopo                                                                              | 403 `sem_permissao`          |
| `X-Empresa-Id` diferente da empresa da chave                                                | 403 `empresa_nao_autorizada` |
| 20 falhas de chave por minuto do mesmo IP; rota pública: 60 por minuto por chave, 30 por IP | 429 `limite_excedido`        |

CORS só existe em `/v1/publico/*` (`core/cors/cors-publico.ts`): o preflight responde a qualquer
origem (ele não traz a chave) e a requisição de fato só recebe `Access-Control-Allow-Origin`, com a
origem exata, depois que o guard confere o `Origin` contra a chave. As demais rotas não têm CORS: o
web usa a mesma origem (proxy do Vite em dev, proxy reverso em produção).

## Rate limit e IP

Os limites por IP (login e cadastro) usam `req.ip`. A API não confia em `X-Forwarded-For`: atrás de
um proxy reverso, `req.ip` é o do proxy e os limites valem para todos os clientes juntos. Antes do
deploy com proxy, configure `trust proxy` só para o endereço dele.

## Dados de domínio

Só o `ExecutorDeComandos.executarComando` (`src/core/tx`) abre transação: ele define o tenant (RLS)
e entrega ao comando um `TxContext` com `tx`, empresa, membro e permissões. O lint barra importar
`@ebisu/db` fora de `core/`, `modules/auth`, `modules/eu` e `*.repositorio.ts` (tipos são livres).

```ts
@Get(':id')
@Permissao('contato.read')
@Contrato({ resumo: 'Lê um contato', params: PorId, resposta: Contato })
ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: z.infer<typeof PorId>) {
  return this.executor.executarComando(contexto, (ctx) => this.contatos.ler(ctx, id), undefined);
}
```

No repositório, toda consulta filtra pela empresa e pelo escopo:

```ts
where: { id, empresa_id: ctx.empresaId, ...filtroDeEscopo(ctx, 'contato.read', 'responsavel_id') }
```

Escritas que gravam referências passam por `comReferencias(...)`: uma FK violada (referência
inexistente ou de outra empresa) vira 422 `validacao`, sem dizer qual dos dois casos aconteceu.
Fora dele (ex.: FK `RESTRICT` barrando uma exclusão), o comando trata o caso como conflito.

## Idempotência

Todo POST com `@Permissao` exige `Idempotency-Key` (UUID); o `executarComando` aplica a regra sem
nada no comando. Repetir com a mesma chave devolve a mesma resposta, byte a byte, sem novos
efeitos; a mesma chave com outro pedido (corpo, rota, parâmetros, empresa ou autor) dá 422
`idempotencia_divergente`; com a chave em uso por outra requisição, 409 `idempotencia_em_andamento`.
Só sucesso é memorizado (a resposta é gravada na mesma transação dos efeitos) e vale 24 h. Por
isso a saída do comando precisa ser JSON puro (strings no lugar de `Date`/`Decimal`), o mesmo que
o contrato já exige. Cada requisição chama o `executarComando` uma vez só: uma segunda chamada com o mesmo contexto
devolveria a resposta da primeira. A trava, a leitura e a gravação da chave cabem na transação do
comando (padrão do Prisma: 5 s); se ela estourar, tudo é desfeito e a repetição roda de novo.

## Audit log

O banco audita sozinho (trigger `auditar()`, migração `20261028010000_audit_log`): toda escrita
nas tabelas de negócio grava em `audit_log` o autor, o `request_id`, o IP e os nomes das colunas
alteradas, nunca os valores (SEG-8). O `executarComando` passa o autor; o comando não faz nada.
Tabela nova precisa ganhar o trigger na migração ou entrar na lista de fora em
`packages/db/test/auditoria.test.ts`, senão o teste falha.

## Contatos (CRM)

`/v1/contatos` normaliza antes de gravar (`core/normalizacao`): e-mail com trim e minúsculas em
`email_normalizado`; telefone e WhatsApp em E.164 (`libphonenumber-js` com metadado completo,
Brasil como padrão; número inválido dá 422 no campo); CPF ou CNPJ conferido e sem máscara. O dedupe
(CRM-1) confere e-mail, telefone e WhatsApp entre os contatos não excluídos da empresa antes de
gravar: repetido dá 409 `duplicado` com `id_existente` e o `campo`; os índices únicos parciais
fecham a corrida. Campos derivados (ciclo de vida, scores, completude) são recusados na entrada. A
busca `?q=` usa `nome_busca` (sem acento, gravado pelo repositório a partir do nome), o e-mail e os
dígitos do telefone. Consentimentos só são acrescentados; revogar é um registro novo.

`GET /v1/membros/opcoes` (com `X-Empresa-Id` e `contato.read`) devolve os responsáveis possíveis
para os selects das telas: só `id` e `nome` dos membros ativos com acesso à empresa, em ordem de
nome e até 500. Quem não administra membros (`config.membros`) escolhe o responsável por ela, sem
ver e-mail, cargo nem papéis.

## Funil, negócios e tarefas (CRM)

`/v1/funil` lê (`negocio.read`) e edita (`config.crm`) o funil padrão da empresa: o PATCH traz
todas as etapas pelo id (não se criam nem se apagam etapas) e troca os requisitos de cada uma.
Requisito CAMPO só aceita as chaves de `CHAVES_CAMPO` e REGRA as de `CHAVES_REGRA`
(`@ebisu/contracts`); TAREFA exige `titulo_tarefa`.

`POST /v1/negocios/{id}/mover` só avança com os requisitos obrigatórios da etapa atual, e das
etapas puladas, atendidos (CRM-3; senão 409 `requisitos_pendentes` com a lista). Voltar não exige.
Ganho fica para a conversão do orçamento (F6). `/perder` exige motivo ativo (CRM-4) e cancela as
tarefas abertas; `/nutrir` leva à etapa Nutrição até `nba_adiada_ate`, e mover reativa. PATCH e
comandos conferem `versao_registro` (409 `conflito_versao`). Entrar numa etapa cria as tarefas dos
requisitos TAREFA, sem repetir; sair da segunda etapa aberta promove o contato LEAD a
LEAD_QUALIFICADO (CRM-2).

A completude (`negocio.completude`, `contato.completude_perfil` e `contato.campos_faltantes`) vem
só de `modules/completude` (CRM-6): o comando grava o valor calculado na mesma escrita do dado,
para o audit log ter um registro por mudança. Cascatas (consentimento, contato → negócios, tarefa
de requisito concluída, edição do funil) recalculam com escrita própria.

## Sequência de documentos

`proximoNumero(ctx, tipo)` (`core/sequencias`) devolve o número do orçamento (`ORC-2610-0001`), da
ordem de serviço (`OS-…`) ou da compra (`CP-…`): por empresa e por tipo, reiniciando todo mês no
fuso da empresa. Chame dentro do comando (no `executarComando`): a linha do período fica travada
até o fim da transação, então dois documentos simultâneos esperam um pelo outro e um comando que
falha devolve o número (sem buracos). Acima de 9999 no mês, o número ganha um dígito.

## Testes de isolamento

`test/isolamento/suite.ts` traz duas matrizes reaproveitáveis:

- `testarIsolamento`, para recursos por empresa: com o cabeçalho de uma empresa, ninguém lê, lista,
  edita ou exclui registros de outra empresa nem de outra conta;
- `testarIsolamentoDaConta`, para rotas da conta: registro de outra conta não é lido, não aparece
  na lista e não muda por nenhuma escrita pelo id (404).

Toda frente de domínio chama a matriz para cada recurso novo. No banco,
`packages/db/test/migracao-e-papeis.test.ts` falha sozinho se uma tabela nova vier sem RLS forçado,
sem a política `tenant_isolamento` certa, com uma política permissiva fora da lista fechada ou com
FK simples para `empresa`.

Mapa do "pronto quando" da F3 (spec §4):

| Item                                                                                        | Onde é provado                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membro da empresa A não lê, altera, exclui nem referencia dados da empresa B                | `test/isolamento/isolamento.test.ts` (matriz, referência entre empresas, PROPRIO), `test/isolamento/rotas-f3.test.ts` (API keys)                         |
| Um tenant não acessa os dados de outro                                                      | `test/isolamento/rotas-f3.test.ts` (empresas, membros, convites, API keys); `packages/db/test/migracao-e-papeis.test.ts` (RLS e FKs de todas as tabelas) |
| … por id e por filtro                                                                       | por id: as matrizes acima; filtros (`?filtro[...]`) nascem na F4, com o caso na matriz                                                                   |
| … por lote e por job                                                                        | `job_lote` e as rotas em massa nascem na F4; job do outbox: `apps/worker/test/emails.test.ts` (duas contas no mesmo lote)                                |
| Repetir um POST com a mesma `Idempotency-Key` devolve a mesma resposta sem duplicar efeitos | `test/isolamento/idempotencia.test.ts`                                                                                                                   |
| Reuso de refresh token invalida a família                                                   | `test/auth/auth.test.ts`                                                                                                                                 |
| Custos somem da resposta sem `financeiro.ver_custos` (SEG-5)                                | os primeiros campos de custo nascem na F6 e na F8, que trazem o teste                                                                                    |
