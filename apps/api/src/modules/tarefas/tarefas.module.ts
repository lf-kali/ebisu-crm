import { Module } from '@nestjs/common';
import { TarefasController } from './tarefas.controller.js';

@Module({ controllers: [TarefasController] })
export class TarefasModule {}
