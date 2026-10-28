import { Controller, Get, Req } from '@nestjs/common';
import { RespostaEu } from '@ebisu/contracts';
import { Contrato } from '../../core/contrato/contrato.js';
import type { RequisicaoAutenticada } from '../../core/rbac/guarda-contexto.js';
import { SoAutenticado } from '../../core/rbac/marcas.js';
import { EuService } from './eu.service.js';

@Controller('eu')
export class EuController {
  constructor(private readonly eu: EuService) {}

  @Get()
  @SoAutenticado()
  @Contrato({
    resumo: 'Quem está logado, em qual conta e o que pode em cada empresa',
    tags: ['auth'],
    resposta: RespostaEu,
  })
  obter(@Req() req: RequisicaoAutenticada): Promise<RespostaEu> {
    return this.eu.obter(req.identidade);
  }
}
