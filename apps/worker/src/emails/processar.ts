import { comTenant, gerarTokenConvite, hashDoTokenConvite, type PrismaClient } from '@ebisu/db';
import type { MensagemEmail, Remetente } from './remetente.js';

// Outbox de e-mails do sistema (plano docs/planos/f3-4b2-convites.md, decisão 5). A única
// passagem entre contas é reivindicar_email_saida(), que devolve só (id, tenant_id); o resto é
// feito pelo ebisu_app dentro de cada conta. O token do convite é gerado aqui, na hora do envio,
// e só o hash vai para o banco.

export const MAXIMO_TENTATIVAS = 5;
/** Prazo de um worker para concluir o envio; vencido, outro reivindica a linha de novo. */
const PRAZO = '5 minutes';
const ESPERA_BASE_MS = 30_000;

export interface OpcoesEnvio {
  webUrl: string;
  limite?: number;
  /** Erro inesperado num e-mail (banco oscilando): o laço registra e segue. */
  aoFalhar?: (id: string, erro: unknown) => void;
}

/** Espera antes da próxima tentativa: 30 s, 1 min, 2 min, 4 min... */
export const esperaDaTentativa = (tentativas: number) =>
  ESPERA_BASE_MS * 2 ** Math.max(tentativas - 1, 0);

/** Uma rodada: reivindica até `limite` e-mails e envia um por um. Devolve quantos reivindicou. */
export async function processarEmails(
  db: PrismaClient,
  remetente: Remetente,
  opcoes: OpcoesEnvio,
): Promise<number> {
  const limite = opcoes.limite ?? 10;
  const linhas = await db.$queryRaw<Array<{ id: string; tenant_id: string }>>`
    SELECT id, tenant_id FROM reivindicar_email_saida(${limite}::int, ${PRAZO}::interval)`;
  for (const { id, tenant_id } of linhas) {
    try {
      await enviarUm(db, remetente, tenant_id, id, opcoes);
    } catch (erro) {
      // Um e-mail com problema não segura os outros do lote; ele volta quando o prazo vencer.
      opcoes.aoFalhar?.(id, erro);
    }
  }
  return linhas.length;
}

async function enviarUm(
  db: PrismaClient,
  remetente: Remetente,
  tenantId: string,
  id: string,
  opcoes: OpcoesEnvio,
): Promise<void> {
  const mensagem = await comTenant(db, tenantId, (tx) => montarMensagem(tx, id, opcoes));
  if (!mensagem) return;
  try {
    await remetente.enviar(mensagem);
  } catch (erro) {
    await registrarFalha(db, tenantId, id, erro);
    return;
  }
  await comTenant(db, tenantId, (tx) =>
    tx.emailSaida.updateMany({
      where: { id, status: 'ENVIANDO' },
      data: { status: 'ENVIADO', enviado_em: new Date(), erro: null },
    }),
  );
}

type Tx = Parameters<Parameters<typeof comTenant>[2]>[0];

/**
 * Dentro da conta: confere que a linha ainda é deste envio, que o convite segue pendente e no
 * prazo, gera o token e grava o hash. Convite aceito, revogado ou vencido: o e-mail é cancelado.
 */
async function montarMensagem(
  tx: Tx,
  id: string,
  { webUrl }: OpcoesEnvio,
): Promise<MensagemEmail | null> {
  const email = await tx.emailSaida.findUnique({
    where: { id },
    include: { convite: true, tenant: { select: { nome: true } } },
  });
  if (!email || email.status !== 'ENVIANDO') return null;
  if (email.tentativas > MAXIMO_TENTATIVAS) {
    await tx.emailSaida.update({ where: { id }, data: { status: 'FALHOU' } });
    return null;
  }
  const convite = email.convite;
  if (!convite || convite.aceito_em || convite.revogado_em || convite.expira_em <= new Date()) {
    await tx.emailSaida.update({ where: { id }, data: { status: 'CANCELADO' } });
    return null;
  }
  const token = gerarTokenConvite();
  await tx.convite.update({
    where: { id: convite.id },
    data: { token_hash: hashDoTokenConvite(token) },
  });
  // O token vai no fragmento: o navegador não o manda a servidores nem a logs.
  const link = `${webUrl.replace(/\/+$/, '')}/convite#token=${token}`;
  const validade = convite.expira_em.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return {
    para: convite.email,
    assunto: `Convite para a conta ${email.tenant.nome} no ebisuCRM`,
    texto: [
      `Você foi convidado para a conta ${email.tenant.nome} no ebisuCRM.`,
      '',
      `Para aceitar, abra o link abaixo (vale até ${validade} e só uma vez):`,
      link,
      '',
      'Se você não esperava este convite, ignore este e-mail.',
    ].join('\n'),
  };
}

/** Falha de entrega: nova tentativa mais tarde, ou FALHOU depois da última. */
async function registrarFalha(db: PrismaClient, tenantId: string, id: string, erro: unknown) {
  const mensagem = (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
  await comTenant(db, tenantId, async (tx) => {
    const email = await tx.emailSaida.findUnique({ where: { id }, select: { tentativas: true } });
    if (!email) return;
    const ultima = email.tentativas >= MAXIMO_TENTATIVAS;
    await tx.emailSaida.updateMany({
      where: { id, status: 'ENVIANDO' },
      data: ultima
        ? { status: 'FALHOU', erro: mensagem }
        : {
            status: 'PENDENTE',
            erro: mensagem,
            proxima_em: new Date(Date.now() + esperaDaTentativa(email.tentativas)),
          },
    });
  });
}
