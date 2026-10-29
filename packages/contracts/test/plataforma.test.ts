import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EntradaLogin,
  EntradaTrocarConta,
  RespostaEu,
  RespostaSessao,
  ROTAS_AUTH,
} from '../src/index.js';

const conta = {
  tenant_id: '0190a000-0000-7000-8000-000000000001',
  nome: 'Assistência Ebisu',
  slug: 'ebisu',
};

describe('contratos de auth (F3, adiantados para a F12)', () => {
  it('login exige e-mail válido e senha não vazia, sem regra de tamanho mínimo', () => {
    expect(EntradaLogin.safeParse({ email: 'ana@ebisu.dev', senha: 'x' }).success).toBe(true);
    expect(EntradaLogin.safeParse({ email: 'ana', senha: 'x' }).success).toBe(false);
    expect(EntradaLogin.safeParse({ email: 'ana@ebisu.dev', senha: '' }).success).toBe(false);
    expect(EntradaLogin.safeParse({ email: 'ana@ebisu.dev', senha: 'a'.repeat(257) }).success).toBe(
      false,
    );
  });

  it('a sessão não carrega o refresh token no corpo e lista ao menos a conta atual', () => {
    const sessao = {
      access_token: 'jwt',
      token_type: 'Bearer',
      expira_em: 900,
      conta,
      contas: [conta],
    };
    expect(RespostaSessao.parse({ ...sessao, refresh_token: 'nao' })).not.toHaveProperty(
      'refresh_token',
    );
    expect(RespostaSessao.safeParse({ ...sessao, contas: [] }).success).toBe(false);
    expect(RespostaSessao.safeParse({ ...sessao, token_type: 'bearer' }).success).toBe(false);
  });

  it('troca de conta exige o tenant_id como UUID', () => {
    expect(EntradaTrocarConta.safeParse({ tenant_id: conta.tenant_id }).success).toBe(true);
    expect(EntradaTrocarConta.safeParse({ tenant_id: 'ebisu' }).success).toBe(false);
    expect(EntradaTrocarConta.safeParse({}).success).toBe(false);
  });

  it('rotas de auth batem com a tabela da spec §5.3', () => {
    const spec = readFileSync(new URL('../../../docs/spec-mvp.md', import.meta.url), 'utf8');
    expect(ROTAS_AUTH).toEqual({
      registrar: '/v1/auth/registrar',
      login: '/v1/auth/login',
      refresh: '/v1/auth/refresh',
      logout: '/v1/auth/logout',
      trocarConta: '/v1/auth/trocar-conta',
      eu: '/v1/eu',
    });
    expect(spec).toContain('`POST /v1/auth/registrar` · `/login` · `/refresh` · `/logout`');
    expect(spec).toContain('`POST /v1/auth/trocar-conta`');
    expect(spec).toContain('`GET /v1/eu`');
  });

  it('/v1/eu traz permissões por empresa no formato recurso.acao com escopo do catálogo', () => {
    const eu = {
      usuario: { id: conta.tenant_id, nome: 'Ana', email: 'ana@ebisu.dev', avatar_url: null },
      membro: { id: conta.tenant_id, cargo: null },
      conta,
      empresas: [
        {
          id: conta.tenant_id,
          nome_fantasia: 'Loja Centro',
          razao_social: 'Ebisu Assistência LTDA',
          logo_url: null,
          permissoes: { 'contato.read': 'EMPRESA', 'os.update': 'PROPRIO' },
        },
      ],
    };
    expect(RespostaEu.safeParse(eu).success).toBe(true);
    const comPermissao = (permissoes: Record<string, string>) =>
      RespostaEu.safeParse({ ...eu, empresas: [{ ...eu.empresas[0], permissoes }] }).success;
    expect(comPermissao({ contato: 'EMPRESA' })).toBe(false);
    expect(comPermissao({ 'contato.read': 'TUDO' })).toBe(false);
    expect(RespostaEu.safeParse({ ...eu, empresas: [] }).success).toBe(true);
  });
});
