# ebisuCRM — Regras invariantes, estados e comandos de domínio (v0.2-MVP)

> Complementa [`schema.prisma`](../packages/db/prisma/schema.prisma) e [`consolidacao-revisoes.md`](./consolidacao-revisoes.md).
> Cada regra tem um identificador (ex.: `EST-2`) e diz **quem garante**:
>
> - **Banco** — constraint, índice, trigger ou RLS na [migração inicial](../packages/db/prisma/migrations/20261027000000_inicial/migration.sql),
>   coberta por [`sql/testes-invariantes.sh`](./sql/testes-invariantes.sh).
> - **Domínio** — comando transacional no backend (NestJS), coberto por testes de integração.
>
> Regra geral: **endpoints nunca alteram tabelas diretamente**; chamam um comando de domínio que
> roda numa única transação, valida pré-condições, aplica os efeitos e grava histórico,
> notificação (outbox) e audit log juntos.

---

## 1. Decisões de negócio aprovadas

| Tema | Decisão |
|---|---|
| Orçamento × OS | 1 orçamento gera no máximo 1 OS. Na aprovação parcial, só os itens aprovados vão para a OS |
| Desbloqueio do aparelho | **O cliente remove o bloqueio ao entregar o dispositivo.** O sistema não guarda senha, PIN, padrão ou biometria. A inspeção de entrada registra `bloqueio_removido` ou justifica a exceção (ex.: "aparelho não liga") |
| Clientes entre empresas | Não são compartilhados (escopo por CNPJ). Sem transferência de estoque entre empresas |
| Estoque negativo | Proibido. Peça sem saldo fica `A_COMPRAR` |
| Custeio | Custo médio ponderado móvel por empresa, para gestão (não fiscal) |
| Lead excluído que volta | Se não foi anonimizado, é restaurado e mesclado; se foi anonimizado, cria um novo |
| Exclusão LGPD | Anonimizar o contato; UUID preservado para ledgers e financeiro |
| Caixa diário | P1 |

---

## 2. Segurança e isolamento

| ID | Regra | Garantia |
|---|---|---|
| SEG-1 | Nenhuma linha de outro tenant é lida ou gravada | **Banco:** RLS `FORCE` em todas as tabelas com `tenant_id` e nas filhas (via pai). Sem `app.tenant_id`, nada é visível |
| SEG-2 | Nenhuma referência liga registros de empresas diferentes | **Banco:** FKs compostas `(tenant_id, empresa_id)` → empresa e `(empresa_id, x_id)` → x |
| SEG-3 | Membro só acessa empresas atribuídas a ele | **Domínio:** `X-Empresa-Id` validado contra `atribuicao_papel` em todo request; jobs carregam `empresa_id` no payload |
| SEG-4 | Escopo PROPRIO limita a registros em que o membro é responsável/técnico | **Domínio:** filtro aplicado no repositório por permissão |
| SEG-5 | Custos (`custo_*`, margem) só aparecem com `financeiro.ver_custos` | **Domínio:** removidos do DTO de resposta, não só ocultos no front |
| SEG-6 | Aplicação conecta com papel sem ownership e sem `BYPASSRLS`; contexto via `set_config('app.tenant_id', $1, true)` no início de cada transação | **Infra** + teste de isolamento no CI |
| SEG-7 | Toda operação crítica aceita `Idempotency-Key`; repetição devolve a mesma resposta | **Domínio** + tabela `idempotencia_requisicao` |
| SEG-8 | `audit_log` não grava valores de dados pessoais (só nomes dos campos alterados) | **Banco:** trigger `auditar()` nas tabelas de negócio grava só os nomes das colunas; autor e requisição vêm do contexto da transação (`comTenant`). Permite anonimizar sem tocar no log append-only |

---

## 3. CRM

