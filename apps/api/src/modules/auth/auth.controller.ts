import { randomUUID } from 'node:crypto';
import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ConsultaConvite,
  EntradaAceite,
  EntradaLogin,
  EntradaRegistro,
  EntradaTokenConvite,
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
import { ConvitesService } from './convites.service.js';
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
/** Consulta e aceite de convite: por IP (plano f3-4b2, decisão 6). */
const LIMITE_CONVITE: Limite = { maximo: 20, janela: 15 * 60 };

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
    private readonly convites: ConvitesService,
    @Inject(LIMITADOR) private readonly limitador: Limitador,
  ) {}

  /** Conta uma tentativa em cada chave; se alguma estourou, 429 com Retry-After. */
  private async limitar(res: Response, chaves: ReadonlyArray<[string, Limite]>): Promise<void> {
    let espera = 0;
    for (const [chave, { maximo, janela }] of chaves)
      espera = Math.max(espera, await this.limitador.registrar(chave, maximo, janela));
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
    const email = normalizarEmail(entrada.email);
    // O cadastro com e-mail existente confere a senha: conta também no limite de e-mail do login,
    // para não somar mais tentativas de adivinhar a senha.
    await this.limitar(res, [
      [`registro:ip:${req.ip}`, LIMITE_CADASTRO],
      [`registro:email:${email}`, LIMITE_CADASTRO],
      [`login:email:${email}`, LIMITE_POR_EMAIL],
    ]);
    const { resposta, refresh } = await this.registro.registrar(entrada, {
      ...origemDe(req),
      requestId: requestIdDa(res) ?? randomUUID(),
    });
    gravarRefresh(res, refresh);
    return resposta;
  }

  @Post('convites/consultar')
  @Publica()
  @Contrato({
    resumo: 'Consulta um convite pelo token do link',
    descricao:
      'Diz a conta, o e-mail e o que a tela deve pedir. Link inválido, vencido, usado ou ' +
      'revogado: 410 link_invalido.',
    tags: ['auth'],
    corpo: EntradaTokenConvite,
    resposta: ConsultaConvite,
  })
  async consultarConvite(
    @Corpo() entrada: EntradaTokenConvite,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConsultaConvite> {
    exigirJson(req);
    await this.limitar(res, [[`convite:ip:${req.ip}`, LIMITE_CONVITE]]);
    return this.convites.consultar(entrada.token);
  }

  @Post('convites/aceitar')
  @Publica()
  @Contrato({
    resumo: 'Aceita um convite e entra na conta',
    descricao:
      'E-mail sem usuário: cria o acesso (nome e senha). Usuário que já confirmou o e-mail: a ' +
      'senha dele. E-mail ainda não confirmado: senha nova, e as sessões antigas são encerradas.',
    tags: ['auth'],
    corpo: EntradaAceite,
    resposta: RespostaSessao,
    status: 201,
  })
  async aceitarConvite(
    @Corpo() entrada: EntradaAceite,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RespostaSessao> {
    exigirJson(req);
    await this.limitar(res, [[`convite:ip:${req.ip}`, LIMITE_CONVITE]]);
    const { resposta, refresh } = await this.convites.aceitar(entrada, {
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
    await this.limitar(res, [
      [`login:ip:${req.ip}`, LIMITE_POR_IP],
      [`login:email:${normalizarEmail(entrada.email)}`, LIMITE_POR_EMAIL],
    ]);
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
