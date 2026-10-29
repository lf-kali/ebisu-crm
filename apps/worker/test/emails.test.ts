import { randomUUID } from 'node:crypto';
import { hashDoTokenConvite, PrismaClient } from '@ebisu/db';
import { type BancoDeTeste, criarBancoDeTeste } from '@ebisu/db/teste';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  esperaDaTentativa,
  MAXIMO_TENTATIVAS,
  nomeNoEmail,
  processarEmails,
} from '../src/emails/processar.js';
import type { MensagemEmail, Remetente } from '../src/emails/remetente.js';

// Outbox de e-mails (plano docs/planos/f3-4b2-convites.md, decisão 5) contra um Postgres real,
// com o papel ebisu_app e um remetente falso no lugar do SMTP.

const WEB_URL = 'http://web.local/';
let banco: BancoDeTeste;
let admin: Awaited<ReturnType<BancoDeTeste['conectar']>>;
let db: PrismaClient;
const tenant = randomUUID();

beforeAll(async () => {
  banco = await criarBancoDeTeste();
  admin = await banco.conectar(banco.urlAdmin);
  db = new PrismaClient({ datasourceUrl: banco.urlDoPapel('ebisu_app') });
  await admin.query(
    `INSERT INTO tenant (id, nome, slug, updated_at) VALUES ($1, 'Oficina Teste', 'oficina', now())`,
    [tenant],
  );
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  await admin?.end();
  await banco?.container.stop();
});

beforeEach(async () => {
  await admin.query('DELETE FROM email_saida');
  await admin.query('DELETE FROM convite');
});

/** Convite pendente com um e-mail no outbox; devolve os ids. */
async function convite(email = `pessoa.${randomUUID().slice(0, 8)}@teste.local`) {
  const conviteId = randomUUID();
  const emailId = randomUUID();
  await admin.query(
    `INSERT INTO convite (id, tenant_id, email, atribuicoes, expira_em, updated_at)
     VALUES ($1, $2, $3, '[]', now() + interval '7 days', now())`,
    [conviteId, tenant, email],
  );
  await admin.query(
    `INSERT INTO email_saida (id, tenant_id, tipo, convite_id, updated_at)
     VALUES ($1, $2, 'CONVITE', $3, now())`,
    [emailId, tenant, conviteId],
  );
  return { conviteId, emailId, email };
}

function remetenteFalso(falhar = false) {
  const enviados: MensagemEmail[] = [];
  const remetente: Remetente = {
    async enviar(mensagem) {
      if (falhar) throw new Error('SMTP recusou: 451 tente mais tarde');
      enviados.push(mensagem);
    },
  };
  return { remetente, enviados };
}

const linha = async (id: string) =>
  (await admin.query(`SELECT * FROM email_saida WHERE id = $1`, [id])).rows[0];
const tokenDo = (mensagem: MensagemEmail) =>
  /#token=([A-Za-z0-9_-]{43})$/m.exec(mensagem.texto)![1]!;

describe('nome da conta no e-mail', () => {
  it('uma linha, sem controles, entre aspas e até 60 caracteres', () => {
    expect(nomeNoEmail('Oficina\r\nBcc: x@y.z')).toBe('"Oficina Bcc: x@y.z"');
    expect(nomeNoEmail('a\u200bb')).toBe('"a b"');
    const longo = nomeNoEmail('x'.repeat(200));
    expect(longo.length).toBe(62);
    expect(longo.endsWith('…"')).toBe(true);
  });
});

