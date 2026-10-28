import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type Config } from '../../core/config/config.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';
import { type Identidade, TOKENS_DE_ACESSO, type TokensDeAcesso } from './tokens.js';

export interface RequisicaoAutenticada extends Request {
  identidade: Identidade;
}

/**
 * CSRF nas rotas que agem pelo cookie (refresh, logout, troca de conta): só aceita requisição
 * vinda de uma origem do web (WEB_ORIGENS). Somado ao SameSite=Strict do cookie. O navegador
 * sempre manda Origin num POST; sem Origin (outro site com tag antiga, curl), recusa.
 */
@Injectable()
export class GuardaOrigem implements CanActivate {
  private readonly permitidas: Set<string>;

  constructor(@Inject(CONFIG) config: Config) {
    this.permitidas = new Set(config.WEB_ORIGENS.map((origem) => new URL(origem).origin));
  }

  canActivate(contexto: ExecutionContext): boolean {
    const origem = contexto.switchToHttp().getRequest<Request>().headers.origin;
    if (!origem || !this.permitidas.has(origem)) throw new ErroDominio('sem_permissao');
    return true;
  }
}

/** Exige `Authorization: Bearer <access token>` válido e guarda a identidade na requisição. */
@Injectable()
export class GuardaBearer implements CanActivate {
  constructor(@Inject(TOKENS_DE_ACESSO) private readonly tokens: TokensDeAcesso) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const req = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    const identidade = tipo === 'Bearer' && token ? await this.tokens.verificar(token) : null;
    if (!identidade) throw new ErroDominio('nao_autenticado');
    req.identidade = identidade;
    return true;
  }
}
