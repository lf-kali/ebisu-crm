import { randomUUID } from 'node:crypto';
import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  EntradaLogin,
  EntradaRegistro,
  EntradaTrocarConta,
  RespostaSessao,
} from '@ebisu/contracts';
import type { Request, Response } from 'express';
import { Contrato, Corpo } from '../../core/contrato/contrato.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { LIMITADOR, type Limitador } from '../../core/limite/limitador.js';
import { requestIdDa } from '../../core/requisicao/request-id.js';
import { apagarRefresh, gravarRefresh, lerRefresh } from './cookie-refresh.js';
import type { RequisicaoAutenticada } from '../../core/rbac/guarda-contexto.js';
import { Publica, SoAutenticado } from '../../core/rbac/marcas.js';
import { GuardaOrigem } from './guardas.js';
import { RegistroService } from './registro.service.js';
import { normalizarEmail, type Origem, SessoesService } from './sessoes.service.js';

// Rotas de auth (§5.3; contrato em packages/contracts/src/plataforma/auth.ts). Ignoram a
// Idempotency-Key: um cache de idempotência nunca pode devolver um token antigo.

interface Limite {
  maximo: number;
  /** Segundos. */
  janela: number;
}

/** Tentativas de login: por IP e por e-mail (§7). */
const LIMITE_POR_IP: Limite = { maximo: 30, janela: 60 };
const LIMITE_POR_EMAIL: Limite = { maximo: 10, janela: 15 * 60 };
/** Cadastros: 5 por hora por IP e por e-mail (plano f3-4a, decisão 5). */
const LIMITE_CADASTRO: Limite = { maximo: 5, janela: 60 * 60 };

const origemDe = (req: Request): Origem => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

/** Só JSON: um formulário de outro site (urlencoded, sem preflight de CORS) não entra. */
function exigirJson(req: Request): void {
  if (!req.is('application/json'))
    throw new ErroDominio('validacao', { detail: 'Envie o corpo em JSON (application/json).' });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessoes: SessoesService,
    private readonly registro: RegistroService,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  /** Conta uma tentativa por IP e por e-mail; estourado, 429 com Retry-After. */
  private async limitar(
    rota: string,
    req: Request,
    res: Response,
    email: string,
    limites: { ip: Limite; email: Limite },
  ): Promise<void> {
    const espera = Math.max(
      await this.limitador.registrar(`${rota}:ip:${req.ip}`, limites.ip.maximo, limites.ip.janela),
      await this.limitador.registrar(
        `${rota}:email:${normalizarEmail(email)}`,
        limites.email.maximo,
        limites.email.janela,
      ),
    );
    if (espera > 0) {
      res.setHeader('Retry-After', String(espera));
      throw new ErroDominio('limite_excedido');
    }
  }

  @Post('registrar')
  @Publica()
  @Contrato({
    resumo: 'Cadastra uma conta com a primeira empresa e já entra',
    descricao:
      'Cria a conta (em teste), a empresa e o dono, e abre a sessão como no login. E-mail já ' +
      'cadastrado: a senha precisa ser a dele (senão 401) e a conta nova fica com o mesmo usuário.',
    tags: ['auth'],
    corpo: EntradaRegistro,
    resposta: RespostaSessao,
    status: 201,
  })
  async registrar(
    @Corpo() entrada: EntradaRegistro,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    exigirJson(req);
    await this.limitar('registro', req, res, entrada.email, {
      ip: LIMITE_CADASTRO,
      email: LIMITE_CADASTRO,
    });
    const { resposta, refresh } = await this.registro.registrar(entrada, {
      ...origemDe(req),
      requestId: requestIdDa(res) ?? randomUUID(),
    });
    gravarRefresh(res, refresh);
    return resposta;
  }

  @Post('login')
  @Publica()
  @Contrato({
    resumo: 'Entra com e-mail e senha',
    descricao:
      'Abre a sessão na conta usada por último. O refresh token vai só no cookie httpOnly.',
    tags: ['auth'],
    corpo: EntradaLogin,
    resposta: RespostaSessao,
  })
  async login(
    @Corpo() entrada: EntradaLogin,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    exigirJson(req);
    await this.limitar('login', req, res, entrada.email, {
      ip: LIMITE_POR_IP,
      email: LIMITE_POR_EMAIL,
    });
    const { resposta, refresh } = await this.sessoes.entrar(entrada, origemDe(req));
    gravarRefresh(res, refresh);
    return resposta;
  }

  @Post('refresh')
  @Publica()
  @UseGuards(GuardaOrigem)
  @Contrato({
    resumo: 'Renova a sessão pelo cookie de refresh (rotativo)',
    descricao: 'Reusar um refresh token já trocado revoga a família inteira da sessão.',
    tags: ['auth'],
    resposta: RespostaSessao,
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    try {
      const { resposta, refresh } = await this.sessoes.renovar(lerRefresh(req), origemDe(req));
      gravarRefresh(res, refresh);
      return resposta;
    } catch (erro) {
      // Sessão inválida: o cookie não serve para mais nada. Falha transitória (5xx) não apaga:
      // o usuário não pode ser deslogado por uma instabilidade do banco.
      if (erro instanceof ErroDominio && erro.code === 'nao_autenticado') apagarRefresh(res);
      throw erro;
    }
  }

  @Post('trocar-conta')
  @SoAutenticado()
  @UseGuards(GuardaOrigem)
  @Contrato({
    resumo: 'Troca a sessão para outra conta do usuário',
    tags: ['auth'],
    corpo: EntradaTrocarConta,
    resposta: RespostaSessao,
  })
  async trocarConta(
    @Corpo() entrada: EntradaTrocarConta,
    @Req() req: RequisicaoAutenticada,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    const { resposta, refresh } = await this.sessoes.trocarConta(
      req.identidade,
      entrada.tenant_id,
      lerRefresh(req),
      origemDe(req),
    );
    gravarRefresh(res, refresh);
    return resposta;
  }

  @Post('logout')
  @Publica()
  @UseGuards(GuardaOrigem)
  @Contrato({
    resumo: 'Encerra a sessão (revoga o refresh)',
    tags: ['auth'],
    resposta: null,
    status: 204,
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    try {
      await this.sessoes.sair(lerRefresh(req));
    } finally {
      apagarRefresh(res);
    }
  }
}
