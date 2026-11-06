import { Module } from '@nestjs/common';
import { AtividadesController } from './atividades.controller.js';

@Module({ controllers: [AtividadesController] })
export class AtividadesModule {}