| ID | Regra | Garantia |
|---|---|---|
| CRM-1 | Contato tem ao menos um meio de contato (exceto anonimizado) e é único por e-mail, telefone e WhatsApp na empresa, ignorando excluídos | **Banco:** `contato_meio_contato_ck` + índices únicos parciais |
| CRM-2 | `ciclo_vida` é derivado, nunca editado: LEAD → LEAD_QUALIFICADO (requisitos da Qualificação atendidos) → OPORTUNIDADE (orçamento enviado) → CLIENTE (1ª OS) → RECORRENTE (2ª OS); INATIVO após 12 meses sem interação | **Domínio:** recalculado pelos comandos que mudam negócio/orçamento/OS |
| CRM-3 | Negócio só avança de etapa com os requisitos obrigatórios da etapa atual atendidos | **Domínio:** `MoverNegocio` |
| CRM-4 | Negócio PERDIDO exige motivo; GANHO/PERDIDO exige `fechado_em` | **Banco:** CHECKs |
| CRM-5 | Uma empresa tem exatamente um funil padrão | **Banco:** índice parcial + seed |
| CRM-6 | Scores, temperatura, quadrante, completude e `campos_faltantes` só são escritos pelo serviço de scoring; `score_motivos` explica cada ponto | **Domínio** |

### 3.1 Scoring e próxima ação (regras no código, MVP)

- Executado de forma síncrona após os comandos que mudam o contato, o negócio ou o orçamento, e por um job diário (decaimento).
- **Fit (0–50)** a partir dos dados; **engajamento (0–50)** a partir de `captura_lead`, `atividade` e datas do orçamento (`enviado_em`, `visualizado_em`), com meia-vida calculada na hora.
- Temperatura: ≥ 70 QUENTE, 40–69 MORNO, < 40 FRIO. Quadrante com corte 25/25.
- **Fila de próximas ações** é uma consulta, não uma tabela: aplica as regras da §3.3 do README sobre negócios abertos, orçamentos e OS. "Aceitar" cria `tarefa` (origem PROXIMA_ACAO); "lembrar depois" grava `nba_adiada_ate`.
- Pesos e regras ficam versionados no código (`score_regras_versao`); ajuste por empresa entra no P1 via `empresa.config`.

### 3.2 Comandos

| Comando | Pré-condições | Efeitos (mesma transação) |
|---|---|---|
| `CapturarLead` | API key com escopo; idempotency key | Normaliza e-mail/telefone; dedupe (CRM-1): contato existente → mescla, excluído não anonimizado → restaura; cria `captura_lead`; cria negócio na etapa 1 se houver interesse; recalcula score |
| `MoverNegocio` | CRM-3; `versao_registro` confere | Atualiza etapa; `historico_etapa_negocio`; cria tarefas dos requisitos TAREFA da nova etapa; CRM-2 |
| `PerderNegocio` | Motivo informado | Status PERDIDO, `fechado_em`; cancela tarefas pendentes |
| `AnonimizarContato` | Permissão `lgpd.anonimizar`; sem OS em aberto | Zera nome, documento, contatos, endereço, observações; `anonimizado_em`; audit |

---

## 4. Dispositivos e inspeção

| ID | Regra | Garantia |
|---|---|---|
| DSP-1 | `especificacoes` segue o schema Zod do tipo do dispositivo | **Domínio** |
| DSP-2 | No máximo um proprietário vigente por dispositivo; troca encerra o anterior (`ate`) e grava `TROCA_PROPRIETARIO` | **Banco** (índice parcial) + **Domínio** |
| DSP-3 | Acessório pertence a um orçamento **ou** a uma OS | **Banco:** CHECK |
| DSP-4 | Inspeção está ligada a orçamento e/ou OS | **Banco:** CHECK |
| DSP-5 | Na inspeção de ENTRADA o cliente remove o bloqueio (`bloqueio_removido = true`) ou a exceção é justificada (`bloqueio_observacao`) | **Banco:** CHECK |
| DSP-6 | Inspeção congela o checklist usado (`itens_snapshot`); respostas obrigatórias preenchidas | **Domínio** |
| DSP-7 | Prontuário (`dispositivo_evento`) é append-only e não guarda dados pessoais | **Banco:** trigger + **Domínio** |
| ANX-1 | Anexo pertence a exatamente uma entidade | **Banco:** CHECK |

