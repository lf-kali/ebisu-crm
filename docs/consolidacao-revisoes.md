# ebisuCRM — Consolidação das revisões do modelo v0.1 e proposta de MVP

> Data: 2026-10-27 · Base: [`schema.prisma`](./schema.prisma) v0.1 e [`README.md`](./README.md)
>
> Três agentes revisaram o modelo v0.1 a partir do prompt de validação. Este documento confere
> cada afirmação contra o schema real, compara os pareceres e consolida a proposta final do MVP.

---

## 1. Visão geral dos três pareceres

| | 1º agente | 2º agente | 3º agente |
|---|---|---|---|
| Foco | Regras que precisam ser sempre verdadeiras, transações, escopo e ordem de entrega | Cortes no schema e "fonte da verdade" do estoque | Infraestrutura (RLS, pool de conexões, particionamento) |
| Viu o schema? | Não (avisou) | Parcialmente | Parcialmente |
| Ponto mais forte | Mapa de regras e transações; testes de concorrência e isolamento; plano em etapas com critério de saída | Concorrência no estoque, órfãos nas referências genéricas, dedupe com soft delete, JSONB onde cabe | Não guardar senha de desbloqueio, caixa diário, termo de responsabilidade |
| Ponto mais fraco | Genérico; aponta como "a verificar" coisas que já existem | Erros factuais e uma correção que cria bug novo | Snippets errados, propostas prematuras ou contrárias à visão do produto |
| Confiabilidade | Alta | Média | Média-baixa |

**Consenso dos três (e nosso):**

1. O escopo da v1 está grande demais.
2. O estoque tem risco de concorrência: duas OS podem consumir a última peça ao mesmo tempo.
3. As referências genéricas (`entidade_tipo` + `entidade_id`, sem chave estrangeira) enfraquecem a integridade.
4. O motor de pontuação e de próxima ação é cedo demais na forma configurável.

---

## 2. Conferência contra o schema real

| Afirmação | Quem | Situação no schema | Veredito |
|---|---|---|---|
| "RLS em `anexo` só filtra por tenant e vaza entre empresas" | 2º | `anexo` já tem `tenant_id` e `empresa_id` | **Exagerado.** O risco real é ter anexo órfão, não vazamento |
| Correção do anexo com `@@unique([orcamento_id])` | 2º | — | **Errado e perigoso:** permitiria um único anexo por orçamento |
| Falta `categoria_financeira` | 2º | Existe o enum `CategoriaFinanceira` | **Falso** |
| Orçamento precisa de número de versão | 2º | `versao` já existe | **Falso.** Falta a regra, não o campo (ver §4.3) |
| Ratear frete por job assíncrono | 2º | — | **Ruim:** deixa o custo médio errado até o job rodar. O rateio deve ser síncrono, no recebimento |
| Estoque por *materialized view* | 2º | — | **Ruim:** a disponibilidade na hora da OS precisa ser exata |
| Abandonar RLS e usar só filtro no Prisma, ou um schema por tenant | 2º | — | **Discordamos.** As duas camadas se complementam (§4.5) |
| RLS vaza com PgBouncer em modo *transaction pooling* | 3º | O desenho usa `set_config(..., true)` dentro da transação | **Só vale para `SET` de sessão.** O contexto local da transação é seguro com esse pool. Ainda assim, mantemos as duas camadas |
| Snippet com `Serializable` "bloqueando a linha" | 3º | — | **Errado:** `findUnique` do Prisma não faz `FOR UPDATE` |
| Snippet de extensão injetando `where` em tudo | 3º | — | **Quebra:** `create` não tem `where`. Precisa tratar cada operação e preencher `data.tenant_id` |
| Separar `lead` e `cliente` em tabelas diferentes | 3º | — | **Discordamos:** volta à conversão com cópia; os outros dois agentes defendem manter unificado |
| Particionar `audit_log` e `notificacao` já | 3º | — | **Prematuro.** O UUIDv7 permite particionar depois |
| OS sem unicidade com o orçamento (risco de 2 OS) | 1º | `orcamento_id` já é `@unique` | **Já resolvido** |
| Estorno aplicado duas vezes | 1º | `movimento_estornado_id` já é `@unique` | **Já resolvido** |
| Outbox sem tentativas nem id do provedor | 1º | `tentativas`, `provedor_msg_id` e índice existem | **Já resolvido.** Falta só a chave de deduplicação |

