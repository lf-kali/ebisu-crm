import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
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
      useFactory: (config: Config) => {
        const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
        // Sem handler, o ioredis imprime "Unhandled error event" a cada falha de conexão. O
        // login segue falhando fechado (500) enquanto o Redis estiver fora: sem limite, não entra.
        const log = new Logger('Redis');
        redis.on('error', (erro: Error) => log.error(`Redis indisponível: ${erro.message}`));
        return redis;
      },
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
