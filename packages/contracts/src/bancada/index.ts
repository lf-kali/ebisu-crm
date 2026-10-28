// Contratos do domínio bancada (F7). Esqueleto: a frente do domínio é dona desta pasta (spec §3.3).
import { z } from 'zod';

// Espelha o enum StatusOS do schema.prisma (teste de paridade em test/paridade.test.ts).
export const StatusOS = z
  .enum([
    'ABERTA',
    'EM_DIAGNOSTICO',
    'AGUARDANDO_APROVACAO',
    'AGUARDANDO_PECAS',
    'EM_REPARO',
    'EM_TESTES',
    'PRONTA',
    'ENTREGUE',
    'SEM_REPARO',
    'CANCELADA',
  ])
  .meta({ id: 'StatusOS' });
