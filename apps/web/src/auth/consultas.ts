import { RespostaEu, ROTAS_AUTH } from '@ebisu/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { ClienteApi } from '../api/cliente';

/** GET /v1/eu: usuário, conta e empresas com as permissões (base do menu e do seletor). */
export const consultaEu = (cliente: ClienteApi) =>
  queryOptions({
    queryKey: ['eu'],
    queryFn: ({ signal }) => cliente.get(ROTAS_AUTH.eu, { resposta: RespostaEu, sinal: signal }),
  });
