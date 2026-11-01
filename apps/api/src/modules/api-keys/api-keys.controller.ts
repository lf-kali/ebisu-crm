import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  ApiKey,
  ApiKeyCriada,
  EdicaoApiKey,
  EntradaApiKey,
  ListaApiKeys,
  ParametrosPaginacao,
  Uuid,
} from '@ebisu/contracts';
import { z } from 'zod';
import { Consulta, Contrato, Corpo, Parametros } from '../../core/contrato/contrato.js';
import { Contexto } from '../../core/rbac/guarda-contexto.js';
import { Permissao } from '../../core/rbac/marcas.js';
import type { ContextoDaRequisicao } from '../../core/tx/contexto.js';
import { ExecutorDeComandos } from '../../core/tx/executar.js';
import * as comandos from './api-keys.comandos.js';

// CRUD /v1/api-keys (spec §5.3; plano docs/planos/f3-5-api-keys-cors.md, decisão 4). As rotas de
// gestão não aceitam API key: uma chave não cria outra.

const PorId = z.object({ id: Uuid });
type PorId = z.infer<typeof PorId>;

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly executor: ExecutorDeComandos) {}

  @Get()
  @Permissao('config.api_keys')
  @Contrato({
    resumo: 'Lista as API keys da empresa, revogadas incluídas',
    tags: ['api-keys'],
    query: ParametrosPaginacao,
    resposta: ListaApiKeys,
  })
  listar(@Contexto() contexto: ContextoDaRequisicao, @Consulta() query: ParametrosPaginacao) {
    return this.executor.executarComando(contexto, comandos.listar, query);
  }

  @Get(':id')
  @Permissao('config.api_keys')
  @Contrato({ resumo: 'Lê uma API key', tags: ['api-keys'], params: PorId, resposta: ApiKey })
  ler(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    return this.executor.executarComando(contexto, comandos.ler, id);
  }

  @Post()
  @Permissao('config.api_keys')
  @Contrato({
    resumo: 'Cria uma API key',
    descricao:
      'O token (campo `token`) só aparece nesta resposta. Repetir com a mesma Idempotency-Key ' +
      'devolve a chave com `token: null`: quem perdeu o token revoga a chave e cria outra. ' +
      'Escopos: permissões que você tem nesta empresa, nunca config.*.',
    tags: ['api-keys'],
    corpo: EntradaApiKey,
    resposta: ApiKeyCriada,
    status: 201,
  })
  criar(@Contexto() contexto: ContextoDaRequisicao, @Corpo() entrada: EntradaApiKey) {
    return this.executor.executarComando(contexto, comandos.criar, entrada, {
      paraGuardar: (criada) => ({ ...criada, token: null }),
    });
  }

  @Patch(':id')
  @Permissao('config.api_keys')
  @Contrato({
    resumo: 'Edita uma API key',
    descricao: 'O tipo não muda. Chave revogada não pode ser editada (409 transicao_invalida).',
    tags: ['api-keys'],
    params: PorId,
    corpo: EdicaoApiKey,
    resposta: ApiKey,
  })
  editar(
    @Contexto() contexto: ContextoDaRequisicao,
    @Parametros() { id }: PorId,
    @Corpo() edicao: EdicaoApiKey,
  ) {
    return this.executor.executarComando(contexto, comandos.editar, { id, edicao });
  }

  @Delete(':id')
  @Permissao('config.api_keys')
  @Contrato({
    resumo: 'Revoga uma API key',
    descricao: 'A chave para de valer na hora e continua na lista, com `revogada_em`.',
    tags: ['api-keys'],
    params: PorId,
    resposta: null,
    status: 204,
  })
  async revogar(@Contexto() contexto: ContextoDaRequisicao, @Parametros() { id }: PorId) {
    await this.executor.executarComando(contexto, comandos.revogar, id);
  }
}
