import { Global, Module } from '@nestjs/common';
import { CONFIG, lerConfig } from './config.js';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => lerConfig(process.env) }],
  exports: [CONFIG],
})
export class ConfigModule {}
