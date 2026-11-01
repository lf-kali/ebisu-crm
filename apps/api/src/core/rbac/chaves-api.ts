import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '@ebisu/contracts';
import { comTenant, hashDaApiKey, prefixoDaApiKey, type PrismaClient } from '@ebisu/db';
import type { Request, Response } from 'express';
import { STATUS_CONTA_ATIVA } from '../../modules/auth/sessoes.service.js';
import { PRISMA_APP, PRISMA_AUTH } from '../banco/banco.module.js';
import { ErroDominio } from '../erros/erro-dominio.js';
import { idempotenciaDa } from '../idempotencia/idempotencia.js';
import { LIMITADOR, type Limitador } from '../limite/limitador.js';
import type { ContextoDaRequisicao } from '../tx/contexto.js';
import { type Acesso, PREFIXO_ROTAS_PUBLICAS } from './marcas.js';

// Autenticação por API key (plano docs/planos/f3-5-api-keys-cors.md, decisões 2, 7, 8, 9 e 11).
// O guard chama daqui nas rotas que aceitam chave; o resto do guard não muda.

export const CABECALHO_API_KEY = 'x-api-key';

/** Decisão 11: falhas de chave por IP; rotas públicas por chave e por IP. Janelas de 1 minuto. */
export const LIMITES_API_KEY = {
  falhasPorIp: 20,
  publicaPorChave: 60,
  publicaPorIp: 30,
  janela: 60,
} as const;

export type AcessoPorChave =
  Extract<Acesso, { tipo: 'permissao' }> | Extract<Acesso, { tipo: 'publica_api_key' }>;

interface ChaveValida {
  id: string;
  tenantId: string;
  empresaId: string;
  tipo: 'SERVIDOR' | 'NAVEGADOR';
  escopos: string[];
  origens: string[];
}

const naoAutenticado = () => new ErroDominio('nao_autenticado');

function limiteExcedido(res: Response, espera: number): ErroDominio {
  res.setHeader('Retry-After', String(espera));
  return new ErroDominio('limite_excedido');
}

