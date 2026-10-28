import { z } from 'zod';

export const RespostaSaude = z.object({ status: z.literal('ok') }).meta({ id: 'RespostaSaude' });
export type RespostaSaude = z.infer<typeof RespostaSaude>;
