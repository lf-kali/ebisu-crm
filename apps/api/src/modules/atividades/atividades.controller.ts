import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  Atividade,
  ConsultaAtividades,
  EdicaoAtividade,
  EntradaAtividade,
  ListaAtividades,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './atividades.comandos.js';

// /v1/atividades (spec §5.3; plano docs/planos/f4-2b-atividades.md).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

const CORRIGIR =
  'Com escopo PROPRIO, só a própria atividade e nas primeiras 24 horas do registro; com EMPRESA ' +
  'ou TENANT, qualquer uma, a qualquer tempo. Fora do prazo, ou atividade do sistema, dá 409 ' +
  '`transicao_invalida`.';

@Controller('atividades')
export class AtividadesController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('atividade.read')
  @Contrato({
    resumo: 'Timeline: atividades da mais recente à mais antiga',
    tags: ['crm'],
    query: ConsultaAtividades,
    resposta: ListaAtividades,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao, @Consulta() consulta: ConsultaAtividades) {
    return this.executor.executarComando(contexto, comandos.listar, consulta);
  }

  @Get(':id')
  @Permissao('atividade.read')
  @Contrato({ resumo: 'Lê uma atividade', tags: ['crm'], params: PorId, resposta: Atividade })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @Permissao('atividade.create')
  @Contrato({
    resumo: 'Registra uma atividade (ligação, WhatsApp, visita, nota…)',
    descricao:
      'Conversas (ENTRADA ou SAIDA) atualizam `ultima_interacao_em` do contato; a nota interna ' +
      'não. Com `negocio_id`, o contato é o do negócio.',
    tags: ['crm'],
    corpo: EntradaAtividade,
    resposta: Atividade,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaAtividade) {
    return this.executor.executarComando(contexto, comandos.criar, entrada);
  }

  @Patch(':id')
  @Permissao('atividade.update')
  @Contrato({
    resumo: 'Corrige uma atividade',
    descricao: CORRIGIR,
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoAtividade,
    resposta: Atividade,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoAtividade,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Delete(':id')
  @Permissao('atividade.delete')
  @Contrato({
    resumo: 'Apaga uma atividade',
    descricao: `${CORRIGIR} O audit log guarda o registro apagado.`,
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async apagar(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.apagar, id);
  }
}
