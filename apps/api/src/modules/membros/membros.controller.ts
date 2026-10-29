import { Controller, Delete, Get, Inject, Patch, Post, Put, Res } from '@nestjs/common';
import {
  Convite,
  EdicaoMembro,
  EntradaConvite,
  ListaConvites,
  EntradaAtribuicoes,
  ListaMembros,
  ListaPapeis,
  Membro,
  ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { LIMITADOR, type Limitador } from '../../core/limite/limitador.js';
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

/**
 * Limites dos convites (cada um dispara um e-mail do sistema para fora): por conta, por e-mail de
 * destino e por convite reenviado. Sem eles, uma conta recém-cadastrada mandaria e-mails sem teto.
 */
const LIMITES_CONVITE = {
  conta: { maximo: 30, janela: 60 * 60 },
  destino: { maximo: 3, janela: 24 * 60 * 60 },
  reenvio: { maximo: 3, janela: 24 * 60 * 60 },
} as const;

/**
 * Convites (plano docs/planos/f3-4b2-convites.md). Registrado antes do MembrosController:
 * `GET /membros/convites` precisa vir antes de `GET /membros/:id`.
 */
@Controller('membros/convites')
export class ConvitesController {
  constructor(
    private readonly membros: MembrosService,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  /** Conta uma tentativa em cada chave; se alguma estourou, 429 com Retry-After. */
  private async limitar(
    res: Response,
    chaves: ReadonlyArray<[string, { maximo: number; janela: number }]>,
  ) {
    let espera = 0;
    for (const [chave, { maximo, janela }] of chaves)
      espera = Math.max(espera, await this.limitador.registrar(chave, maximo, janela));
    if (espera > 0) {
      res.setHeader('Retry-After', String(espera));
      throw new ErroDominio('limite_excedido');
    }
  }

  @Post()
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Convida uma pessoa para a conta, já com os papéis',
    descricao:
      'O e-mail sai pelo worker, com um link que vale 7 dias e uma vez. Exige também ' +
      `config.rbac (dar papéis). ${REGRA_DO_DONO}`,
    tags: ['membros'],
    corpo: EntradaConvite,
    resposta: Convite,
    status: 201,
  })
  async convidar(
    @ContextoConta() contexto: ContextoDaConta,
    @Corpo() entrada: EntradaConvite,
    @Res({ passthrough: true }) res: Response,
  ) {
    const email = entrada.email.trim().toLowerCase();
    await this.limitar(res, [
      [`convite:conta:${contexto.tenantId}`, LIMITES_CONVITE.conta],
      [`convite:destino:${contexto.tenantId}:${email}`, LIMITES_CONVITE.destino],
    ]);
    return this.membros.convidar(contexto, entrada);
  }

  @Get()
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Lista os convites pendentes',
    tags: ['membros'],
    query: ParametrosPaginacao,
    resposta: ListaConvites,
  })
  listar(@ContextoConta() contexto: ContextoDaConta, @Consulta() query: ParametrosPaginacao) {
    return this.membros.listarConvites(contexto, query);
  }

  @Post(':id/reenviar')
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Reenvia o convite',
    descricao: 'Renova a validade e invalida o link anterior. Exige também config.rbac.',
    tags: ['membros'],
    params: PorId,
    resposta: Convite,
  })
  async reenviar(
    @ContextoConta() contexto: ContextoDaConta,
    @Parametros() { id }: PorId,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limitar(res, [
      [`convite:conta:${contexto.tenantId}`, LIMITES_CONVITE.conta],
      [`convite:reenvio:${contexto.tenantId}:${id}`, LIMITES_CONVITE.reenvio],
    ]);
    return this.membros.reenviarConvite(contexto, id);
  }

  @Delete(':id')
  @PermissaoNaConta('config.membros')
  @Contrato({
    resumo: 'Revoga o convite',
    descricao: 'O link deixa de valer na hora. Convite já aceito: 409.',
    tags: ['membros'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async revogar(@ContextoConta() contexto: ContextoDaConta, @Parametros() { id }: PorId) {
    await this.membros.revogarConvite(contexto, id);
  }
}

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