**Lacunas reais confirmadas no schema v0.1:**

- **Nenhuma FK composta tenant/empresa.** Uma OS da empresa A pode apontar para um dispositivo da empresa B.
- **`estoque_atual` e `custo_medio` existem como cache, mas sem protocolo de atualização atômica.**
- **O dedupe de contato usa índice comum.** O índice parcial único ficou apenas num comentário do schema.
- **`Idempotency-Key` não tem onde ser guardado**, exceto em `captura_lead` e `job_lote`.
- **Não há trava otimista** (`versao_registro`) em OS e orçamento.
- **`notificacao` não tem chave de deduplicação.**
- **Não há regra de imutabilidade do orçamento depois de ENVIADO.**
- **`ciclo_vida` é editável à mão**, quando deveria ser derivado dos negócios (crítica correta do 1º agente).
- **Não há anonimização LGPD** nem termo de responsabilidade.

---

## 3. Visão consolidada

O 1º agente tem o diagnóstico certo: o risco não é o número de tabelas, é ter regras de negócio sem
garantia. O 2º e o 3º acertam em cortes pontuais, mas propõem trocar segurança do banco por
disciplina de código, o que é pior.

Não adiamos a temperatura e a próxima ação para depois do MVP: foram pedidas explicitamente e são o
que diferencia o produto. A saída é entregar **as funcionalidades, mas não os motores configuráveis**:

- regras fixas no código, versionadas e testáveis;
- com explicação ("por que este lead está quente");
- construídas por último na ordem de implementação.

**Princípios do MVP**

1. **Uma jornada completa e confiável** (lead → orçamento → OS → entrega → recebimento) vale mais que muitos módulos rasos.
2. **O banco garante o que for possível:** FKs compostas, CHECK, índices únicos parciais, RLS. O código cuida do resto.
3. **Toda operação crítica é um comando de domínio transacional e idempotente.** Os endpoints não alteram tabelas diretamente.
4. **Configuração só depois de evidência.** Na v1, regras no código; tabelas de regra na v2.

---

## 4. Proposta final do MVP

### 4.1 Escopo

| Módulo | MVP | P1 (logo após) | P2 |
|---|---|---|---|
| Plataforma | Tenant/empresa, auth, membros, RBAC com papéis padrão, audit log, API key, idempotência | Editor de papéis customizados | SSO, 2FA |
| CRM | Contato unificado, captura (site/API/CSV) com dedupe, funil padrão com requisitos ("o que falta"), atividades, tarefas, motivo de perda, consentimento | Múltiplos funis, tags, segmentações | Scoring e próxima ação configuráveis ou com ML |
| Inteligência | Temperatura, quadrante, completude e fila de próximas ações por **regras no código**, com explicação | Ajuste de pesos por empresa (JSON em `empresa.config`) | Tabelas de regras e IA |
| APIs de lead | Criar, atualizar e excluir individual e em massa; importação CSV via `job_lote` | — | Webhooks de saída |
| Orçamento | Versões imutáveis após envio, itens opcionais, aprovação por link, expiração, conversão idempotente | Assinatura eletrônica | — |
| Bancada | OS com ou sem orçamento, Kanban, técnico, prazo, checklist de entrada/saída (JSON), acessórios, fotos, notas, garantia/retorno, termo de responsabilidade | Agenda e capacidade de técnicos | — |
| Dispositivos | Cadastro com specs em JSONB, histórico de posse, prontuário, busca por IMEI/serial | Catálogo de modelos e compatibilidade de peças | — |
| Estoque | Item (nome, qtd, descrição, preço de compra/venda, fornecedor, categoria em texto), "Comprei" (compra com frete rateado), baixa ao aplicar peça, ajuste, devolução, estorno, custo médio, estoque mínimo | Reservas, venda de balcão | Depósitos, lote/serial |
| Financeiro | Contas a receber por OS (sinal e parcelas), contas a pagar por compra, pagamentos e estornos, margem por OS | **Caixa diário** | Conciliação, fiscal, ERPNext |
| Notificações | WhatsApp, e-mail e SMS por preferência; modelos por evento; outbox com dedupe | Inbox de WhatsApp | Chatbot |

