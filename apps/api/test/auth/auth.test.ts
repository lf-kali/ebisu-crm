import { generateKeyPairSync } from 'node:crypto';
import { RespostaEu, RespostaSessao } from '@ebisu/contracts';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limitadorEmMemoria } from '../../src/core/limite/limitador.js';
import { hashDoRefresh } from '../../src/modules/auth/tokens.js';
import { ORIGEM_WEB } from '../app-de-teste.js';
import { type Cenario, criarCenario, IDS, SENHA } from './cenario.js';

const COOKIE = '__Host-ebisu_refresh';

let c: Cenario;
beforeAll(async () => {
  c = await criarCenario();
}, 180_000);
afterAll(async () => {
  await c?.fechar();
});

const http = () => request(c.app.getHttpServer());
const login = (email: string, senha = SENHA) =>
  http().post('/v1/auth/login').send({ email, senha });

/** Valor do cookie de refresh gravado na resposta ('' quando a resposta o apaga). */
function cookieDe(resposta: request.Response): string | undefined {
  const linhas = ([] as string[]).concat(resposta.headers['set-cookie'] ?? []);
  const linha = linhas.find((l) => l.startsWith(`${COOKIE}=`));
  return linha?.slice(COOKIE.length + 1).split(';')[0];
}

const refresh = (cookie: string | undefined, origem: string | null = ORIGEM_WEB) => {
  const req = http().post('/v1/auth/refresh');
  if (origem) req.set('Origin', origem);
  if (cookie !== undefined) req.set('Cookie', `${COOKIE}=${cookie}`);
  return req;
};

async function entrar(email = 'ana@teste.local') {
  const r = await login(email);
  expect(r.status).toBe(200);
  return { sessao: RespostaSessao.parse(r.body), cookie: cookieDe(r)! };
}

const eu = (token: string) => http().get('/v1/eu').set('Authorization', `Bearer ${token}`);

/** Troca de conta com o Bearer e o cookie de refresh da sessão (os dois são exigidos). */
const trocarConta = (token: string, cookie: string | undefined, tenantId: string) =>
  http()
    .post('/v1/auth/trocar-conta')
    .set('Origin', ORIGEM_WEB)
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', `${COOKIE}=${cookie}`)
    .send({ tenant_id: tenantId });

describe('POST /v1/auth/login', () => {
  it('entra, lista só contas ativas e devolve o refresh só no cookie seguro', async () => {
    const r = await login('ana@teste.local');
    expect(r.status).toBe(200);
    const sessao = RespostaSessao.parse(r.body);
    expect(sessao.token_type).toBe('Bearer');
    expect(sessao.expira_em).toBe(900);
    expect(sessao.contas.map((x) => x.slug)).toEqual(['ebisu', 'oficina']);
    expect(r.body).not.toHaveProperty('refresh_token');
    expect(JSON.stringify(r.body)).not.toContain(cookieDe(r)!);

    const linha = ([] as string[])
      .concat(r.headers['set-cookie'] ?? [])
      .find((l) => l.startsWith(`${COOKIE}=`))!;
    const atributos = linha.split(';').map((a) => a.trim().toLowerCase());
    expect(atributos).toEqual(
      expect.arrayContaining([
        'httponly',
        'secure',
        'samesite=strict',
        'path=/',
        'max-age=2592000',
      ]),
    );
    expect(atributos.some((a) => a.startsWith('domain='))).toBe(false);
    expect(cookieDe(r)!.length).toBeGreaterThanOrEqual(43);
  });

  it('aceita o e-mail com maiúsculas (o banco guarda normalizado)', async () => {
    expect((await login('Bruno@Teste.LOCAL')).status).toBe(200);
  });

  it('e-mail inexistente, senha errada, inativo, suspenso e conta cancelada: o mesmo 401', async () => {
    const respostas = await Promise.all([
      login('ninguem@teste.local'),
      login('ana@teste.local', 'senha-errada-123'),
      login('davi@teste.local'),
      login('carla@teste.local'),
      login('elisa@teste.local'),
    ]);
    const semId = respostas.map((r) => {
      expect(r.status).toBe(401);
      // O request_id muda a cada requisição; o resto do corpo precisa ser idêntico.
      const corpo = { ...(r.body as Record<string, unknown>) };
      delete corpo.request_id;
      return corpo;
    });
    expect(new Set(semId.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(semId[0]).toMatchObject({ code: 'nao_autenticado' });
    for (const r of respostas) expect(cookieDe(r)).toBeUndefined();
  });

  it('entrada inválida dá 422 com o campo', async () => {
    const r = await http().post('/v1/auth/login').send({ email: 'nao-e-email', senha: '' });
    expect(r.status).toBe(422);
    expect((r.body.campos as Array<{ campo: string }>).map((x) => x.campo).sort()).toEqual([
      'email',
      'senha',
    ]);
  });

  it('limita tentativas por e-mail: a 11ª em 15 min dá 429 com Retry-After', async () => {
    const app = await c.criarApp(limitadorEmMemoria());
    const tentar = () =>
      request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'Alvo@Teste.local', senha: 'qualquer-coisa' });
    for (let i = 0; i < 10; i += 1) expect((await tentar()).status).toBe(401);
    const bloqueada = await tentar();
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.body.code).toBe('limite_excedido');
    expect(Number(bloqueada.headers['retry-after'])).toBeGreaterThan(0);
    // Mesmo com a senha certa, enquanto durar a janela (o limite vem antes da senha).
    const comSenhaCerta = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: 'alvo@teste.local', senha: SENHA });
    expect(comSenhaCerta.status).toBe(429);
  });

  it('abre na conta usada por último', async () => {
    const { sessao, cookie } = await entrar();
    const troca = await trocarConta(sessao.access_token, cookie, IDS.contas.oficina);
    expect(troca.status).toBe(200);
    const depois = await entrar();
    expect(depois.sessao.conta.slug).toBe('oficina');
    // Volta para a ebisu para não afetar os outros testes.
    await trocarConta(depois.sessao.access_token, depois.cookie, IDS.contas.ebisu).expect(200);
  });
});

