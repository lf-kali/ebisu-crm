import { Module } from '@nestjs/common';
import { NegociosController } from './negocios.controller.js';

@Module({ controllers: [NegociosController] })
export class NegociosModule {}
