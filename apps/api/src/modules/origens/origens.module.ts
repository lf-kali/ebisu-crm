import { Module } from '@nestjs/common';
import { MotivosPerdaController, OrigensController } from './origens.controller.js';

@Module({ controllers: [OrigensController, MotivosPerdaController] })
export class OrigensModule {}