### 4.2 Mudanças no schema (v0.1 → v0.2-MVP)

**Ficam fora do MVP (19 tabelas):**

- **Inteligência configurável:** `regra_pontuacao`, `evento_pontuacao`, `regra_proxima_acao`, `sugestao_acao`.
- **Tags:** `tag`, `entidade_tag`.
- **Dispositivos e checklists:** `modelo_dispositivo`, `dispositivo_celular`, `dispositivo_computador`, `checklist_modelo_item`, `inspecao_resposta`.
- **Estoque e vendas:** `categoria_item`, `item_compatibilidade`, `historico_preco` (o `audit_log` cobre), `reserva_estoque`, `venda`, `venda_item`.
- **Integração e configuração:** `integracao_ref`, `config_notificacao_evento` (o campo `ativo` do `modelo_mensagem` cobre).

**Fusão:** `apontamento_os` passa a ser `atividade` com tipo `NOTA_TECNICA` e `minutos`.

**Entram:** `idempotencia_requisicao` e os campos do termo de responsabilidade na `inspecao`.

**Resultado:** 49 tabelas, com o núcleo intacto.

Alterações estruturais:

```prisma
// (a) FK composta: impede referência cruzada entre empresas
model Contato {
  // ...
  @@unique([empresa_id, id])
}
model OrdemServico {
  empresa_id     String @db.Uuid
  contato_id     String @db.Uuid
  dispositivo_id String @db.Uuid
  contato     Contato     @relation(fields: [empresa_id, contato_id],     references: [empresa_id, id])
  dispositivo Dispositivo @relation(fields: [empresa_id, dispositivo_id], references: [empresa_id, id])
  versao_registro Int @default(0) // trava otimista
}
// Mesmo padrão em: orcamento, negocio, inspecao, os/orcamento_item→item,
// movimento_estoque→item, titulo→os/compra, notificacao→contato.
// Empresa ganha @@unique([tenant_id, id]) e as tabelas filhas referenciam (tenant_id, empresa_id).

// (b) Idempotência genérica
model IdempotenciaRequisicao {
  tenant_id     String   @db.Uuid
  chave         String
  rota          String
  hash_payload  String
  status_http   Int?
  resposta      Json?
  criado_em     DateTime @default(now())
  expira_em     DateTime
  @@id([tenant_id, chave])
}

// (c) Dispositivo: specs em JSONB (validado por Zod no tipo); campos pesquisáveis continuam colunas
model Dispositivo {
  // tipo, marca, modelo, numero_serie, imei, imei_2, cor ...
  especificacoes Json @default("{}")
  // desbloqueio_cifrado REMOVIDO (ver §4.4)
}

// (d) Contato: ciclo_vida derivado (só o serviço escreve) + LGPD
model Contato {
  score_motivos  Json      @default("[]") // explicação do score
  anonimizado_em DateTime?
}

// (e) Notificação: sem referência genérica + deduplicação
model Notificacao {
  orcamento_id String? @db.Uuid
  os_id        String? @db.Uuid
  negocio_id   String? @db.Uuid
  chave_dedupe String  // ex.: "OS_STATUS_ALTERADO:<os_id>:<historico_id>:<canal>"
  @@unique([empresa_id, chave_dedupe])
  @@unique([provedor, provedor_msg_id])
}

// (f) Anexo: FKs concretas, exatamente uma preenchida
model Anexo {
  contato_id     String? @db.Uuid
  orcamento_id   String? @db.Uuid
  os_id          String? @db.Uuid
  dispositivo_id String? @db.Uuid
  compra_id      String? @db.Uuid
}
```

Migração SQL complementar:

