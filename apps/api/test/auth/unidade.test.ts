import { generateKeyPairSync } from 'node:crypto';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigInvalidaError, lerConfig } from '../../src/core/config/config.js';
import { limitadorEmMemoria, limitadorRedis } from '../../src/core/limite/limitador.js';
import { ChaveJwtInvalidaError, criarTokensDeAcesso } from '../../src/modules/auth/tokens.js';
import { permissoesPorEmpresa } from '../../src/modules/eu/eu.service.js';
import { configDeTeste } from '../app-de-teste.js';

describe('configuração (falha fechada)', () => {
  it('lista o que falta, sem nunca mostrar valores', () => {
    const segredo = 'valor-que-nao-pode-vazar';
    let erro: unknown;
    try {
      lerConfig({ DATABASE_URL_AUTH: segredo, AUTH_JWT_KID: 'k' });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ConfigInvalidaError);
    const mensagem = (erro as Error).message;
    expect(mensagem).toContain('DATABASE_URL_AUTH');
    expect(mensagem).toContain('AUTH_JWT_CHAVE_PRIVADA');
    expect(mensagem).not.toContain(segredo);
  });

  it('aceita a chave PEM com "\\n" escapado (uma linha no .env) e várias origens', () => {
    const base = configDeTeste();
    const config = lerConfig({
      ...base,
      AUTH_JWT_CHAVE_PRIVADA: base.AUTH_JWT_CHAVE_PRIVADA.replaceAll('\n', '\\n'),
      WEB_ORIGENS: 'http://localhost:5173, https://maquina.exemplo.ts.net:8447',
    } as unknown as Record<string, string>);
    expect(config.AUTH_JWT_CHAVE_PRIVADA).toBe(base.AUTH_JWT_CHAVE_PRIVADA);
    expect(config.WEB_ORIGENS).toEqual([
      'http://localhost:5173',
      'https://maquina.exemplo.ts.net:8447',
    ]);
  });
});

describe('tokens de acesso (EdDSA)', () => {
  const identidade = {
    usuarioId: crypto.randomUUID(),
    tenantId: crypto.randomUUID(),
    membroId: crypto.randomUUID(),
  };

  it('emite e verifica; recusa chave que não é Ed25519', async () => {
    const tokens = criarTokensDeAcesso(configDeTeste());
    expect(await tokens.verificar(await tokens.emitir(identidade))).toEqual(identidade);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => criarTokensDeAcesso({ AUTH_JWT_CHAVE_PRIVADA: rsa, AUTH_JWT_KID: 'k' })).toThrow(
      ChaveJwtInvalidaError,
    );
    expect(() =>
      criarTokensDeAcesso({ AUTH_JWT_CHAVE_PRIVADA: 'nao-e-pem', AUTH_JWT_KID: 'k' }),
    ).toThrow(ChaveJwtInvalidaError);
  });

  it('recusa token vencido e "alg: none"', async () => {
    const tokens = criarTokensDeAcesso(configDeTeste());
    const token = await tokens.emitir(identidade);
    const [, corpo] = token.split('.');
    const semAssinatura = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${corpo}.`;
    expect(await tokens.verificar(semAssinatura)).toBeNull();
    const vencido = JSON.parse(Buffer.from(corpo!, 'base64url').toString());
    vencido.exp = Math.floor(Date.now() / 1000) - 10;
    const adulterado = token.replace(
      corpo!,
      Buffer.from(JSON.stringify(vencido)).toString('base64url'),
    );
    expect(await tokens.verificar(adulterado)).toBeNull();
  });
});

describe('permissões efetivas por empresa', () => {
  it('soma os papéis e fica com o maior escopo; "todas as empresas" vale para cada uma', () => {
    const resultado = permissoesPorEmpresa(
      ['a', 'b'],
      [
        { empresaId: 'a', permissoes: [{ chave: 'x.read', escopo: 'PROPRIO' }] },
        { empresaId: null, permissoes: [{ chave: 'x.read', escopo: 'EMPRESA' }] },
        { empresaId: 'a', permissoes: [{ chave: 'x.read', escopo: 'TENANT' }] },
        { empresaId: 'b', permissoes: [{ chave: 'y.read', escopo: 'PROPRIO' }] },
        { empresaId: 'fora', permissoes: [{ chave: 'z.read', escopo: 'TENANT' }] },
      ],
    );
    expect(Object.fromEntries(resultado)).toEqual({
      a: { 'x.read': 'TENANT' },
      b: { 'x.read': 'EMPRESA', 'y.read': 'PROPRIO' },
    });
  });

  it('papel sem permissões ainda dá acesso à empresa (aparece com {})', () => {
    expect(
      Object.fromEntries(permissoesPorEmpresa(['a'], [{ empresaId: 'a', permissoes: [] }])),
    ).toEqual({ a: {} });
  });
});

describe('limitador de tentativas', () => {
  it('em memória: libera até o máximo, bloqueia e libera de novo depois da janela', async () => {
    let agora = 0;
    const limitador = limitadorEmMemoria(() => agora);
    for (let i = 0; i < 3; i += 1) expect(await limitador.registrar('k', 3, 60)).toBe(0);
    expect(await limitador.registrar('k', 3, 60)).toBe(60);
    agora = 61_000;
    expect(await limitador.registrar('k', 3, 60)).toBe(0);
  });

  describe('Redis (o usado em produção)', () => {
    let container: StartedTestContainer;
    let redis: Redis;
    beforeAll(async () => {
      container = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
      redis = new Redis(container.getMappedPort(6379), container.getHost());
    }, 120_000);
    afterAll(async () => {
      redis?.disconnect();
      await container?.stop();
    });

    it('conta entre chamadas, devolve o tempo restante e a janela não se renova', async () => {
      const limitador = limitadorRedis(redis);
      for (let i = 0; i < 2; i += 1) expect(await limitador.registrar('r', 2, 30)).toBe(0);
      const espera = await limitador.registrar('r', 2, 30);
      expect(espera).toBeGreaterThan(0);
      expect(espera).toBeLessThanOrEqual(30);
      expect(await redis.ttl('ebisu:limite:r')).toBeLessThanOrEqual(30);
      expect(await limitador.registrar('outra', 2, 30)).toBe(0);
    });
  });
});