/** Hashes em hex do mesmo tamanho, comparados em tempo constante. */
function mesmoHash(salvo: string, recebido: string): boolean {
  const [a, b] = [Buffer.from(salvo, 'hex'), Buffer.from(recebido, 'hex')];
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class ChavesApi {
  constructor(
    @Inject(PRISMA_AUTH) private readonly auth: PrismaClient,
    @Inject(PRISMA_APP) private readonly app: PrismaClient,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  /** Valida a chave para a rota e devolve o contexto do comando (sem membro). */
  async autenticar(
    req: Request,
    res: Response,
    acesso: AcessoPorChave,
    requestId: string,
  ): Promise<ContextoDaRequisicao> {
    // Erro de programação: fora de /v1/publico/ a rota não teria o CORS (decisão 9).
    if (
      acesso.tipo === 'publica_api_key' &&
      !req.path.toLowerCase().startsWith(PREFIXO_ROTAS_PUBLICAS)
    )
      throw new Error(`@ApiKeyPublica fora de ${PREFIXO_ROTAS_PUBLICAS}: ${req.path}`);
    // Bearer e chave juntos: não se escolhe um dos dois (decisão 7).
    if (req.headers.authorization !== undefined) throw naoAutenticado();
    const chave = await this.chaveValida(req, res, acesso);
    this.conferirOrigem(req, res, chave);
    if (!chave.escopos.includes(acesso.chave)) throw new ErroDominio('sem_permissao');
    if (acesso.tipo === 'publica_api_key') await this.limitarPublica(req, res, chave.id);
    if (acesso.tipo === 'permissao') this.conferirEmpresa(req, chave.empresaId);
    await this.marcarUso(chave);

    return {
      tenantId: chave.tenantId,
      empresaId: chave.empresaId,
      membroId: null,
      apiKeyId: chave.id,
      // Sem membro, o PROPRIO não tem a quem se referir: cada escopo vale na empresa (decisão 5).
      permissoes: new Map(chave.escopos.map((escopo) => [escopo, 'EMPRESA'] as const)),
      requestId,
      ip: req.ip ?? null,
      ...(req.method === 'POST'
        ? { idempotencia: idempotenciaDa(req, chave.empresaId, `apikey:${chave.id}`) }
        : {}),
    };
  }

  /** A chave do cabeçalho, se vale para esta rota; senão 401 (e a falha conta para o IP). */
  private async chaveValida(
    req: Request,
    res: Response,
    acesso: AcessoPorChave,
  ): Promise<ChaveValida> {
    const ip = `apikey-falha:${req.ip ?? 'desconhecido'}`;
    const bloqueio = await this.limitador.consultar(ip, LIMITES_API_KEY.falhasPorIp);
    if (bloqueio > 0) throw limiteExcedido(res, bloqueio);

    const chave = await this.buscar(req.get(CABECALHO_API_KEY) ?? '');
    const tipo = acesso.tipo === 'publica_api_key' ? 'NAVEGADOR' : 'SERVIDOR';
    if (chave && chave.tipo === tipo) return chave;

    const espera = await this.limitador.registrar(
      ip,
      LIMITES_API_KEY.falhasPorIp,
      LIMITES_API_KEY.janela,
    );
    if (espera > 0) throw limiteExcedido(res, espera);
    throw naoAutenticado();
  }

  /**
   * Pelo prefixo, com o ebisu_auth (ainda não se sabe a conta). Só devolve a chave com o hash
   * igual, não revogada, não vencida, de empresa ativa numa conta em teste ou ativa.
   */
  private async buscar(token: string): Promise<ChaveValida | null> {
    const prefixo = prefixoDaApiKey(token);
    if (!prefixo) return null;
    const linha = await this.auth.apiKey.findUnique({
      where: { prefixo },
      select: {
        id: true,
        tenant_id: true,
        empresa_id: true,
        hash: true,
        tipo: true,
        escopos: true,
        origens_cors: true,
        expira_em: true,
        revogada_em: true,
        empresa: {
          select: { ativo: true, deleted_at: true, tenant: { select: { status: true } } },
        },
      },
    });
    if (!linha || !mesmoHash(linha.hash, hashDaApiKey(token))) return null;
    const { empresa } = linha;
    const valida =
      !linha.revogada_em &&
      (!linha.expira_em || linha.expira_em > new Date()) &&
      empresa.ativo &&
      !empresa.deleted_at &&
      (STATUS_CONTA_ATIVA as readonly string[]).includes(empresa.tenant.status);
    if (!valida) return null;
    return {
      id: linha.id,
      tenantId: linha.tenant_id,
      empresaId: linha.empresa_id,
      tipo: linha.tipo,
      escopos: linha.escopos,
      origens: linha.origens_cors,
    };
  }

  /**
   * Servidor: vinda de navegador (com Origin) é recusada. Navegador: o Origin precisa estar na
   * lista; só então a resposta libera a leitura para essa origem exata (CORS, decisão 9).
   */
  private conferirOrigem(req: Request, res: Response, chave: ChaveValida): void {
    const origem = req.get('origin');
    if (chave.tipo === 'SERVIDOR') {
      if (origem !== undefined) throw new ErroDominio('sem_permissao');
      return;
    }
    if (!origem || !chave.origens.includes(origem)) throw new ErroDominio('sem_permissao');
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
  }

  /**
   * Primeiro o IP; a cota da chave só conta quem está dentro do limite do IP. Assim um IP sozinho
   * não esgota a chave do site (pública no JavaScript) para todos os visitantes.
   */
  private async limitarPublica(req: Request, res: Response, chaveId: string): Promise<void> {
    const { publicaPorChave, publicaPorIp, janela } = LIMITES_API_KEY;
    const ip = `apikey-ip:${req.ip ?? 'desconhecido'}`;
    const porIp = await this.limitador.registrar(ip, publicaPorIp, janela);
    if (porIp > 0) throw limiteExcedido(res, porIp);
    const porChave = await this.limitador.registrar(`apikey:${chaveId}`, publicaPorChave, janela);
    if (porChave > 0) throw limiteExcedido(res, porChave);
  }

  /** A empresa é a da chave; um X-Empresa-Id diferente não troca de empresa (decisão 7). */
  private conferirEmpresa(req: Request, empresaId: string): void {
    const valor = req.get('x-empresa-id');
    if (valor === undefined) return;
    const empresa = Uuid.safeParse(valor);
    if (!empresa.success || empresa.data !== empresaId)
      throw new ErroDominio('empresa_nao_autorizada');
  }

  /** No máximo uma escrita por minuto por chave (decisão 8); a auditoria ignora esta coluna. */
  private async marcarUso({ id, tenantId }: ChaveValida): Promise<void> {
    await comTenant(
      this.app,
      tenantId,
      (tx) =>
        tx.$executeRaw`
        UPDATE api_key SET ultimo_uso = now() AT TIME ZONE 'utc'
         WHERE id = ${id}::uuid
           AND (ultimo_uso IS NULL OR ultimo_uso < (now() AT TIME ZONE 'utc') - interval '1 minute')`,
    );
  }
}
