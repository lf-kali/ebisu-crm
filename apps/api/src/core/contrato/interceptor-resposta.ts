import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import { requestIdDa } from '../requisicao/request-id.js';
import { contratoDoHandler } from './contrato.js';

export class RespostaForaDoContratoError extends Error {
  constructor(readonly handler: string) {
    super(`Resposta fora do contrato em ${handler}`);
    this.name = 'RespostaForaDoContratoError';
  }
}

/**
 * Valida a resposta contra o contrato antes de enviá-la. Também remove campos não declarados
 * (o parse do Zod descarta chaves desconhecidas), o que impede vazar dados por engano —
 * ex.: custos sem `financeiro.ver_custos` (SEG-5).
 */
@Injectable()
export class InterceptorResposta implements NestInterceptor {
  private readonly logger = new Logger('Contrato');

  intercept(contexto: ExecutionContext, proximo: CallHandler): Observable<unknown> {
    const schema = contratoDoHandler(contexto)?.resposta;
    if (!schema) return proximo.handle();
    const handler = `${contexto.getClass().name}.${contexto.getHandler().name}`;
    return proximo.handle().pipe(
      map((resposta: unknown) => {
        const resultado = schema.safeParse(resposta);
        if (resultado.success) return resultado.data;
        const requestId = requestIdDa(contexto.switchToHttp().getResponse<Response>());
        this.logger.error(
          {
            request_id: requestId,
            handler,
            // Só caminho e código: nunca valores da resposta (SEG-8), nem via mensagem de refine.
            issues: resultado.error.issues.map(({ path, code }) => ({ path, code })),
          },
          'Resposta fora do contrato',
        );
        throw new RespostaForaDoContratoError(handler);
      }),
    );
  }
}