**Termo de responsabilidade:** registrado na inspeção de ENTRADA (`termo_versao`, `termo_aceito_em`, `termo_aceito_por`, `termo_canal`). O texto do termo inclui a política de bloqueio: o cliente entrega o aparelho sem bloqueio e reativa a proteção na retirada; a loja não solicita nem armazena senhas.

---

## 5. Orçamento

### 5.1 Estados

```
RASCUNHO ──enviar──▶ ENVIADO ──cliente abre link──▶ VISUALIZADO
   │                    │                               │
   │                    ├──aprovar / aprovar parcial────┤──▶ APROVADO | APROVADO_PARCIAL ──converter──▶ CONVERTIDO
   │                    ├──reprovar─────────────────────┤──▶ REPROVADO
   │                    ├──job diário (validade)────────┤──▶ EXPIRADO
   │                    └──revisar (nova versão)────────┘──▶ CANCELADO  (nova linha versao+1 em RASCUNHO)
   └──cancelar──▶ CANCELADO
```

### 5.2 Regras

| ID | Regra | Garantia |
|---|---|---|
| ORC-1 | Uma única versão não cancelada por número | **Banco:** índice parcial |
| ORC-2 | Depois de ENVIADO, itens e valores são imutáveis; só a decisão item a item (`aprovado`) muda | **Banco:** triggers |
| ORC-3 | Aprovação só vale para a versão do link (`token_publico`) e enquanto ENVIADO/VISUALIZADO e dentro da validade | **Domínio** |
| ORC-4 | Aprovação registra `decidido_em`, `decidido_via`, `decisao_evidencia`; parcial grava `total_aprovado` | **Domínio** |
| ORC-5 | Conversão é idempotente e cria no máximo 1 OS | **Banco:** unique `(empresa_id, orcamento_id)` na OS + **Domínio:** idempotency key |
| ORC-6 | Quantidade > 0 e valores ≥ 0 | **Banco:** CHECK |

### 5.3 Comandos

| Comando | Pré-condições | Efeitos |
|---|---|---|
| `EnviarOrcamento` | RASCUNHO; ao menos 1 item; total calculado | ENVIADO, `enviado_em`; histórico; notificação ORCAMENTO_ENVIADO; negócio → etapa "Orçamento enviado"; CRM-2 |
| `RevisarOrcamento` | ENVIADO/VISUALIZADO | Atual → CANCELADO; nova linha `versao+1` em RASCUNHO copiando itens e `orcamento_pai_id`; novo token |
| `DecidirOrcamento` | ORC-3 | APROVADO/APROVADO_PARCIAL/REPROVADO; histórico; notificação; se aprovado executa `ConverterOrcamento` na mesma transação |
| `ConverterOrcamento` | APROVADO/APROVADO_PARCIAL; dispositivo definido | Cria OS (status AGUARDANDO_PECAS ou EM_DIAGNOSTICO) com os itens aprovados; título a receber (FIN-1); orçamento CONVERTIDO; negócio GANHO; CRM-2; evento ORCAMENTO no prontuário |
| `ExpirarOrcamentos` (job) | Validade vencida | EXPIRADO; histórico; sem notificação (o lembrete sai antes, ORCAMENTO_EXPIRANDO) |

---

## 6. Bancada (OS)

### 6.1 Estados

```
ABERTA → EM_DIAGNOSTICO → AGUARDANDO_APROVACAO → AGUARDANDO_PECAS → EM_REPARO → EM_TESTES → PRONTA → ENTREGUE
                 ▲                  │                     │              ▲  │
                 └──────────────────┘ (nova análise)      └──────────────┘  └→ (falhou no teste) EM_REPARO
Qualquer estado antes de ENTREGUE → CANCELADA | SEM_REPARO
```

| De → Para | Condição |
|---|---|
| ABERTA → EM_DIAGNOSTICO | Inspeção de ENTRADA registrada (com DSP-5 e termo) |
| EM_DIAGNOSTICO → AGUARDANDO_APROVACAO | OS sem orçamento aprovado e com valor a aprovar (gera orçamento a partir da OS) |
| → AGUARDANDO_PECAS | Existe item `A_COMPRAR` |
| → EM_REPARO | Técnico definido (OS-3); peças necessárias com saldo |
| EM_REPARO → EM_TESTES | Peças da OS APLICADAS ou removidas |
| EM_TESTES → PRONTA | Inspeção de SAÍDA registrada |
| PRONTA → ENTREGUE | `EntregarOS` |

