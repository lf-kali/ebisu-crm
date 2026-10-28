import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { EntradaLogin, EntradaTrocarConta, RespostaSessao } from '@ebisu/contracts';
import type { Request, Response } from 'express';
import { Contrato, Corpo } from '../../core/contrato/contrato.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { LIMITADOR, type Limitador } from '../../core/limite/limitador.js';
import { apagarRefresh, gravarRefresh, lerRefresh } from './cookie-refresh.js';
import { GuardaBearer, GuardaOrigem, type RequisicaoAutenticada } from './guardas.js';
import { normalizarEmail, type Origem, SessoesService } from './sessoes.service.js';

// Rotas de auth (§5.3; contrato em packages/contracts/src/plataforma/auth.ts). Ignoram a
// Idempotency-Key: um cache de idempotência nunca pode devolver um token antigo.

/** Tentativas de login: por IP e por e-mail (§7). */
const LIMITE_POR_IP = { maximo: 30, janela: 60 };
const LIMITE_POR_EMAIL = { maximo: 10, janela: 15 * 60 };

const origemDe = (req: Request): Origem => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessoes: SessoesService,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  @Post('login')
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
    // Só JSON: um formulário de outro site (urlencoded, sem preflight de CORS) não faz login.
    if (!req.is('application/json'))
      throw new ErroDominio('validacao', { detail: 'Envie o corpo em JSON (application/json).' });
    const espera = Math.max(
      await this.limitador.registrar(
        `login:ip:${req.ip}`,
        LIMITE_POR_IP.maximo,
        LIMITE_POR_IP.janela,
      ),
      await this.limitador.registrar(
        `login:email:${normalizarEmail(entrada.email)}`,
        LIMITE_POR_EMAIL.maximo,
        LIMITE_POR_EMAIL.janela,
      ),
    );
    if (espera > 0) {
      res.setHeader('Retry-After', String(espera));
      throw new ErroDominio('limite_excedido');
    }
    const { resposta, refresh } = await this.sessoes.entrar(entrada, origemDe(req));
    gravarRefresh(res, refresh);
    return resposta;
  }

  @Post('refresh')
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
  @UseGuards(GuardaOrigem, GuardaBearer)
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