describe('POST /v1/auth/refresh', () => {
  it('rotaciona: token novo a cada uso, mesma conta', async () => {
    const { cookie } = await entrar();
    const r = await refresh(cookie);
    expect(r.status).toBe(200);
    const novo = cookieDe(r)!;
    expect(novo).toBeTruthy();
    expect(novo).not.toBe(cookie);
    expect(RespostaSessao.parse(r.body).conta.slug).toBe('ebisu');
    expect((await refresh(novo)).status).toBe(200);
  });

  it('reuso de um token já trocado revoga a família inteira', async () => {
    const { cookie } = await entrar();
    const novo = cookieDe(await refresh(cookie))!;
    const reuso = await refresh(cookie);
    expect(reuso.status).toBe(401);
    expect(cookieDe(reuso)).toBe('');
    // O token legítimo da família também deixou de valer.
    expect((await refresh(novo)).status).toBe(401);
  });

  it('dois refresh simultâneos com o mesmo token: no máximo um vence, e a família cai', async () => {
    const { cookie } = await entrar();
    const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
    const sucessos = [a, b].filter((r) => r.status === 200);
    expect(sucessos.length).toBeLessThanOrEqual(1);
    expect([a, b].some((r) => r.status === 401)).toBe(true);
    for (const r of sucessos) expect((await refresh(cookieDe(r))).status).toBe(401);
  });

  it('mantém a conta da sessão depois da troca de conta', async () => {
    const { sessao, cookie } = await entrar();
    const troca = await trocarConta(sessao.access_token, cookie, IDS.contas.oficina);
    const r = await refresh(cookieDe(troca));
    expect(RespostaSessao.parse(r.body).conta.slug).toBe('oficina');
    await trocarConta(
      RespostaSessao.parse(r.body).access_token,
      cookieDe(r),
      IDS.contas.ebisu,
    ).expect(200);
  });

  it('CSRF: sem Origin ou com Origin de fora, recusa', async () => {
    const { cookie } = await entrar();
    expect((await refresh(cookie, null)).status).toBe(403);
    expect((await refresh(cookie, 'https://mal.example')).status).toBe(403);
    expect((await refresh(cookie)).status).toBe(200);
  });

  it('sem cookie ou com cookie desconhecido: 401', async () => {
    expect((await refresh(undefined)).status).toBe(401);
    expect((await refresh('nao-existe')).status).toBe(401);
  });

  it('token vencido: 401', async () => {
    const { cookie } = await entrar('bruno@teste.local');
    await c.sql(
      `UPDATE refresh_token SET expira_em = now() - interval '1 second'
       WHERE usuario_id = $1 AND revogado_em IS NULL`,
      [IDS.usuarios.bruno],
    );
    expect((await refresh(cookie)).status).toBe(401);
  });

  it('usuário desativado depois do login: refresh e troca de conta recusam', async () => {
    const { sessao, cookie } = await entrar('ana@teste.local');
    const segunda = await entrar('ana@teste.local');
    await c.sql(`UPDATE usuario SET ativo = false WHERE id = $1`, [IDS.usuarios.ana]);
    try {
      expect((await refresh(cookie)).status).toBe(401);
      const troca = await trocarConta(
        segunda.sessao.access_token,
        segunda.cookie,
        IDS.contas.oficina,
      );
      expect(troca.status).toBe(401);
      expect(cookieDe(troca)).toBeUndefined();
    } finally {
      await c.sql(`UPDATE usuario SET ativo = true WHERE id = $1`, [IDS.usuarios.ana]);
    }
    void sessao;
  });

  it('membro suspenso depois do login: o refresh recusa e a família cai', async () => {
    const { cookie } = await entrar('bruno@teste.local');
    await c.sql(`UPDATE membro SET status = 'SUSPENSO' WHERE id = $1`, [IDS.membros.bruno]);
    try {
      expect((await refresh(cookie)).status).toBe(401);
      // Só a família desta sessão (o Bruno tem outras, de outros testes).
      const { rows } = await c.sql(
        `SELECT count(*)::int AS vivos FROM refresh_token
         WHERE familia = (SELECT familia FROM refresh_token WHERE token_hash = $1)
           AND revogado_em IS NULL`,
        [hashDoRefresh(cookie)],
      );
      expect(rows[0]!.vivos).toBe(0);
    } finally {
      await c.sql(`UPDATE membro SET status = 'ATIVO' WHERE id = $1`, [IDS.membros.bruno]);
    }
  });
});

