import type { INestApplication } from '@nestjs/common';
import { VERSAO_API } from '@ebisu/contracts';

// Configuração compartilhada entre o processo real e os testes.
export function configurarApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix(VERSAO_API);
  app.enableShutdownHooks();
  return app;
}
