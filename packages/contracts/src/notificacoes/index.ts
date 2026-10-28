// Contratos do domínio notificacoes (F10). Esqueleto: a frente do domínio é dona desta pasta (spec §3.3).
import { z } from 'zod';

// Espelha o enum CanalComunicacao do schema.prisma (teste de paridade em test/enums.test.ts).
export const Canal = z.enum(['WHATSAPP', 'EMAIL', 'SMS']).meta({ id: 'Canal' });