describe('POST /v1/auth/trocar-conta', () => {
  const trocar = (token: string | null, tenantId: string, cookie?: string) => {
    const req = http().post('/v1/auth/trocar-conta').set('Origin', ORIGEM_WEB);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (cookie) req.set('Cookie', `${COOKIE}=${cookie}`);
    return req.send({ tenant_id: tenantId });
  };

  it('troca para outra conta do usuário e revoga a sessão anterior', async () => {
    const { sessao, cookie } = await entrar();
    const r = await trocar(sessao.access_token, IDS.contas.oficina, cookie);
    expect(r.status).toBe(200);
    expect(RespostaSessao.parse(r.body).conta.slug).toBe('oficina');
    expect((await refresh(cookie)).status).toBe(401);
    await trocar(RespostaSessao.parse(r.body).access_token, IDS.contas.ebisu, cookieDe(r)).expect(
      200,
    );
  });

  it('sem o cookie de refresh da sessão atual, recusa: um access token sozinho não vira sessão longa', async () => {
    const { sessao, cookie } = await entrar();
    const semCookie = await trocar(sessao.access_token, IDS.contas.oficina);
    expect(semCookie.status).toBe(401);
    expect(cookieDe(semCookie)).toBeUndefined();
    // Cookie de outra pessoa (Bruno) com o token da Ana: também recusa.
    const doBruno = await entrar('bruno@teste.local');
    expect((await trocar(sessao.access_token, IDS.contas.oficina, doBruno.cookie)).status).toBe(
      401,
    );
    // Cookie da mesma pessoa, mas de uma sessão em outra conta: recusa.
    const outraSessao = await entrar();
    const naOficina = await trocarConta(
      outraSessao.sessao.access_token,
      outraSessao.cookie,
      IDS.contas.oficina,
    );
    expect(
      (await trocar(sessao.access_token, IDS.contas.oficina, cookieDe(naOficina))).status,
    ).toBe(401);
    await trocarConta(
      RespostaSessao.parse(naOficina.body).access_token,
      cookieDe(naOficina),
      IDS.contas.ebisu,
    ).expect(200);
    // Cookie já revogado (logout): recusa.
    const outra = await entrar();
    await http()
      .post('/v1/auth/logout')
      .set('Origin', ORIGEM_WEB)
      .set('Cookie', `${COOKIE}=${outra.cookie}`);
    expect((await trocar(outra.sessao.access_token, IDS.contas.oficina, outra.cookie)).status).toBe(
      401,
    );
    // A sessão original continua de pé.
    expect((await refresh(cookie)).status).toBe(200);
  });

  it('conta suspensa, alheia ou inexistente: 404 igual', async () => {
    const { sessao, cookie } = await entrar();
    for (const tenant of [IDS.contas.suspensa, IDS.contas.cancelada, crypto.randomUUID()]) {
      const r = await trocar(sessao.access_token, tenant, cookie);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('nao_encontrado');
    }
  });

  it('exige Bearer válido', async () => {
    expect((await trocar(null, IDS.contas.oficina)).status).toBe(401);
    expect((await trocar('lixo', IDS.contas.oficina)).status).toBe(401);
  });
});

