import { z } from 'zod';

// Mensagens de validação do Zod em pt-BR (D-P13). Campo de texto vazio vira "Campo obrigatório."
// (e não "Pequeno demais: esperava >= 1 caracteres" ou "Formato de e-mail inválido"); o resto vem
// do locale ptBR do Zod. Importado uma vez no main e nos testes.
const ptBR = z.locales.ptBR();

z.config({
  localeError: (issue) =>
    issue.input === '' && (issue.code === 'too_small' || issue.code === 'invalid_format')
      ? 'Campo obrigatório.'
      : ptBR.localeError?.(issue),
});
