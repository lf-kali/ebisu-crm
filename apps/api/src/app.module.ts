import { Module } from '@nestjs/common';
import { BancoModule } from './core/banco/banco.module.js';
import { ConfigModule } from './core/config/config.module.js';
import { LimiteModule } from './core/limite/limite.module.js';
import { RbacModule } from './core/rbac/rbac.module.js';
import { SaudeModule } from './core/saude/saude.module.js';
import { TxModule } from './core/tx/executar.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ContatosModule } from './modules/contatos/contatos.module.js';
import { EmpresasModule } from './modules/empresas/empresas.module.js';
import { MembrosModule } from './modules/membros/membros.module.js';
import { OrigensModule } from './modules/origens/origens.module.js';
import { FunilModule } from './modules/funil/funil.module.js';
import { NegociosModule } from './modules/negocios/negocios.module.js';
import { TarefasModule } from './modules/tarefas/tarefas.module.js';
import { AtividadesModule } from './modules/atividades/atividades.module.js';

// Registro de módulos (dono: F0). Uma linha por módulo de domínio.
@Module({
  imports: [
    ConfigModule,
    BancoModule,
    LimiteModule,
    TxModule,
    RbacModule,
    SaudeModule,
    AuthModule,
    EmpresasModule,
    MembrosModule,
    ApiKeysModule,
    ContatosModule,
    OrigensModule,
    FunilModule,
    NegociosModule,
    TarefasModule,
    AtividadesModule,
  ],
})
export class AppModule {}
