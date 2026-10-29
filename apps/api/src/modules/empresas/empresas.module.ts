import { Module } from '@nestjs/common';
import { EmpresasController } from './empresas.controller.js';

@Module({ controllers: [EmpresasController] })
export class EmpresasModule {}
