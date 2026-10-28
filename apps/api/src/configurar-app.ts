import type { INestApplication } from '@nestjs/common';
import { VERSAO_API } from '@ebisu/contracts';
import { InterceptorResposta } from './core/contrato/interceptor-resposta.js';
import { FiltroProblema } from './core/erros/filtro-problema.js';
import { requestId } from './core/requisicao/request-id.js';

// Configuração compartilhada entre o processo real e os testes.
export function configurarApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(VERSAO_API);
  app.use(requestId);
  app.useGlobalFilters(new FiltroProblema());
  app.useGlobalInterceptors(new InterceptorResposta());
  app.enableShutdownHooks();
  return app;
}
