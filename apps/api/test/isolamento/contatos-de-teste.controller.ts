import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { Uuid } from '@ebisu/contracts';
import { z } from 'zod';
import { Contrato, Corpo, Parametros } from '../../src/core/contrato/contrato.js';
import { ErroDominio } from '../../src/core/erros/erro-dominio.js';
import { Contexto } from '../../src/core/rbac/guarda-contexto.js';
import { Permissao } from '../../src/core/rbac/marcas.js';
import { filtroDeEscopo } from '../../src/core/rbac/permissoes.js';
import type { ContextoDaRequisicao, TxContext } from '../../src/core/tx/contexto.js';
import { comReferencias, ExecutorDeComandos } from '../../src/core/tx/executar.js';

// Rota de domínio SÓ para testes (F3-2): exercita o guard, o executarComando e o filtro de
// escopo sobre a tabela `contato`, como uma frente de domínio faria no repositório.

const ContatoDeTeste = z.object({
  id: Uuid,
  empresa_id: Uuid,
  nome: z.string(),
  responsavel_id: Uuid.nullable(),
  origem_id: Uuid.nullable(),
});
const Lista = z.object({ dados: z.array(ContatoDeTeste) });
const PorId = z.object({ id: Uuid });
const Criar = z.object({
  nome: z.string().min(1),
  origem_id: Uuid.optional(),
  responsavel_id: Uuid.optional(),
});
const Editar = z.object({ nome: z.string().min(1) });

const CAMPOS = { id: true, empresa_id: true, nome: true, responsavel_id: true, origem_id: true };

/** O `where` de todo acesso: a empresa do contexto e, se o escopo for PROPRIO, o responsável. */
const daEmpresa = (ctx: TxContext, chave: string) => ({
  empresa_id: ctx.empresaId,
  ...filtroDeEscopo(ctx, chave, 'responsavel_id'),
});

@Controller('teste/contatos')
export class ContatosDeTesteController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('contato.read')
  @Contrato({ resumo: 'Lista (teste)', resposta: Lista })
  listar(@Contexto() contexto: ContextoDaRequisicao) {
    return this.executor.executarComando(
      contexto,
      async (ctx) => ({
        dados: await ctx.tx.contato.findMany({
          where: daEmpresa(ctx, 'contato.read'),
          select: CAMPOS,
          orderBy: { nome: 'asc' },
        }),
      }),
      undefined,
    );
  }

  @Get(':id')
  @Permissao('contato.read')
  @Contrato({ resumo: 'Lê (teste)', params: PorId, resposta: ContatoDeTeste })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: z.infer<typeof PorId>) {
    return this.executor.executarComando(
      contexto,
      async (ctx) => {
        const contato = await ctx.tx.contato.findFirst({
          where: { id, ...daEmpresa(ctx, 'contato.read') },
          select: CAMPOS,
        });
        if (!contato) throw new ErroDominio('nao_encontrado');
        return contato;
      },
      undefined,
    );
  }

  @Post()
  @Permissao('contato.create')
  @Contrato({ resumo: 'Cria (teste)', corpo: Criar, resposta: ContatoDeTeste, status: 201 })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: z.infer<typeof Criar>) {
    return this.executor.executarComando(
      contexto,
      (ctx, dados) =>
        comReferencias(
          ctx.tx.contato.create({
            data: {
              tenant_id: ctx.tenantId,
              empresa_id: ctx.empresaId,
              nome: dados.nome,
              // O banco exige um meio de contato (contato_meio_contato_ck).
              email: 'contato@isolamento.local',
              origem_id: dados.origem_id ?? null,
              responsavel_id: dados.responsavel_id ?? ctx.membroId,
              campos_faltantes: [],
            },
            select: CAMPOS,
          }),
        ),
      entrada,
    );
  }

  @Patch(':id')
  @Permissao('contato.update')
  @Contrato({ resumo: 'Edita (teste)', params: PorId, corpo: Editar, resposta: ContatoDeTeste })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: z.infer<typeof PorId>,
    @Corpo() entrada: z.infer<typeof Editar>,
  ) {
    return this.executor.executarComando(
      contexto,
      async (ctx, dados) => {
        const where = { id, ...daEmpresa(ctx, 'contato.update') };
        const { count } = await ctx.tx.contato.updateMany({ where, data: { nome: dados.nome } });
        if (count === 0) throw new ErroDominio('nao_encontrado');
        return ctx.tx.contato.findFirstOrThrow({ where, select: CAMPOS });
      },
      entrada,
    );
  }

  @Delete(':id')
  @Permissao('contato.delete')
  @Contrato({ resumo: 'Exclui (teste)', params: PorId, resposta: null, status: 204 })
  async excluir(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: z.infer<typeof PorId>,
  ) {
    await this.executor.executarComando(
      contexto,
      async (ctx) => {
        const { count } = await ctx.tx.contato.deleteMany({
          where: { id, ...daEmpresa(ctx, 'contato.delete') },
        });
        if (count === 0) throw new ErroDominio('nao_encontrado');
      },
      undefined,
    );
  }
}
