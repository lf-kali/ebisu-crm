# F3 · PR 6: sequência de documentos e suíte de isolamento

STATUS: APPROVED (usuário, 2026-10-31)

Último PR da F3. Entram o serviço que numera orçamentos, ordens de serviço e compras (usado a partir
da F6) e o fechamento da suíte de isolamento do "pronto quando" da F3 (spec §4): o que as frentes
seguintes vão reaproveitar e o que a F3 precisa provar sobre as próprias rotas.

## Objetivo

- `proximoNumero(ctx, tipo)`: número do documento por empresa, sem buracos, com reinício mensal.
- Suíte de isolamento cobrindo todas as rotas da F3 e checagens do banco que pegam uma tabela nova
  sem RLS correto ou sem FK composta, antes que alguém precise lembrar de testar.
- Um mapa do "pronto quando" da F3 para os testes que provam cada item.

## Fora deste PR

- Edição do formato do número pela empresa: não está na spec do MVP. O formato é fixo no código e
  fica gravado na linha do período, para uma configuração futura não mudar números já emitidos.
- Isolamento por filtro (`?filtro[...]`), lote e `job_lote`: as rotas que os usam nascem na F4. A
  matriz `testarIsolamento` ganha os casos de filtro e lote junto com elas.
- SEG-5 (custos fora da resposta sem `financeiro.ver_custos`): os primeiros campos de custo nascem na
  F6 e na F8, que trazem o teste.
- Telas do web da F3: PR de web depois deste.

## Decisões

| # | Decisão | Origem |
| --- | --- | --- |
| 1 | **Formato** (reinício mensal): `ORC-{AA}{MM}-{####}`, `OS-{AA}{MM}-{####}` e `CP-{AA}{MM}-{####}`, por exemplo `OS-2610-0001`. Passando de 9999 no mês, o número ganha um dígito (`OS-2610-10000`); nunca trunca | usuário, 2026-10-31; spec (`OS-{YY}{MM}-{####}`) |
| 2 | **Por empresa e por tipo**, com o mês no fuso da empresa (`empresa.timezone`, padrão `America/Sao_Paulo`): uma OS aberta às 23h30 do dia 31 em São Paulo é do mês 31, mesmo já sendo dia 1º em UTC | spec §4 F3 |
| 3 | **Sem buracos:** o número sai de um `INSERT … ON CONFLICT DO UPDATE` em `sequencia_documento`, na mesma transação do comando. A linha fica travada até o fim da transação: duas OS simultâneas da mesma empresa esperam uma pela outra, e se o comando falhar o número volta para a fila. O custo é serializar a criação de documentos do mesmo tipo na empresa, o que é aceitável no volume de uma assistência | invariantes (`AbrirOS`) |
| 4 | **Onde mora:** `apps/api/src/core/sequencias/` (spec §3: core é dono de "sequências"). Recebe o `TxContext` do comando (empresa do contexto, RLS da conta) e devolve o número formatado. Só roda dentro de `executarComando` | spec §3, §5.4 |
| 5 | **Isolamento das rotas da F3:** <ul><li>`/v1/api-keys` entra na matriz `testarIsolamento` (é recurso por empresa);</li><li>uma matriz nova, `testarIsolamentoDaConta`, para as rotas da conta: `/v1/empresas`, `/v1/membros` e `/v1/membros/convites` (ler, editar e excluir pelo id de outra conta dá 404, a lista não traz nada de outra conta e nada muda no banco).</li></ul> | spec §4 F3 |
| 6 | **Checagens do banco** (rodam sobre o schema migrado, sem lista manual de tabelas): <ul><li>toda tabela com `tenant_id` tem a política `tenant_isolamento` com `USING` e `WITH CHECK` iguais a `tenant_id = app_tenant_id()`;</li><li>política permissiva além dessa só numa lista fechada (`auth_leitura` em `membro`, `tenant`, `empresa`, `convite` e `api_key`, e `reivindicacao` em `email_saida`): uma política nova que abra leitura entre contas falha o teste;</li><li>toda coluna `empresa_id` com FK para `empresa` usa a FK composta `(tenant_id, empresa_id)` (SEG-2).</li></ul> | SEG-1, SEG-2 |
| 7 | **Job:** o worker de e-mail processa convites de duas contas no mesmo lote e cada token vai para o convite da conta certa (o job carrega a conta, como pede SEG-3) | spec §4 F3 ("por job") |
| 8 | **Mapa do "pronto quando"** na seção "Isolamento" do README da API: cada item da spec com o arquivo de teste que o prova, ou a frente que vai provar | spec §4 F3 |

## Estrutura

- `apps/api/src/core/sequencias/sequencias.ts`: `proximoNumero`, `formatarNumero`, `periodoDe`.
- `apps/api/test/isolamento/`: `testarIsolamentoDaConta` em `suite.ts`; os testes das rotas da F3.
- `packages/db/test/migracao-e-papeis.test.ts`: as checagens de política e de FK composta.
- `apps/worker/test/emails.test.ts`: o caso de duas contas.
- README da API: sequências e mapa do isolamento.

Sem migração: `sequencia_documento` já existe, com o índice único `(empresa_id, tipo, periodo)` e
RLS.

## Testes

- **Sequência (unidade):** formato dos três tipos; 9999 → 10000; período no fuso da empresa (virada do
  mês em São Paulo e em outro fuso).
- **Sequência (banco, Testcontainers):** números seguidos 1, 2, 3; empresas e tipos independentes;
  mês novo recomeça; 20 transações simultâneas recebem 1 a 20, sem repetir nem pular; comando que
  falha devolve o número; outra conta não vê nem avança a sequência (RLS).
- **Isolamento:** as matrizes da decisão 5 sobre as rotas reais da F3; as checagens da decisão 6;
  o job da decisão 7.
- **Sabotagens:** sequência fora da transação do comando (buraco no rollback); período em UTC;
  truncar acima de 9999; uma política `USING (true)` nova numa tabela de negócio; uma FK simples
  para `empresa`; o worker gravando o token na conta errada.

## Rollout e rollback

- Sem migração e sem variável nova. Rollback: reverter o PR.

## Revisão

Uma trilha independente (corretude): não muda autenticação, RLS nem papéis de banco, só os testa.
