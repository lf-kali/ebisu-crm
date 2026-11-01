import { Module } from '@nestjs/common';
import {
  ConvitesController,
  MembrosController,
  OpcoesMembrosController,
  PapeisController,
} from './membros.controller.js';
import { MembrosService } from './membros.service.js';

// Convites e opções antes do MembrosController: as rotas fixas /membros/convites e
// /membros/opcoes vêm antes de /:id.
@Module({
  controllers: [ConvitesController, OpcoesMembrosController, MembrosController, PapeisController],
  providers: [MembrosService],
})
export class MembrosModule {}