### 6.2 Regras

| ID | Regra | Garantia |
|---|---|---|
| OS-1 | 1 orçamento → no máximo 1 OS | **Banco** |
| OS-2 | Transições só pelo comando `MudarStatusOS`, conforme a tabela 6.1; cada uma grava `os_status_historico` e, se configurado, notificação com `chave_dedupe` = id do histórico | **Domínio** |
| OS-3 | EM_REPARO e EM_TESTES exigem técnico (corrige o bug "Em Andamento" do Ogun) | **Banco:** CHECK |
| OS-4 | Edição concorrente: `UPDATE … WHERE versao_registro = $v` (0 linhas → 409) | **Domínio** |
| OS-5 | ENTREGUE exige `entregue_em` | **Banco:** CHECK |
| OS-6 | Entrega: inspeção de SAÍDA, nenhuma peça PENDENTE/A_COMPRAR, acessórios devolvidos, garantia calculada | **Domínio** |
| OS-7 | OS de GARANTIA aponta a OS de origem; total padrão zero; peças saem como custo de garantia | **Banco** (origem) + **Domínio** |
| OS-8 | CANCELADA/SEM_REPARO devolvem ao estoque as peças APLICADAS (`DEVOLUCAO_CLIENTE`) e cancelam o título se não houver pagamento (com pagamento → estorno antes) | **Domínio** |

### 6.3 Comandos

| Comando | Efeitos |
|---|---|
| `AbrirOS` (bancada) | Número via `sequencia_documento`; inspeção de ENTRADA; acessórios; título a receber; evento ENTRADA no prontuário; notificação OS_ABERTA; contato vira CLIENTE se for a 1ª OS |
| `AplicarPeca` | EST-6; movimento SAIDA_OS com `chave_operacao = SAIDA_OS:<os_item_id>`; item APLICADA com `custo_unitario`; `custo_total` da OS; evento PECA_SUBSTITUIDA |
| `MudarStatusOS` | OS-2/3/4 |
| `EntregarOS` | OS-6; ENTREGUE; `entregue_em`, `entregue_a`, `garantia_ate`; evento SAIDA; receita gerencial reconhecida; notificação OS_ENTREGUE; `ltv` do contato |

---

## 7. Estoque

| ID | Regra | Garantia |
|---|---|---|
| EST-1 | Saldo nunca negativo; serviço não tem estoque | **Banco:** CHECKs |
| EST-2 | Cada efeito de negócio gera no máximo um movimento (`chave_operacao`) | **Banco:** unique |
| EST-3 | Sinal da quantidade coerente com o tipo; ESTORNO aponta o original | **Banco:** CHECK |
| EST-4 | Ledger append-only | **Banco:** trigger |
| EST-5 | Um movimento é estornado no máximo uma vez | **Banco:** unique |
| EST-6 | Saldo e custo médio do `item` mudam na mesma transação do movimento, por UPDATE condicional (o lock da linha serializa a concorrência) | **Domínio** (padrão abaixo) + teste de concorrência |
| EST-7 | Frete e despesas da compra são rateados proporcionalmente ao valor dos itens no recebimento (`custo_unitario_final`) | **Domínio** |
| EST-8 | Reconciliação noturna: `SUM(movimento.quantidade)` = `item.estoque_atual`; divergência gera alerta | **Job** |

```sql
-- Saída (AplicarPeca): 0 linhas = saldo insuficiente → 409 e item vira A_COMPRAR
UPDATE item SET estoque_atual = estoque_atual - $q, updated_at = now()
WHERE id = $item AND empresa_id = $emp AND estoque_atual >= $q
RETURNING estoque_atual, custo_medio;

-- Entrada (ReceberCompra): custo médio móvel usando os valores anteriores
UPDATE item SET
  custo_medio   = (estoque_atual * custo_medio + $valor_total) / (estoque_atual + $q),
  estoque_atual = estoque_atual + $q,
  preco_compra  = $custo_unitario,
  updated_at    = now()
WHERE id = $item AND empresa_id = $emp
RETURNING estoque_atual, custo_medio;

-- Em seguida, na mesma transação: INSERT em movimento_estoque com saldo_apos e custo_medio_apos.
```

