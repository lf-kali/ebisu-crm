import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  ConsultaTarefas,
  EdicaoTarefa,
  EntradaTarefa,
  ListaTarefas,
  Tarefa,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './tarefas.comandos.js';

// /v1/tarefas (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisão 9).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

const FECHADA = 'Tarefa concluída ou cancelada dá 409 `transicao_invalida`.';

@Controller('tarefas')
export class TarefasController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('tarefa.read')
  @Contrato({
    resumo: 'Lista as tarefas da empresa, em ordem de vencimento',
    tags: ['crm'],
    query: ConsultaTarefas,
    resposta: ListaTarefas,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao, @Consulta() consulta: ConsultaTarefas) {
    return this.executor.executarComando(contexto, comandos.listar, consulta);
  }

  @Get(':id')
  @Permissao('tarefa.read')
  @Contrato({ resumo: 'Lê uma tarefa', tags: ['crm'], params: PorId, resposta: Tarefa })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @Permissao('tarefa.create')
  @Contrato({
    resumo: 'Cria uma tarefa manual',
    descricao: 'Com `negocio_id`, o contato é o do negócio.',
    tags: ['crm'],
    corpo: EntradaTarefa,
    resposta: Tarefa,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaTarefa) {
    return this.executor.executarComando(contexto, comandos.criar, entrada);
  }

  @Patch(':id')
  @Permissao('tarefa.update')
  @Contrato({
    resumo: 'Edita uma tarefa aberta',
    descricao: FECHADA,
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoTarefa,
    resposta: Tarefa,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoTarefa,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Post(':id/concluir')
  @Permissao('tarefa.update')
  @Contrato({
    resumo: 'Conclui uma tarefa',
    descricao: `Tarefa de requisito concluída atende o requisito da etapa. ${FECHADA}`,
    tags: ['crm'],
    params: PorId,
    resposta: Tarefa,
  })
  concluir(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.concluir, id);
  }

  @Delete(':id')
  @Permissao('tarefa.delete')
  @Contrato({
    resumo: 'Cancela uma tarefa (ela continua no histórico)',
    descricao: FECHADA,
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async cancelar(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.cancelar, id);
  }
}
