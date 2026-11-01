// Texto normalizado para busca (F4-1; plano docs/planos/f4-1-contatos.md, decisão 5): sem acentos
// nem diferença de maiúsculas, para `Joao` achar `João`. Fica aqui porque a API e o seed de
// demonstração gravam contatos.

/** Minúsculas, sem marcas combinantes (acentos, cedilha) e com espaços simples. */
export const normalizarBusca = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
