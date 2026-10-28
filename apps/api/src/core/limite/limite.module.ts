import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { CONFIG, type Config } from '../config/config.js';
import { LIMITADOR, limitadorRedis } from './limitador.js';

const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [CONFIG],
      // lazyConnect: só conecta no primeiro uso (rotas sem limite não dependem do Redis).
      useFactory: (config: Config) =>
        new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }),
    },
    { provide: LIMITADOR, inject: [REDIS], useFactory: limitadorRedis },
  ],
  exports: [LIMITADOR],
})
export class LimiteModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