describe('POST /v1/auth/logout', () => {
  const sair = (cookie?: string) => {
    const req = http().post('/v1/auth/logout').set('Origin', ORIGEM_WEB);
    if (cookie) req.set('Cookie', `${COOKIE}=${cookie}`);
    return req;
  };

  it('revoga a família, apaga o cookie e não deixa repetir', async () => {
    const { cookie } = await entrar();
    const r = await sair(cookie);
    expect(r.status).toBe(204);
    expect(cookieDe(r)).toBe('');
    expect((await refresh(cookie)).status).toBe(401);
    expect((await sair(cookie)).status).toBe(401);
  });

  it('logout com um token já trocado (reuso) derruba a família inteira', async () => {
    const { cookie } = await entrar();
    const novo = cookieDe(await refresh(cookie))!;
    expect((await sair(cookie)).status).toBe(401);
    expect((await refresh(novo)).status).toBe(401);
  });

  it('CSRF: Origin de fora não consegue derrubar a sessão', async () => {
    const { cookie } = await entrar();
    const r = await http()
      .post('/v1/auth/logout')
      .set('Origin', 'https://mal.example')
      .set('Cookie', `${COOKIE}=${cookie}`);
    expect(r.status).toBe(403);
    expect((await refresh(cookie)).status).toBe(200);
  });
});

describe('GET /v1/eu', () => {
  it('permissões efetivas por empresa: união dos papéis com o maior escopo; empresa inativa fora', async () => {
    const { sessao } = await entrar();
    const r = await eu(sessao.access_token);
    expect(r.status).toBe(200);
    const corpo = RespostaEu.parse(r.body);
    expect(corpo.conta.slug).toBe('ebisu');
    expect(corpo.usuario.email).toBe('ana@teste.local');
    expect(corpo.empresas.map((e) => e.nome_fantasia)).toEqual(['Ebisu Centro', 'Ebisu Shopping']);
    const [centro, shopping] = corpo.empresas;
    expect(centro!.permissoes).toEqual({
      'contato.read': 'TENANT',
      'contato.create': 'EMPRESA',
      'os.read': 'PROPRIO',
      'os.update': 'PROPRIO',
    });
    expect(shopping!.permissoes).toEqual({ 'contato.read': 'TENANT', 'contato.create': 'EMPRESA' });
  });

  it('papéis só numa empresa: só ela aparece, com os escopos somados', async () => {
    const { sessao } = await entrar('bruno@teste.local');
    const corpo = RespostaEu.parse((await eu(sessao.access_token)).body);
    expect(corpo.empresas.map((e) => e.id)).toEqual([IDS.empresas.shopping]);
    expect(corpo.empresas[0]!.permissoes).toEqual({
      'contato.read': 'EMPRESA',
      'os.read': 'PROPRIO',
      'os.update': 'PROPRIO',
    });
  });

  it('o token de uma conta só vê os dados dela (RLS)', async () => {
    const { sessao, cookie } = await entrar();
    const troca = await trocarConta(sessao.access_token, cookie, IDS.contas.oficina);
    const naOficina = RespostaSessao.parse(troca.body);
    const corpo = RespostaEu.parse((await eu(naOficina.access_token)).body);
    expect(corpo.conta.slug).toBe('oficina');
    expect(corpo.empresas.map((e) => e.id)).toEqual([IDS.empresas.oficina]);
    await trocarConta(naOficina.access_token, cookieDe(troca), IDS.contas.ebisu).expect(200);
  });

  it('membro suspenso depois de emitido o token: 401', async () => {
    const { sessao } = await entrar('bruno@teste.local');
    await c.sql(`UPDATE membro SET status = 'SUSPENSO' WHERE id = $1`, [IDS.membros.bruno]);
    try {
      expect((await eu(sessao.access_token)).status).toBe(401);
    } finally {
      await c.sql(`UPDATE membro SET status = 'ATIVO' WHERE id = $1`, [IDS.membros.bruno]);
    }
  });

  it('sem token, token adulterado ou assinado por outra chave: 401', async () => {
    const { sessao } = await entrar();
    expect((await http().get('/v1/eu')).status).toBe(401);
    // Troca um caractere no meio da assinatura (os do fim podem ter bits sem efeito no base64url).
    const [cabecalho, corpo, assinatura] = sessao.access_token.split('.') as [
      string,
      string,
      string,
    ];
    const meio = Math.floor(assinatura.length / 2);
    const trocado = assinatura[meio] === 'A' ? 'B' : 'A';
    const adulterado = `${cabecalho}.${corpo}.${assinatura.slice(0, meio)}${trocado}${assinatura.slice(meio + 1)}`;
    expect((await eu(adulterado)).status).toBe(401);

    const { privateKey } = generateKeyPairSync('ed25519');
    const forjado = await new SignJWT({ tid: IDS.contas.ebisu, mid: IDS.membros.anaEbisu })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'teste' })
      .setSubject(IDS.usuarios.ana)
      .setIssuer('ebisu-api')
      .setAudience('ebisu')
      .setExpirationTime('5m')
      .sign(privateKey);
    expect((await eu(forjado)).status).toBe(401);
  });
});
