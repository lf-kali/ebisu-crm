import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  EdicaoEmpresa,
  Empresa,
  EntradaEmpresa,
  ListaEmpresas,
  ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { ContextoConta } from '../../core/rbac/guarda-contexto.js';
import { PermissaoNaConta } from '../../core/rbac/marcas.js';
import type { ContextoDaConta } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './empresas.service.js';

// CRUD /v1/empresas (spec §4 F3; plano docs/planos/f3-4a-cadastro-empresas.md, decisões 8 e 9).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @PermissaoNaConta('config.empresa')
  @Contrato({
    resumo: 'Lista as empresas da conta, ativas e inativas',
    tags: ['empresas'],
    query: ParametrosPaginacao,
    resposta: ListaEmpresas,
  })
  listar(@ContextoConta() contexto: ContextoDaConta, @Consulta() query: ParametrosPaginacao) {
    return this.executor.executarComando(contexto, comandos.listar, query);
  }

  @Get(':id')
  @PermissaoNaConta('config.empresa')
  @Contrato({ resumo: 'Lê uma empresa', tags: ['empresas'], params: PorId, resposta: Empresa })
  ler(@ContextoConta() contexto: ContextoDaConta, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @PermissaoNaConta('config.empresa')
  @Contrato({
    resumo: 'Cria uma empresa na conta',
    descricao: 'A empresa nasce com o funil, as origens e os motivos de perda padrão.',
    tags: ['empresas'],
    corpo: EntradaEmpresa,
    resposta: Empresa,
    status: 201,
  })
  criar(@ContextoConta() contexto: ContextoDaConta, @Corpo() entrada: EntradaEmpresa) {
    return this.executor.executarComando(contexto, comandos.criar, entrada);
  }

  @Patch(':id')
  @PermissaoNaConta('config.empresa')
  @Contrato({
    resumo: 'Edita uma empresa',
    tags: ['empresas'],
    params: PorId,
    corpo: EdicaoEmpresa,
    resposta: Empresa,
  })
  editar(
    @ContextoConta() contexto: ContextoDaConta,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoEmpresa,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Delete(':id')
  @PermissaoNaConta('config.empresa')
  @Contrato({
    resumo: 'Desativa uma empresa',
    descricao:
      'A empresa sai do seletor e das rotas de domínio; o histórico fica. A última empresa ' +
      'ativa da conta não pode ser desativada (409 transicao_invalida).',
    tags: ['empresas'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async desativar(@ContextoConta() contexto: ContextoDaConta, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.desativar, id);
  }
}
