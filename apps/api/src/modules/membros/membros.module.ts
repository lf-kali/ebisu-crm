import { Module } from '@nestjs/common';
import { ConvitesController, MembrosController, PapeisController } from './membros.controller.js';
import { MembrosService } from './membros.service.js';

// ConvitesController antes do MembrosController: a rota fixa /membros/convites vem antes de /:id.
@Module({
  controllers: [ConvitesController, MembrosController, PapeisController],
  providers: [MembrosService],
})
export class MembrosModule {}
