import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  Consentimento,
  ConsultaContatos,
  Contato,
  EdicaoContato,
  EntradaConsentimento,
  EntradaContato,
  ListaConsentimentos,
  ListaContatos,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './contatos.comandos.js';

// /v1/contatos (spec §5.3; plano docs/planos/f4-1-contatos.md).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

@Controller('contatos')
export class ContatosController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('contato.read')
  @Contrato({
    resumo: 'Lista os contatos da empresa, dos mais recentes aos mais antigos',
    descricao:
      '`q` busca por nome (sem diferenciar acento), trecho do e-mail ou dígitos do telefone.',
    tags: ['crm'],
    query: ConsultaContatos,
    resposta: ListaContatos,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao, @Consulta() consulta: ConsultaContatos) {
    return this.executor.executarComando(contexto, comandos.listar, consulta);
  }

  @Get(':id')
  @Permissao('contato.read')
  @Contrato({ resumo: 'Lê um contato', tags: ['crm'], params: PorId, resposta: Contato })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @Permissao('contato.create')
  @Contrato({
    resumo: 'Cria um contato',
    descricao:
      'E-mail, telefone ou WhatsApp que já existe num contato da empresa dá 409 `duplicado` com ' +
      '`id_existente` e o `campo` que repetiu (CRM-1). Telefones entram como digitados e saem em E.164.',
    tags: ['crm'],
    corpo: EntradaContato,
    resposta: Contato,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaContato) {
    return this.executor.executarComando(contexto, comandos.criar, entrada);
  }

  @Patch(':id')
  @Permissao('contato.update')
  @Contrato({
    resumo: 'Edita um contato',
    descricao: '`null` remove um campo opcional; o contato não fica sem meio de contato.',
    tags: ['crm'],
    params: PorId,
    corpo: EdicaoContato,
    resposta: Contato,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoContato,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Delete(':id')
  @Permissao('contato.delete')
  @Contrato({
    resumo: 'Exclui um contato (soft delete)',
    descricao: 'Exclusão LGPD é a anonimização, em outra rota.',
    tags: ['crm'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async excluir(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.excluir, id);
  }

  @Get(':id/consentimentos')
  @Permissao('contato.read')
  @Contrato({
    resumo: 'Histórico de consentimentos do contato',
    tags: ['crm'],
    params: PorId,
    resposta: ListaConsentimentos,
  })
  consentimentos(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.listarConsentimentos, id);
  }

  @Post(':id/consentimentos')
  @Permissao('contato.update')
  @Contrato({
    resumo: 'Registra um consentimento (ou a revogação)',
    descricao: 'Só acrescenta: revogar é um registro novo com `concedido: false`.',
    tags: ['crm'],
    params: PorId,
    corpo: EntradaConsentimento,
    resposta: Consentimento,
    status: 201,
  })
  registrarConsentimento(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() entrada: EntradaConsentimento,
  ) {
    return this.executor.executarComando(contexto, comandos.registrarConsentimento, {
      id,
      entrada,
    });
  }
}
