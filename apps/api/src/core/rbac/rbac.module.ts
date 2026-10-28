import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../../modules/auth/auth.module.js';
import { GuardaContexto } from './guarda-contexto.js';

/** Registra o guard global de acesso: toda rota passa por ele. */
@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_GUARD, useClass: GuardaContexto }],
})
export class RbacModule {}