```sql
ALTER TABLE anexo ADD CONSTRAINT anexo_um_alvo
  CHECK (num_nonnulls(contato_id, orcamento_id, os_id, dispositivo_id, compra_id) = 1);

CREATE UNIQUE INDEX contato_email_uq ON contato (empresa_id, email_normalizado)
  WHERE deleted_at IS NULL AND email_normalizado IS NOT NULL;
CREATE UNIQUE INDEX contato_fone_uq  ON contato (empresa_id, telefone_e164)
  WHERE deleted_at IS NULL AND telefone_e164 IS NOT NULL;

ALTER TABLE item ADD CONSTRAINT item_estoque_nao_negativo CHECK (estoque_atual >= 0);
```

O `audit_log` continua com referência genérica: só recebe inserções, é lido apenas pela API e já
carrega `empresa_id`. É o único caso em que a referência genérica se justifica.

### 4.3 Regras invariantes e transações

**Estoque.** O ledger é a fonte da verdade. O cache em `item` só muda na mesma transação do
movimento, por UPDATE condicional (a própria linha atualizada serializa a concorrência, sem
`SERIALIZABLE`):

```sql
-- saída (aplicar peça): 0 linhas = saldo insuficiente → erro 409
UPDATE item SET estoque_atual = estoque_atual - $q
WHERE id = $item AND empresa_id = $emp AND estoque_atual >= $q
RETURNING estoque_atual, custo_medio;

-- entrada (compra recebida): custo médio móvel calculado com os valores antigos
UPDATE item SET
  custo_medio   = (estoque_atual * custo_medio + $valor_total) / (estoque_atual + $q),
  estoque_atual = estoque_atual + $q
WHERE id = $item AND empresa_id = $emp
RETURNING estoque_atual, custo_medio;
-- em seguida, na mesma transação: INSERT em movimento_estoque com saldo_apos / custo_medio_apos
```

- Um job noturno compara a soma do ledger com o cache e alerta divergências.
- Sem lançamentos retroativos; correção só por estorno.
- O frete é rateado proporcionalmente ao valor dos itens no recebimento, de forma síncrona.

**Orçamento**

- Depois de ENVIADO, fica imutável. Qualquer alteração cria uma nova versão e cancela a anterior.
- A aprovação vale para aquela linha (aquela versão). O link de uma versão cancelada não aprova nada.
- A conversão é `aprovar → criar OS` numa transação. `ordem_servico.orcamento_id @unique` mais a `Idempotency-Key` garantem uma única OS.
- **Regra de negócio:** 1 orçamento gera 1 OS. Na aprovação parcial, vão para a OS só os itens aprovados.

**OS**

- As transições ficam numa tabela de estados no código.
- Cada transição grava o histórico e, se aplicável, a notificação, tudo na mesma transação.
- `ENTREGUE` exige inspeção de saída e peças com status final, e calcula a garantia.
- OS de garantia nasce com total zero por padrão. As peças saem como custo de garantia, ligadas à OS de origem.
- `versao_registro` evita que uma edição sobrescreva outra em silêncio.

**Financeiro**

- Cada OS tem um título a receber criado na abertura ou na aprovação. O sinal é um `pagamento` nesse título.
- A receita gerencial é reconhecida em `ENTREGUE`, sem documento de venda no MVP.
- Compra recebida gera título a pagar.
- Estorno de pagamento é um novo registro, nunca DELETE.

### 4.4 Decisões para as perguntas em aberto (aprovadas)

| Pergunta | Proposta |
|---|---|
| Guardar senha de desbloqueio? | **Não.** O cliente remove o bloqueio ao entregar o dispositivo; a inspeção de entrada registra isso e o termo de responsabilidade explica a política |
| Clientes compartilhados entre empresas do tenant? | Não (escopo por CNPJ). Sem transferência de estoque entre empresas |
| Estoque negativo? | Não (CHECK). Peça faltante vira `A_COMPRAR` |
| Custeio | Custo médio ponderado móvel por empresa, para gestão e não para o fiscal |
| Lead excluído que volta | Se não foi anonimizado, **restaurar e mesclar**, não duplicar. Se foi anonimizado, cria um novo |
| LGPD: pedido de exclusão | Anonimizar o contato (zera nome, documento e contatos; mantém o UUID para o ledger financeiro) |
| Caixa diário | P1, a menos que o primeiro cliente receba muito em dinheiro |

