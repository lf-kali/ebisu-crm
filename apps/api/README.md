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

## Testes de isolamento

`test/isolamento/suite.ts` traz `testarIsolamento`: cada frente de domínio chama a função para o
seu recurso, sobre o cenário de `test/isolamento/cenario.ts` (contas A, B e C; empresas A1, A2 e
A3 inativa). Ela prova que, com o cabeçalho de A1, ninguém lê, lista, edita ou exclui registros de
A2 nem da conta B.
