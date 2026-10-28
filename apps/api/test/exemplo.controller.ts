import {
  ConflictException,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Dinheiro, DinheiroNaoNegativo, Uuid } from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../src/core/contrato/contrato.js';
import { ErroDominio } from '../src/core/erros/erro-dominio.js';

// Endpoint de exemplo SÓ para testes (decisão do dono): prova validação de entrada e de saída.

export const ID_EXEMPLO = '0190d7c0-0000-7000-8000-0000000000e1';
const Entrada = z.object({ nome: z.string().min(1), valor: DinheiroNaoNegativo });
const Saida = z.object({ id: Uuid, nome: z.string(), valor: Dinheiro });
const Modo = z.object({
  modo: z
    .enum([
      'ok',
      'resposta_invalida',
      'vaza_campo',
      'erro_dominio',
      'erro_inesperado',
      'nest_503',
      'nest_500',
      'nest_502',
      'nest_409',
    ])
    .default('ok'),
});

@Controller('exemplo')
export class ExemploController {
  @Post()
  @Contrato({
    resumo: 'Exemplo de comando',
    query: Modo,
    corpo: Entrada,
    resposta: Saida,
    status: 201,
  })
  criar(@Consulta() { modo }: z.infer<typeof Modo>, @Corpo() corpo: z.infer<typeof Entrada>) {
    switch (modo) {
      case 'resposta_invalida':
        return { id: 'nao-e-uuid', ...corpo };
      case 'vaza_campo':
        return { id: ID_EXEMPLO, ...corpo, custo_medio: '10.00' };
      case 'erro_dominio':
        throw new ErroDominio('estoque_insuficiente', { extras: { item_id: ID_EXEMPLO } }, 'EST-6');
      case 'erro_inesperado':
        throw new Error('falha no banco: senha=segredo123');
      case 'nest_503':
        throw new ServiceUnavailableException('banco fora do ar host=10.0.0.1');
      case 'nest_500':
        throw new InternalServerErrorException('detalhe interno');
      case 'nest_502':
        throw new HttpException('gateway', 502);
      case 'nest_409':
        throw new ConflictException('conflito sem ErroDominio');
      default:
        return { id: ID_EXEMPLO, ...corpo };
    }
  }

  @Post('sem-schema')
  @Contrato({ resumo: 'Lê o corpo sem declarar schema (bug de programação)', resposta: null })
  semSchema(@Corpo() corpo: unknown) {
    return corpo;
  }

  @Get(':id')
  @Contrato({ resumo: 'Exemplo de leitura', params: z.object({ id: Uuid }), resposta: Saida })
  ler(@Parametros() { id }: { id: string }) {
    return { id, nome: 'Exemplo', valor: '1.00' };
  }
}
