# @ebisu/api

API REST `/v1` do ebisuCRM (NestJS). Spec: [`docs/spec-mvp.md`](../../docs/spec-mvp.md) §5.

## Como declarar uma rota

Toda rota tem um `@Contrato` (schemas de entrada e saída, que também geram o `openapi.json`) e
**exatamente uma** marca de acesso. Rota sem marca, ou com duas, responde 500 e o teste de marcas
falha no CI.

| Marca                        | Quando                                                  | O guard confere                                                                       |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `@Publica()`                 | Saúde, login, refresh, logout                           | Nada                                                                                  |
| `@SoAutenticado()`           | Rotas da pessoa, sem empresa (`/v1/eu`, troca de conta) | Bearer válido; usuário ativo; membro `ATIVO`; conta `TRIAL`/`ATIVO`                   |
| `@Permissao('recurso.acao')` | Toda rota de domínio                                    | O mesmo, mais `X-Empresa-Id` ativa e atribuída ao membro, e a permissão nessa empresa |

A chave de `@Permissao` precisa existir no catálogo (`packages/db/src/seeds/catalogo-permissoes.ts`);
se não existir, a API não sobe. As respostas de erro seguem o catálogo da spec §5.2:

| Situação                                         | Resposta                               |
| ------------------------------------------------ | -------------------------------------- |
| Sem token, token inválido ou sessão desativada   | 401 `nao_autenticado`                  |
| `X-Empresa-Id` ausente ou não-UUID               | 422 `validacao` (campo `X-Empresa-Id`) |
| Empresa inativa, de outra conta ou não atribuída | 403 `empresa_nao_autorizada`           |
| Falta a permissão                                | 403 `sem_permissao`                    |
| Registro de outra empresa ou conta               | 404 `nao_encontrado` (nunca 403)       |

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

## Testes de isolamento

`test/isolamento/suite.ts` traz `testarIsolamento`: cada frente de domínio chama a função para o
seu recurso, sobre o cenário de `test/isolamento/cenario.ts` (contas A, B e C; empresas A1, A2 e
A3 inativa). Ela prova que, com o cabeçalho de A1, ninguém lê, lista, edita ou exclui registros de
A2 nem da conta B.
