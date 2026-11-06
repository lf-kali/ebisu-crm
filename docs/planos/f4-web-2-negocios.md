# F4 · Web 2: quadro de negócios, ficha do negócio, tarefas e timeline

STATUS: APPROVED (usuário, 2026-11-06)

Tela intercalada depois dos PRs 2a e 2b da API. Ela foi dividida em dois PRs (usuário,
2026-11-06):

- **Este:** o quadro, a ficha do negócio, as tarefas e as atividades, que aparecem na ficha do
  negócio e na do contato.
- **O próximo:** Configurações › CRM, com o editor do funil e dos requisitos, as origens e os
  motivos de perda.

## Objetivo

- Em `/negocios`, quem tem `negocio.read` vê os negócios abertos em colunas por etapa, com o "o
  que falta" de cada um.
- O negócio muda de etapa pelo botão "Mover para…", no cartão e na ficha (usuário, 2026-11-06).
  Arrastar fica para depois.
- A ficha do negócio mostra os requisitos da etapa e permite mover, perder, nutrir, editar e
  excluir. Também lista e mexe nas tarefas e na timeline.
- A ficha do contato ganha os negócios, as tarefas e a timeline dele.

## Fora deste PR

- Configurações › CRM (o próximo PR).
- Arrastar e soltar no quadro.
- Painel do CRM, fila de próximas ações e scores (F11).
- Ganho pela conversão do orçamento (F6).

## Decisões

| #   | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Origem                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | **Rotas:** <ul><li>`/negocios`: o quadro;</li><li>`/negocios/$id`: a ficha;</li><li>a ficha do contato (`/contatos/$id`) ganha as seções Negócios, Tarefas e Timeline.</li></ul> Os filtros do quadro (responsável, `?q=` no título) ficam na URL, como na lista de contatos                                                                                                                                                                                                                                                                                                                                                                                                | spec §4 F13-CRM        |
| 2   | **Quadro:** <ul><li>Uma coluna por etapa ABERTA, na ordem do funil (`GET /v1/funil`). Cada coluna carrega os negócios ABERTO dela, 25 por vez, com "Carregar mais".</li><li>O cartão mostra título, contato, valor estimado, responsável, tempo na etapa e uma barra de completude com o percentual. A lista da API não traz os requisitos de cada negócio, então a contagem do que falta fica só na ficha (revisão do PR).</li><li>Abaixo do quadro, abas para Nutrição, Perdidos e Ganhos, em lista (tabela paginada). Nesses estados o negócio não está em etapa aberta.</li><li>No celular, as colunas viram uma lista com rolagem horizontal; nada se perde.</li></ul> | spec §4 F13-CRM        |
| 3   | **Mover (usuário, 2026-11-06):** <ul><li>"Mover para…" é um menu (dropdown-menu do `packages/ui`) com as etapas abertas, sem a atual.</li><li>Funciona no teclado e no leitor de tela, e aparece no cartão e na ficha.</li><li>O 409 `requisitos_pendentes` mostra "Falta: …" com a lista, junto do cartão ou na ficha.</li><li>O 409 `conflito_versao` recarrega o negócio e avisa "o negócio mudou, confira e tente de novo".</li><li>Ganho não aparece no menu (fica para a F6).</li></ul>                                                                                                                                                                               | API 2a, decisão 5      |
| 4   | **Ficha do negócio:** <ul><li>Cabeçalho com título, etapa, status, contato (link), responsável, valor e previsão.</li><li>"O que falta": os requisitos da etapa atual com atendido ou pendente. O pendente de tarefa leva à tarefa.</li><li>Ações conforme a permissão:<ul><li>Mover;</li><li>Perder: diálogo com o motivo, pelas opções de `GET /v1/motivos-perda`;</li><li>Nutrir: diálogo com a data de reativação, no futuro;</li><li>Editar: diálogo com os campos editáveis e `versao_registro`;</li><li>Excluir, com confirmação.</li></ul></li><li>Perdido e ganho mostram só a leitura.</li></ul>                                                                  | API 2a, decisões 3 a 8 |
| 5   | **Novo negócio:** <ul><li>Pelo botão na ficha do contato, que já sabe qual é o contato.</li><li>Pelo quadro, num diálogo com uma busca de contato (2 caracteres ou mais, resultados de `GET /v1/contatos?q=`).</li><li>Os campos são título, interesse, tipo de dispositivo, problema, urgência, valor, previsão e responsável. O responsável usa as opções da ficha do contato, e o PROPRIO não escolhe.</li></ul>                                                                                                                                                                                                                                                         | API 2a, decisão 4      |
| 6   | **Tarefas:** <ul><li>Na ficha do negócio e na do contato, a lista das tarefas abertas em ordem de vencimento. As concluídas e canceladas ficam num "mostrar todas".</li><li>As ações são nova tarefa (título, vencimento, prioridade, responsável), concluir, iniciar (EM_ANDAMENTO) e cancelar, esta com confirmação.</li><li>As tarefas do funil mostram a origem "do funil".</li><li>Concluir uma tarefa do funil atualiza o "o que falta" na hora.</li></ul>                                                                                                                                                                                                            | API 2a, decisão 9      |
| 7   | **Timeline:** <ul><li>Na ficha do negócio e na do contato, as atividades da mais recente para a mais antiga, com "Carregar mais".</li><li>"Registrar atividade" abre um diálogo com o tipo, a direção (escondida na nota), o assunto, o conteúdo, o resultado e o quando (padrão: agora).</li><li>"Corrigir" e "Apagar" aparecem só quando a API permitiria: com PROPRIO, nas próprias atividades e dentro das 24 horas; nunca nas do sistema. A API decide de fato, e o 409 aparece com a mensagem dela.</li></ul>                                                                                                                                                         | API 2b                 |
| 8   | **API simulada (MSW):** ganha funil, negócios, tarefas e atividades. As regras que a tela mostra entram nela: requisitos pendentes, versão, tarefas do funil, prazo de 24 horas, PROPRIO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | F12                    |
| 9   | **E2E:** <ul><li>O dono cria um contato e um negócio pela ficha do contato.</li><li>Tenta mover e vê o que falta, preenche o que falta e move.</li><li>Conclui a tarefa do funil e registra uma ligação.</li><li>No fim, perde o negócio com um motivo.</li></ul>                                                                                                                                                                                                                                                                                                                                                                                                           | spec §4 F13            |

