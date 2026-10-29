import { Controller, Get, Patch, Put } from '@nestjs/common';
import {
  EdicaoMembro,
  EntradaAtribuicoes,
  ListaMembros,
  ListaPapeis,
  Membro,
  ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { ContextoConta } from '../../core/rbac/guarda-contexto.js';
import { PermissaoNaConta } from '../../core/rbac/marcas.js';
import type { ContextoDaConta } from '../../core/tx/contexto.js';
import { MembrosService } from './membros.service.js';

// Membros e papéis da conta (spec §5.3; plano docs/planos/f3-4b1-membros-papeis.md).

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

const REGRA_DO_DONO =
  'Dar ou tirar o papel de dono (OWNER), ou suspender um dono, exige ser dono (403). A conta ' +
  'nunca fica sem um dono ativo (409 transicao_invalida).';

@Controller('membros')
export class MembrosController {
  constructor(private readonly membros: MembrosService) {}

  @Get()
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Lista os membros da conta',
    tags: ['membros'],
    query: ParametrosPaginacao,
    resposta: ListaMembros,
  })
  listar(@ContextoConta() contexto: ContextoDaConta, @Consulta() query: ParametrosPaginacao) {
    return this.membros.listar(contexto, query);
  }

  @Get(':id')
  @PermissaoNaConta('config.membros')
  @Contrato({ resumo: 'Lê um membro', tags: ['membros'], params: PorId, resposta: Membro })
  ler(@ContextoConta() contexto: ContextoDaConta, @Parametros() { id }: PorId) {
    return this.membros.ler(contexto, id);
  }

  @Patch(':id')
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Edita o cargo ou suspende/reativa um membro',
    descricao: `Ninguém muda o próprio status (409). ${REGRA_DO_DONO}`,
    tags: ['membros'],
    params: PorId,
    corpo: EdicaoMembro,
    resposta: Membro,
  })
  editar(
    @ContextoConta() contexto: ContextoDaConta,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoMembro,
  ) {
    return this.membros.editar(contexto, id, edicao);
  }

  @Put(':id/atribuicoes')
  @PermissaoNaConta('config.rbac')
  @Contrato({
    resumo: 'Define os papéis do membro em cada empresa',
    descricao: `Substitui todas as atribuições. ${REGRA_DO_DONO}`,
    tags: ['membros'],
    params: PorId,
    corpo: EntradaAtribuicoes,
    resposta: Membro,
  })
  atribuir(
    @ContextoConta() contexto: ContextoDaConta,
    @Parametros() { id }: PorId,
    @Corpo() entrada: EntradaAtribuicoes,
  ) {
    return this.membros.atribuir(contexto, id, entrada);
  }
}

@Controller('papeis')
export class PapeisController {
  constructor(private readonly membros: MembrosService) {}

  @Get()
  @PermissaoNaConta('config.rbac')
  @Contrato({
    resumo: 'Lista os papéis da conta com as permissões',
    tags: ['membros'],
    resposta: ListaPapeis,
  })
  listar(@ContextoConta() contexto: ContextoDaConta) {
    return this.membros.papeis(contexto);
  }
}
