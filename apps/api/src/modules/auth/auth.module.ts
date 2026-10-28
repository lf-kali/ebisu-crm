import { Module } from '@nestjs/common';
import { CONFIG, type Config } from '../../core/config/config.js';
import { EuController } from '../eu/eu.controller.js';
import { EuService } from '../eu/eu.service.js';
import { AuthController } from './auth.controller.js';
import { GuardaOrigem } from './guardas.js';
import { SessoesService } from './sessoes.service.js';
import { criarTokensDeAcesso, TOKENS_DE_ACESSO } from './tokens.js';

@Module({
  controllers: [AuthController, EuController],
  providers: [
    SessoesService,
    EuService,
    GuardaOrigem,
    {
      provide: TOKENS_DE_ACESSO,
      inject: [CONFIG],
      useFactory: (config: Config) => criarTokensDeAcesso(config),
    },
  ],
  exports: [TOKENS_DE_ACESSO],
})
export class AuthModule {}