### 4.5 Segurança multi-tenant (defesa em camadas)

1. **FKs compostas** (§4.2a): impossível ligar dados de empresas diferentes.
2. **RLS** com `set_config('app.tenant_id', $1, true)` no início de cada transação, via extensão do Prisma no padrão de transação em lote (padrão documentado pelo Prisma):
   - o usuário da aplicação no banco não é dono das tabelas e não tem `BYPASSRLS`;
   - sem contexto definido, nenhuma linha é visível;
   - workers recebem `tenant_id`/`empresa_id` no payload do job e passam pela mesma extensão.
3. **Escopo de empresa e papel na aplicação:** `X-Empresa-Id` é validado contra as atribuições do membro. Custos são removidos da resposta da API quando falta a permissão `financeiro.ver_custos`.
4. **Testes negativos obrigatórios:** acesso cruzado por id, filtro, FK, update, delete, lote e job.

### 4.6 Ordem de implementação (com critério de saída)

| Fase | Entrega | Pronto quando |
|---|---|---|
| 0. Domínio | Schema v0.2, tabelas de estado, documento de regras invariantes, decisões da §4.4 | Fluxos e exceções descritos sem ambiguidade |
| 1. Fundação | Monorepo, auth, tenant/empresa, RBAC, RLS e FKs compostas, audit, idempotência, CI com Testcontainers | Suite de isolamento passando |
| 2. Jornada | Contato, negócio, funil e requisitos, orçamento (versões, link, conversão), OS e bancada, dispositivo e prontuário, checklist e termo | Um atendimento completo sem estados inválidos nem duplicação, incluindo OS direto na bancada e retorno em garantia |
| 3. Estoque e financeiro | Compra, baixa, ajuste, estorno, títulos, pagamentos, margem | Testes de concorrência na última peça, estorno repetido e reconciliação do ledger passando |
| 4. Comunicação e inteligência | Outbox e provedores, modelos, temperatura, quadrante, completude, fila de próximas ações, dashboards, APIs em massa e CSV | Cada indicador explicável; webhook duplicado não duplica nada |

### 4.7 Testes que viram critério de aceite

| Teste | Resultado esperado |
|---|---|
| Dois tenants acessam o mesmo id de recurso | O tenant não autorizado não obtém acesso |
| Duas requisições aprovam o mesmo orçamento ao mesmo tempo | Uma única OS é criada |
| Duas OS consomem a última unidade de uma peça | Uma consegue, a outra recebe 409; saldo e ledger consistentes |
| Operação falha depois de criar parte dos registros | Transação revertida por inteiro |
| Estorno repetido | O movimento original não é revertido duas vezes |
| Cliente aprova uma versão antiga do orçamento | Aprovação recusada |
| OS de garantia | Ligada à OS original, total zero, peças como custo de garantia |
| Webhook de notificação recebido duas vezes | Estado processado uma única vez |
| Lote com linhas válidas e inválidas | Resultado por linha conforme a política documentada |
| Membro sem permissão consulta custos | Campo ausente na resposta da API |
| Job executado sem contexto HTTP | Tenant e empresa definidos antes de qualquer query |
| Cache de estoque diverge do ledger | Divergência detectada pela reconciliação |
| Pedido de exclusão LGPD | Dados pessoais anonimizados; ledgers preservados |

---

## 5. Situação

- Decisões da §4.4 aprovadas.
- Schema v0.2-MVP em [`schema.prisma`](./schema.prisma) (v0.1 em [`historico/`](./historico/schema-v0.1.prisma)).
- Regras, estados e comandos em [`invariantes.md`](./invariantes.md); constraints e RLS em
  [`sql/complemento-v0.2.sql`](./sql/complemento-v0.2.sql), testadas por
  [`sql/testes-invariantes.sh`](./sql/testes-invariantes.sh).
