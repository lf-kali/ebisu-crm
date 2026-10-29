import { Module } from '@nestjs/common';
import { MembrosController, PapeisController } from './membros.controller.js';
import { MembrosService } from './membros.service.js';

@Module({ controllers: [MembrosController, PapeisController], providers: [MembrosService] })
export class MembrosModule {}
