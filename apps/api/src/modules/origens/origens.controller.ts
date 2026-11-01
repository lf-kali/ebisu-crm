import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  EdicaoMotivoPerda,
  EdicaoOrigem,
  EntradaMotivoPerda,
  EntradaOrigem,
  ListaMotivosPerda,
  ListaOrigens,
  MotivoPerda,
  Origem,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './origens.comandos.js';

// /v1/origens e /v1/motivos-perda (spec §5.3; plano docs/planos/f4-1-contatos.md, decisão 7):
// leitura com `contato.read` (as telas listam as opções), escrita com `config.crm`.

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

@Controller('origens')
export class OrigensController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('contato.read')
  @Contrato({
    resumo: 'Lista as origens de lead da empresa',
    tags: ['crm'],
    resposta: ListaOrigens,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao) {
    return this.executor.executarComando(contexto, comandos.listarOrigens, undefined);
  }

  @Get(':id')
  @Permissao('contato.read')
  @Contrato({ resumo: 'Lê uma origem de lead', tags: ['crm'], params: PorId, resposta: Origem })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.lerOrigem, id);
  }

  @Post()
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Cria uma origem de lead',
    tags: ['crm'],
    corpo: EntradaOrigem,
    resposta: Origem,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaOrigem) {
    return this.executor.executarComando(contexto, comandos.criarOrigem, entrada);
  }

  @Patch(':id')
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Edita uma origem de lead (inclusive reativar)',
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoOrigem,
    resposta: Origem,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoOrigem,
  ) {
    return this.executor.executarComando(contexto, comandos.editarOrigem, { id, edicao });
  }

  @Delete(':id')
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Desativa uma origem de lead',
    descricao: 'Os contatos que apontam para ela continuam apontando.',
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async desativar(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.desativarOrigem, id);
  }
}

@Controller('motivos-perda')
export class MotivosPerdaController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('contato.read')
  @Contrato({
    resumo: 'Lista os motivos de perda da empresa',
    tags: ['crm'],
    resposta: ListaMotivosPerda,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao) {
    return this.executor.executarComando(contexto, comandos.listarMotivos, undefined);
  }

  @Get(':id')
  @Permissao('contato.read')
  @Contrato({
    resumo: 'Lê um motivo de perda',
    tags: ['crm'],
    params: PorId,
    resposta: MotivoPerda,
  })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.lerMotivo, id);
  }

  @Post()
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Cria um motivo de perda',
    tags: ['crm'],
    corpo: EntradaMotivoPerda,
    resposta: MotivoPerda,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaMotivoPerda) {
    return this.executor.executarComando(contexto, comandos.criarMotivo, entrada);
  }

  @Patch(':id')
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Edita um motivo de perda (inclusive reativar)',
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoMotivoPerda,
    resposta: MotivoPerda,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoMotivoPerda,
  ) {
    return this.executor.executarComando(contexto, comandos.editarMotivo, { id, edicao });
  }

  @Delete(':id')
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Desativa um motivo de perda',
    descricao: 'Os negócios perdidos com ele continuam apontando.',
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async desativar(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.desativarMotivo, id);
  }
}