| Comando | Efeitos |
|---|---|
| `ReceberCompra` | EST-7; para cada item: entrada (EST-6) + movimento `ENTRADA:<compra_item_id>`; compra RECEBIDA; título(s) a pagar |
| `AjustarEstoque` | Motivo obrigatório; AJUSTE_ENTRADA/AJUSTE_SAIDA/PERDA (saída usa o custo médio atual) |
| `EstornarMovimento` | Movimento ESTORNO com quantidade oposta; recalcula saldo; estorno de entrada é recusado se o saldo atual não comportar |

---

## 8. Financeiro (gerencial)

| ID | Regra | Garantia |
|---|---|---|
| FIN-1 | Um título a receber ativo por OS; sinal e parcelas são pagamentos nesse título | **Banco:** índice parcial |
| FIN-2 | `0 ≤ valor_pago ≤ valor`; status ABERTO/PARCIAL/PAGO derivado de `valor_pago` | **Banco:** CHECK + **Domínio** |
| FIN-3 | Pagamento positivo; estorno é nova linha negativa ligada ao original (no máximo um estorno por pagamento) | **Banco:** CHECK + unique |
| FIN-4 | Pagamentos são append-only | **Banco:** trigger |
| FIN-5 | Valor do título acompanha o total da OS enquanto não ENTREGUE; após a entrega, só por ajuste auditado | **Domínio** |
| FIN-6 | Receita gerencial = OS ENTREGUE no período; margem = total − `custo_total` − taxas dos pagamentos | **Relatório** |

| Comando | Efeitos |
|---|---|
| `RegistrarPagamento` | Lock do título (`SELECT … FOR UPDATE`); pagamento; `valor_pago` e status; idempotency key |
| `EstornarPagamento` | Linha ESTORNO negativa; `valor_pago` e status recalculados |

---

## 9. Notificações

| ID | Regra | Garantia |
|---|---|---|
| NOT-1 | Notificação é gravada na mesma transação do evento (outbox) | **Domínio** |
| NOT-2 | Um evento gera no máximo uma notificação por canal (`chave_dedupe`) | **Banco:** unique |
| NOT-3 | Webhook do provedor é idempotente (`provedor`, `provedor_msg_id`) e só avança o status (ENVIADA → ENTREGUE → LIDA) | **Banco** + **Domínio** |
| NOT-4 | Canal = `canal_preferido` com consentimento TRANSACIONAL vigente; falha definitiva → próximo canal permitido | **Domínio** |
| NOT-5 | WhatsApp fora da janela de 24h usa `whatsapp_template` aprovado; sem template → próximo canal | **Domínio** |
| NOT-6 | Worker: retry com backoff exponencial (máx. 5) e `SELECT … FOR UPDATE SKIP LOCKED` para não enviar em dobro | **Domínio** |

---

## 10. Operações em massa

| ID | Regra |
|---|---|
| LOT-1 | Até 500 linhas: síncrono, cada linha na sua transação, resposta 207 com resultado por linha |
| LOT-2 | Acima de 500 ou CSV: `job_lote` + 202; mesma política por linha; erros em `job_lote.erros` |
| LOT-3 | `idempotency_key` do lote é única por empresa; reprocessar o job não duplica (dedupe CRM-1 + chave por linha) |
| LOT-4 | Exclusão em massa é soft delete e exige `lead.bulk_delete`; atualização em massa respeita CRM-2/CRM-6 (campos derivados não são aceitos no patch) |

---

## 11. Como testar

- **Regras do banco:** `docs/sql/testes-invariantes.sh` — 35 casos (RLS, FK composta, dedupe, bloqueio na entrada, imutabilidade do orçamento, OS, estoque com concorrência na última peça, financeiro). Rodar no CI contra Postgres 16 após cada migração.
- **Regras de domínio:** testes de integração (Testcontainers) por comando, cobrindo a lista da §4.7 de `consolidacao-revisoes.md`.
