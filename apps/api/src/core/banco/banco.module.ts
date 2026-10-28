import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@ebisu/db';
import { CONFIG, type Config } from '../config/config.js';

// Um cliente por papel de banco (SEG-6). O PrismaClient só conecta na primeira consulta.
export const PRISMA_AUTH = Symbol('PRISMA_AUTH');
/** ebisu_app: use sempre via comTenant (RLS por tenant, SEG-1). */
export const PRISMA_APP = Symbol('PRISMA_APP');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_AUTH,
      inject: [CONFIG],
      useFactory: (config: Config) => new PrismaClient({ datasourceUrl: config.DATABASE_URL_AUTH }),
    },
    {
      provide: PRISMA_APP,
      inject: [CONFIG],
      useFactory: (config: Config) => new PrismaClient({ datasourceUrl: config.DATABASE_URL_APP }),
    },
  ],
  exports: [PRISMA_AUTH, PRISMA_APP],
})
export class BancoModule implements OnModuleDestroy {
  constructor(
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.auth.$disconnect(), this.app.$disconnect()]);
  }
}
