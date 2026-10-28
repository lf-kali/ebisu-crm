# ebisuCRM — Design

Fonte única do visual do web. O código segue este arquivo: os tokens vivem em
[`packages/ui/src/styles/globals.css`](packages/ui/src/styles/globals.css) e mudam no mesmo PR que
este documento. `CLAUDE.md`/spec cuidam de código e regras; este arquivo, de cor, tipo, espaço e
componentes.

## Princípios

- **Neutro com um destaque.** Base em cinzas (shadcn/ui, base `neutral`) e uma única cor de
  destaque, índigo, para ação principal, foco e item ativo. A marca entra trocando tokens.
- **Legível primeiro.** Todo par de texto passa WCAG AA (≥ 4,5:1) nos dois modos. Contraste
  medido, não estimado (tabela abaixo).
- **Bancada no celular.** Layout pensado para o técnico usar o celular: menu vira painel lateral
  abaixo de `md` (768 px), alvos de toque ≥ 36 px.
- **Mensagem do catálogo.** Erros mostram o `title` do catálogo da API (spec §5.2) e o
  `request_id` como "código para o suporte"; nunca texto técnico.

## Cores (tokens)

Definidos em OKLCH como variáveis CSS e expostos ao Tailwind (`bg-primary`, `text-muted-foreground`
etc.). Modo escuro segue a preferência do sistema (classe `.dark` no `<html>`).

| Token                                    | Claro                                          | Escuro                                          | Uso                                                                |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `background` / `foreground`              | `oklch(1 0 0)` / `oklch(0.145 0 0)`            | `oklch(0.145 0 0)` / `oklch(0.985 0 0)`         | Fundo e texto padrão                                               |
| `primary` / `primary-foreground`         | `oklch(0.51 0.2 275)` / `oklch(0.985 0 0)`     | `oklch(0.72 0.15 275)` / `oklch(0.18 0.05 275)` | Ação principal, foco (`ring`), item ativo                          |
| `muted` / `muted-foreground`             | `oklch(0.97 0 0)` / `oklch(0.5 0 0)`           | `oklch(0.269 0 0)` / `oklch(0.72 0 0)`          | Superfícies e texto secundários                                    |
| `accent` / `accent-foreground`           | `oklch(0.96 0.02 275)` / `oklch(0.3 0.12 275)` | `oklch(0.3 0.06 275)` / `oklch(0.92 0.04 275)`  | Hover e item ativo do menu                                         |
| `destructive` / `destructive-foreground` | `oklch(0.55 0.22 27)` / `oklch(0.985 0 0)`     | `oklch(0.7 0.19 22)` / `oklch(0.145 0 0)`       | Erro, ação destrutiva                                              |
| `sucesso` / `sucesso-foreground`         | `oklch(0.52 0.14 150)` / `oklch(0.985 0 0)`    | `oklch(0.72 0.14 150)` / `oklch(0.145 0 0)`     | Confirmação, status positivo                                       |
| `alerta`                                 | `oklch(0.55 0.13 70)`                          | `oklch(0.8 0.14 75)`                            | Atenção (ex.: estoque mínimo)                                      |
| `border`                                 | `oklch(0.922 0 0)`                             | `oklch(1 0 0 / 12%)`                            | Bordas decorativas (separadores, cards)                            |
| `input`                                  | `oklch(0.62 0 0)`                              | `oklch(1 0 0 / 40%)`                            | Borda de campo: ≥ 3:1 sobre fundo, card, muted, secondary e accent |
| `sidebar-*`                              | Variações acima para o menu lateral            |                                                 | Menu                                                               |

### Contraste medido (WCAG 2.1)

Medido com as transparências compostas como no navegador. Texto ≥ 4,5:1; foco e borda de
campo ≥ 3:1 (1.4.11). O teste `packages/ui/test/contraste.test.ts` recalcula estes pares a partir
do `globals.css` e falha o CI se algum cair abaixo do mínimo.

