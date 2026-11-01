import { Module } from '@nestjs/common';
import { ContatosController } from './contatos.controller.js';

@Module({ controllers: [ContatosController] })
export class ContatosModule {}
