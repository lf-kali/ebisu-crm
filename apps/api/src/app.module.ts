import { Module } from '@nestjs/common';
import { BancoModule } from './core/banco/banco.module.js';
import { ConfigModule } from './core/config/config.module.js';
import { LimiteModule } from './core/limite/limite.module.js';
import { SaudeModule } from './core/saude/saude.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

// Registro de módulos (dono: F0). Uma linha por módulo de domínio.
@Module({
  imports: [ConfigModule, BancoModule, LimiteModule, SaudeModule, AuthModule],
})
export class AppModule {}
