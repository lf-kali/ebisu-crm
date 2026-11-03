import { Controller, Get, Patch } from '@nestjs/common';
import { EdicaoFunil, Funil } from '@ebisu/contracts';
import { Contrato, Corpo } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './funil.comandos.js';

// /v1/funil (spec §5.3; plano docs/planos/f4-2a-funil-negocios-tarefas.md, decisões 1 e 2).

@Controller('funil')
export class FunilController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('negocio.read')
  @Contrato({
    resumo: 'Lê o funil padrão da empresa, com etapas e requisitos',
    tags: ['crm'],
    resposta: Funil,
  })
  ler(@Contexto() contexto: ContextoDaRequisicao) {
    return this.executor.executarComando(contexto, comandos.ler, undefined);
  }

  @Patch()
  @Permissao('config.crm')
  @Contrato({
    resumo: 'Edita etapas e requisitos do funil',
    descricao:
      'O corpo traz todas as etapas, pelo id; não se criam nem se apagam etapas. Os requisitos de ' +
      'cada etapa são trocados pela lista enviada (sem id = novo). Recalcula a completude dos ' +
      'negócios abertos e dos contatos da empresa (CRM-6).',
    tags: ['crm'],
    corpo: EdicaoFunil,
    resposta: Funil,
  })
  editar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() edicao: EdicaoFunil) {
    return this.executor.executarComando(contexto, comandos.editar, edicao);
  }
}