| Par                                                        | Claro | Escuro |
| ---------------------------------------------------------- | ----- | ------ |
| texto / fundo                                              | 19,8  | 19,0   |
| texto do botão / `primary`                                 | 5,9   | 7,4    |
| `primary` como texto / fundo                               | 6,2   | 7,7    |
| `muted-foreground` / fundo                                 | 6,0   | 8,0    |
| `destructive` / fundo                                      | 5,4   | 6,8    |
| `accent-foreground` / `accent`                             | 12,5  | 10,8   |
| `sucesso` / fundo                                          | 5,2   | 8,4    |
| `sucesso-foreground` / `sucesso`                           | 5,0   | 8,4    |
| `alerta` / fundo                                           | 5,0   | 10,4   |
| texto do botão / `primary` a 90% (hover)                   | 4,8   | 6,1    |
| `destructive-foreground` / `destructive`                   | 5,2   | 6,8    |
| `destructive-foreground` / `destructive` a 90% (hover)     | 4,8   | 5,6    |
| `destructive` a 90% como texto / fundo                     | 5,0   | 5,6    |
| anel de foco (`ring`, opaco) / fundo                       | 6,2   | 7,7    |
| borda de campo (`input`) / fundo                           | 3,6   | 3,8    |
| borda de campo (`input`) / `muted`, `accent`               | 3,2   | 3,5    |
| barra do item ativo (`sidebar-primary`) / `sidebar-accent` | 5,3   | 5,4    |

Cor nova só entra com o par medido nesta tabela (e no teste). Três armadilhas dos componentes do
shadcn, barradas pelo teste:

- **Anel de foco translúcido** (`ring-ring/50`): dá 2,2–2,7:1. Use sempre `ring-ring` opaco.
- **Foco só por cor de fundo** (`outline-hidden focus:bg-accent`, padrão do dropdown): 1,1–1,3:1.
  Toda classe que tira o outline traz um `ring` (o teste verifica nos componentes do `packages/ui`).
- **`text-white` sobre cor de status**: use o `*-foreground` do token (branco sobre `destructive`
  no escuro daria 2,9; sobre `sucesso`, 2,35).

## Tipografia

- Fonte de sistema (`ui-sans-serif, system-ui, …`): sem download, renderiza bem em pt-BR.
- Escala do Tailwind: corpo `text-sm` (14 px) em tabelas e formulários, `text-base` (16 px) em
  conteúdo corrido, título de página `text-2xl font-semibold tracking-tight`.
- Números de dinheiro e quantidade com `tabular-nums` em tabelas.

## Espaço, raio e camadas

- Espaçamento na escala do Tailwind (múltiplos de 4 px). Conteúdo: `p-4` no celular, `p-6` a
  partir de `md`.
- Raio base `--radius: 0.625rem` (10 px); `rounded-md` em botões e campos, `rounded-xl` em cards.
- Cabeçalho fixo `h-14` com `z-30`; painéis e diálogos acima dele (`z-50`).

## Layout

- **AppShell** (`apps/web/src/layout/app-shell.tsx`): cabeçalho (nome, área para seletor de
  empresa e usuário), menu lateral fixo de 240 px a partir de `md` e conteúdo. Abaixo de `md`, o
  menu abre num painel lateral (`Sheet`) pelo botão "Abrir menu" e fecha ao navegar.
- Link "Pular para o conteúdo" é o primeiro foco da página.
- Menu na ordem dos módulos (spec §4 F13): Painel, Contatos, Negócios, Dispositivos, Orçamentos,
  Bancada, Estoque, Financeiro, Configurações. Item atual com `aria-current="page"`. Itens sem
  permissão ficam ocultos (não desabilitados).

## Componentes

Base shadcn/ui (estilo `new-york`) em `packages/ui/src/components/ui/`: `alert`, `avatar`,
`badge`, `button`, `card`, `dropdown-menu`, `input`, `label`, `separator`, `sheet`, `skeleton`,
`tooltip`. Componentes novos entram pela CLI do shadcn no `packages/ui` e corrigindo o import do
`cn` para `@ebisu/ui/lib/utils`.

Estados padrão (`packages/ui/src/components/estados.tsx`), obrigatórios em toda tela com dados:

| Estado     | Componente                                               | Acessibilidade                        |
| ---------- | -------------------------------------------------------- | ------------------------------------- |
| Carregando | `Carregando`                                             | `role="status"`, `aria-live="polite"` |
| Vazio      | `EstadoVazio` (título, descrição, ação)                  | Texto, sem só ícone                   |
| Erro       | `EstadoErro`; no web, `ErroDaApi` lê o `Problema` da API | `role="alert"`, mostra `request_id`   |

## Acessibilidade

- Meta: Lighthouse acessibilidade ≥ 90 nas páginas base (spec §4 F12).
- Testes de componente rodam o axe-core (`apps/web/src/teste/axe.ts`); contraste não é avaliável
  no jsdom, por isso a tabela acima.
- Foco sempre visível (`ring` do `primary`). Ícones decorativos com `aria-hidden`; botão só com
  ícone exige `aria-label`.
- Textos de interface em pt-BR (D-P13).