describe('envio do outbox', () => {
  it('envia o convite com o link; só o hash do token fica no banco', async () => {
    const { conviteId, emailId, email } = await convite();
    const { remetente, enviados } = remetenteFalso();
    expect(await processarEmails(db, remetente, { webUrl: WEB_URL })).toBe(1);

    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      para: email,
      assunto: expect.stringContaining('Oficina Teste'),
    });
    expect(enviados[0]!.texto).toContain('http://web.local/convite#token=');
    const token = tokenDo(enviados[0]!);
    const { rows } = await admin.query(`SELECT token_hash FROM convite WHERE id = $1`, [conviteId]);
    expect(rows[0].token_hash).toBe(hashDoTokenConvite(token));
    const enviado = await linha(emailId);
    expect(enviado).toMatchObject({ status: 'ENVIADO', tentativas: 1, erro: null });
    expect(JSON.stringify(enviado)).not.toContain(token);
  });

  it('nada a enviar: não chama o remetente', async () => {
    const { remetente, enviados } = remetenteFalso();
    expect(await processarEmails(db, remetente, { webUrl: WEB_URL })).toBe(0);
    expect(enviados).toEqual([]);
  });

  it('dois workers ao mesmo tempo não enviam o mesmo e-mail', async () => {
    for (let i = 0; i < 6; i++) await convite();
    const outro = new PrismaClient({ datasourceUrl: banco.urlDoPapel('ebisu_app') });
    try {
      const a = remetenteFalso();
      const b = remetenteFalso();
      await Promise.all([
        processarEmails(db, a.remetente, { webUrl: WEB_URL, limite: 3 }),
        processarEmails(outro, b.remetente, { webUrl: WEB_URL, limite: 3 }),
      ]);
      const destinos = [...a.enviados, ...b.enviados].map((m) => m.para);
      expect(destinos).toHaveLength(6);
      expect(new Set(destinos).size).toBe(6);
    } finally {
      await outro.$disconnect();
    }
  });

  it('falha no SMTP: tenta de novo mais tarde e para em FALHOU depois da última', async () => {
    const { emailId } = await convite();
    const { remetente } = remetenteFalso(true);
    await processarEmails(db, remetente, { webUrl: WEB_URL });
    const primeira = await linha(emailId);
    expect(primeira).toMatchObject({ status: 'PENDENTE', tentativas: 1 });
    expect(primeira.erro).toContain('451');
    const espera = primeira.proxima_em.getTime() - Date.now();
    expect(espera).toBeGreaterThan(esperaDaTentativa(1) - 5_000);

    for (let i = 2; i <= MAXIMO_TENTATIVAS; i++) {
      await admin.query(`UPDATE email_saida SET proxima_em = now() WHERE id = $1`, [emailId]);
      await processarEmails(db, remetente, { webUrl: WEB_URL });
    }
    expect(await linha(emailId)).toMatchObject({ status: 'FALHOU', tentativas: MAXIMO_TENTATIVAS });
    await admin.query(`UPDATE email_saida SET proxima_em = now() WHERE id = $1`, [emailId]);
    expect(await processarEmails(db, remetente, { webUrl: WEB_URL })).toBe(0);
  });

  it('erro inesperado num e-mail não segura os outros do lote', async () => {
    await convite();
    await convite();
    // Erro cujo `message` explode: nem o registro da falha consegue tratar.
    class ErroRuim extends Error {
      override get message(): string {
        throw new Error('quebrou de novo');
      }
    }
    const enviados: MensagemEmail[] = [];
    let chamadas = 0;
    const remetente: Remetente = {
      async enviar(mensagem) {
        chamadas += 1;
        if (chamadas === 1) throw new ErroRuim();
        enviados.push(mensagem);
      },
    };
    const falhas: string[] = [];
    expect(
      await processarEmails(db, remetente, { webUrl: WEB_URL, aoFalhar: (id) => falhas.push(id) }),
    ).toBe(2);
    expect(enviados).toHaveLength(1);
    expect(falhas).toHaveLength(1);
  });

  it('convite revogado, aceito ou vencido: cancela o e-mail sem enviar', async () => {
    const revogado = await convite();
    const aceito = await convite();
    const vencido = await convite();
    await admin.query(`UPDATE convite SET revogado_em = now() WHERE id = $1`, [revogado.conviteId]);
    await admin.query(`UPDATE convite SET aceito_em = now() WHERE id = $1`, [aceito.conviteId]);
    await admin.query(`UPDATE convite SET expira_em = now() WHERE id = $1`, [vencido.conviteId]);
    const { remetente, enviados } = remetenteFalso();
    await processarEmails(db, remetente, { webUrl: WEB_URL });
    expect(enviados).toEqual([]);
    for (const { emailId } of [revogado, aceito, vencido])
      expect((await linha(emailId)).status).toBe('CANCELADO');
  });

  it('worker que caiu no meio: vencido o prazo, outro reenvia com um token novo', async () => {
    const { conviteId, emailId } = await convite();
    // Primeiro worker reivindicou e caiu antes de enviar.
    await db.$queryRaw`SELECT * FROM reivindicar_email_saida(10, interval '5 minutes')`;
    const { remetente, enviados } = remetenteFalso();
    expect(await processarEmails(db, remetente, { webUrl: WEB_URL })).toBe(0);
    await admin.query(`UPDATE email_saida SET proxima_em = now() WHERE id = $1`, [emailId]);
    expect(await processarEmails(db, remetente, { webUrl: WEB_URL })).toBe(1);
    const { rows } = await admin.query(`SELECT token_hash FROM convite WHERE id = $1`, [conviteId]);
    expect(rows[0].token_hash).toBe(hashDoTokenConvite(tokenDo(enviados[0]!)));
    expect(await linha(emailId)).toMatchObject({ status: 'ENVIADO', tentativas: 2 });
  });
});
