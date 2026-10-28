import { describe, expect, it } from 'vitest';
import { EntradaLogin, RespostaEu, RespostaSessao } from '../src/index.js';

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
