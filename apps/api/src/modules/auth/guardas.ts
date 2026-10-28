import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CONFIG, type Config } from '../../core/config/config.js';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

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
