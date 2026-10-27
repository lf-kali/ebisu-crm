import { Module } from '@nestjs/common';
import { SaudeModule } from './core/saude/saude.module.js';

// Registro de módulos (dono: F0). Uma linha por módulo de domínio.
@Module({
  imports: [SaudeModule],
})
export class AppModule {}
