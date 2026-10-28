// Contratos do domínio orcamentos (F6). Esqueleto: a frente do domínio é dona desta pasta (spec §3.3).
import { z } from 'zod';

// Espelha o enum StatusOrcamento do schema.prisma (teste de paridade em test/paridade.test.ts).
export const StatusOrcamento = z
  .enum([
    'RASCUNHO',
    'ENVIADO',
    'VISUALIZADO',
    'APROVADO',
    'APROVADO_PARCIAL',
    'REPROVADO',
    'EXPIRADO',
    'CANCELADO',
    'CONVERTIDO',
  ])
  .meta({ id: 'StatusOrcamento' });

export const DecisaoOrcamento = z
  .enum(['APROVADO', 'APROVADO_PARCIAL', 'REPROVADO'])
  .meta({ id: 'DecisaoOrcamento' });
