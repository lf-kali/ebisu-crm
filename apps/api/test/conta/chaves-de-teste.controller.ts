import { Controller, Get, Post } from '@nestjs/common';
import { Uuid } from '@ebisu/contracts';
import { z } from 'zod';
import { Contrato, Corpo } from '../../src/core/contrato/contrato.js';
import { Contexto } from '../../src/core/rbac/guarda-contexto.js';
import { ApiKeyPublica, Permissao } from '../../src/core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../src/core/tx/contexto.js';
import { ExecutorDeComandos } from '../../src/core/tx/executar.js';

// Rotas SÓ para testes (F3-5): ainda não há rota de negócio que aceite API key (a primeira é a
// captura de lead da F4). Exercitam o guard, o CORS, a idempotência e a auditoria com chave.

const Eco = z.object({
  empresa_id: Uuid,
  membro_id: Uuid.nullable(),
  api_key_id: Uuid.nullable(),
  escopos: z.array(z.string()),
});
const Criar = z.object({ nome: z.string().min(1) });
const Criado = z.object({ id: Uuid });

const eco = (ctx: ContextoDaRequisicao) => ({
  empresa_id: ctx.empresaId,
  membro_id: ctx.membroId,
  api_key_id: ctx.apiKeyId,
  escopos: [...ctx.permissoes.keys()].sort(),
});

@Controller()
export class ChavesDeTesteController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get('teste/chaves/eco')
  @Permissao('contato.read', { apiKey: true })
  @Contrato({ resumo: 'Eco do contexto (teste)', resposta: Eco })
  eco(@Contexto() contexto: ContextoDaRequisicao) {
    return eco(contexto);
  }

  @Get('teste/chaves/sem-marca')
  @Permissao('contato.read')
  @Contrato({ resumo: 'Rota sem a opção apiKey (teste)', resposta: Eco })
  semMarca(@Contexto() contexto: ContextoDaRequisicao) {
    return eco(contexto);
  }

  @Post('teste/chaves/contatos')
  @Permissao('contato.create', { apiKey: true })
  @Contrato({
    resumo: 'Cria contato com chave (teste)',
    corpo: Criar,
    resposta: Criado,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: z.infer<typeof Criar>) {
    return this.executor.executarComando(
      contexto,
      (ctx, dados) =>
        ctx.tx.contato.create({
          data: {
            tenant_id: ctx.tenantId,
            empresa_id: ctx.empresaId,
            nome: dados.nome,
            email: 'contato@chave.local',
            campos_faltantes: [],
          },
          select: { id: true },
        }),
      entrada,
    );
  }

  @Post('publico/teste')
  @ApiKeyPublica('lead.create')
  @Contrato({
    resumo: 'Rota pública com chave de navegador (teste)',
    corpo: Criar,
    resposta: Eco,
    status: 201,
  })
  publica(@Contexto() contexto: ContextoDaRequisicao) {
    return eco(contexto);
  }
}
