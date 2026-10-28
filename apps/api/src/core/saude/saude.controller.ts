import { Controller, Get } from '@nestjs/common';
import { RespostaSaude } from '@ebisu/contracts';
import { Contrato } from '../contrato/contrato.js';

@Controller('saude')
export class SaudeController {
  @Get()
  @Contrato({
    resumo: 'Verifica se a API está no ar',
    tags: ['plataforma'],
    resposta: RespostaSaude,
  })
  verificar(): RespostaSaude {
    return { status: 'ok' };
  }
}