## Estrutura

- **Web:**
  - `apps/web/src/routes/_app/negocios/`: `index.tsx` (o quadro) e `$id.tsx` (a ficha);
  - `apps/web/src/negocios/`: consultas, cartão, menu de mover, diálogos (novo, editar, perder,
    nutrir) e a busca de contato;
  - `apps/web/src/crm/`: tarefas e timeline, usadas nas duas fichas.
- **Simulação:** `apps/web/src/simulacao/negocios-simulada.ts`.
- **E2E:** `apps/e2e/testes/negocios.spec.ts`.
- DESIGN.md: quadro, cartão e timeline.

## Testes

- **Componente (Vitest + MSW + axe), por tela:**
  - caminho feliz;
  - estados vazio, carregando e erro;
  - ações ocultas sem a permissão;
  - nenhuma violação do axe.
- **Casos específicos:**
  - mover com os requisitos pendentes mostra "Falta" e não muda a coluna;
  - mover com sucesso troca a coluna;
  - conflito de versão recarrega o negócio;
  - perder exige o motivo;
  - nutrir recusa data no passado;
  - concluir a tarefa do funil atualiza o "o que falta";
  - a nota esconde a direção;
  - "Corrigir" some depois de 24 horas para o PROPRIO;
  - novo negócio pela busca de contato;
  - o filtro do quadro fica na URL.
- **E2E:** a jornada da decisão 9.
- **Acessibilidade:** Lighthouse ≥ 90 no quadro, na ficha do negócio e na ficha do contato,
  anotado no DESIGN.md.

## Rollout e rollback

- Sem migração e sem variável nova. Rollback: reverter o PR.

## Revisão

Duas trilhas independentes, corretude e segurança: as telas mostram e editam dados pessoais
(conversas, contatos) e respeitam o escopo PROPRIO nas ações.
