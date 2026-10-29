import { z } from 'zod';

// Escalares da API (spec §5.1). Campos em snake_case, iguais ao banco.

// Sempre em minúsculas: o banco compara uuid sem caixa, mas o código compara ids como texto. Um id
// em maiúsculas que passasse cru furaria essas comparações (ex.: a regra do dono, PR 4b-1).
export const Uuid = z
  .uuid()
  .overwrite((id) => id.toLowerCase())
  .meta({ id: 'Uuid', description: 'Identificador UUID' });

// Dinheiro: string decimal com 2 casas, como o Decimal(14,2) do banco (até 12 dígitos inteiros).
// Pode ser negativo (ex.: estorno de pagamento, FIN-3); use DinheiroNaoNegativo onde não puder.
// Forma canônica (sem zeros à esquerda, sem "-0.00"): um valor tem uma única representação,
// o que importa para comparação de texto e para o hash da idempotência.
export const Dinheiro = z
  .string()
  .regex(
    /^(?!-0\.00$)-?(0|[1-9]\d{0,11})\.\d{2}$/,
    'Valor em reais com 2 casas decimais, ex.: "123.40"',
  )
  .meta({ id: 'Dinheiro', description: 'Valor em BRL com 2 casas decimais', example: '123.40' });

export const DinheiroNaoNegativo = Dinheiro.refine(
  (v) => !v.startsWith('-'),
  'Valor não pode ser negativo',
);

// Quantidade: até 3 casas, como o Decimal(14,3) do banco. Negativa só em movimentos (EST-3).
// Forma canônica como no Dinheiro: sem zeros à esquerda e sem zero negativo.
export const Quantidade = z
  .string()
  .regex(
    /^(?!-0(\.0{1,3})?$)-?(0|[1-9]\d{0,10})(\.\d{1,3})?$/,
    'Quantidade com até 3 casas decimais, ex.: "1.5"',
  )
  .meta({ id: 'Quantidade', description: 'Quantidade com até 3 casas decimais', example: '1' });

export const DataHora = z.iso
  .datetime({ offset: true })
  .meta({ id: 'DataHora', description: 'ISO 8601 com fuso', example: '2026-10-27T14:00:00-03:00' });

export const Data = z.iso
  .date()
  .meta({ id: 'Data', description: 'Data YYYY-MM-DD', example: '2026-10-27' });

/** Trava otimista (D-A08): obrigatória em PATCH e comandos sobre entidades editáveis. */
export const VersaoRegistro = z.number().int().nonnegative().meta({ id: 'VersaoRegistro' });
