import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  ConsultaNegocios,
  EdicaoNegocio,
  EntradaMoverNegocio,
  EntradaNegocio,
  EntradaNutrirNegocio,
  EntradaPerderNegocio,
  ListaNegocios,
  NegocioDetalhado,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './negocios.comandos.js';

// /v1/negocios (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 3 a 8).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

const VERSAO = 'Exige `versao_registro`; divergente dá 409 `conflito_versao` (D-A08).';

@Controller('negocios')
export class NegociosController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('negocio.read')
  @Contrato({
    resumo: 'Lista os negócios da empresa, dos mais recentes aos mais antigos',
    tags: ['crm'],
    query: ConsultaNegocios,
    resposta: ListaNegocios,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao, @Consulta() consulta: ConsultaNegocios) {
    return this.executor.executarComando(contexto, comandos.listar, consulta);
  }

  @Get(':id')
  @Permissao('negocio.read')
  @Contrato({
    resumo: 'Lê um negócio, com os requisitos da etapa atual',
    tags: ['crm'],
    params: PorId,
    resposta: NegocioDetalhado,
  })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @Permissao('negocio.create')
  @Contrato({
    resumo: 'Cria um negócio na primeira etapa do funil',
    descricao: 'Cria também as tarefas dos requisitos TAREFA da primeira etapa.',
    tags: ['crm'],
    corpo: EntradaNegocio,
    resposta: NegocioDetalhado,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaNegocio) {
    return this.executor.executarComando(contexto, comandos.criar, entrada);
  }

  @Patch(':id')
  @Permissao('negocio.update')
  @Contrato({
    resumo: 'Edita um negócio',
    descricao: VERSAO,
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoNegocio,
    resposta: NegocioDetalhado,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoNegocio,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Delete(':id')
  @Permissao('negocio.delete')
  @Contrato({
    resumo: 'Exclui um negócio (soft delete) e cancela as tarefas abertas dele',
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async excluir(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.excluir, id);
  }

  @Post(':id/mover')
  @Permissao('negocio.update')
  @Contrato({
    resumo: 'Move o negócio para outra etapa aberta (MoverNegocio)',
    descricao:
      'Avançar exige os requisitos obrigatórios da etapa atual (e das que forem puladas) ' +
      'atendidos; senão 409 `requisitos_pendentes` com a lista (CRM-3). Voltar não exige. Ganho ' +
      `só pela conversão do orçamento (409). Da nutrição, reativa o negócio. ${VERSAO}`,
    tags: ['crm'],
    params: PorId,
    corpo: EntradaMoverNegocio,
    resposta: NegocioDetalhado,
  })
  mover(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() entrada: EntradaMoverNegocio,
  ) {
    return this.executor.executarComando(contexto, comandos.mover, { id, entrada });
  }

  @Post(':id/perder')
  @Permissao('negocio.update')
  @Contrato({
    resumo: 'Marca o negócio como perdido (PerderNegocio)',
    descricao: `Exige motivo ativo (CRM-4); cancela as tarefas abertas. ${VERSAO}`,
    tags: ['crm'],
    params: PorId,
    corpo: EntradaPerderNegocio,
    resposta: NegocioDetalhado,
  })
  perder(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() entrada: EntradaPerderNegocio,
  ) {
    return this.executor.executarComando(contexto, comandos.perder, { id, entrada });
  }

  @Post(':id/nutrir')
  @Permissao('negocio.update')
  @Contrato({
    resumo: 'Leva o negócio para a nutrição até a data de reativação',
    descricao: `Cancela as tarefas de requisito abertas; as manuais continuam. ${VERSAO}`,
    tags: ['crm'],
    params: PorId,
    corpo: EntradaNutrirNegocio,
    resposta: NegocioDetalhado,
  })
  nutrir(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() entrada: EntradaNutrirNegocio,
  ) {
    return this.executor.executarComando(contexto, comandos.nutrir, { id, entrada });
  }
}
