import { type Algorithm, hash } from '@node-rs/argon2';
import type { $Enums, Prisma, PrismaClient } from '@prisma/client';
import { comTenant } from '../tenancy.js';
import { PAPEIS_PADRAO } from './papeis-padrao.js';
import { semearCatalogoPermissoes, semearPadroesEmpresa, semearPadroesTenant } from './semear.js';

// Seed de demonstração (base). Só cria dados que as regras atuais permitem sem comandos de
// domínio: orçamentos, OS e estoque entram pelas frentes F6/F7/F8, com os próprios comandos.
// Idempotente: se o tenant de demonstração já existe, nada é recriado.

export const SLUG_DEMO = 'assistencia-demo';
/** ID fixo: permite checar a existência dentro do contexto do próprio tenant (sob RLS). */
export const TENANT_DEMO_ID = '0190d7c0-0000-7000-8000-00000000de30';
const DOMINIO_EMAIL = 'demo.ebisu.local';
/** Senha de todos os usuários de demonstração. Só para desenvolvimento local (README). */
export const SENHA_DEMO = 'demo-ebisu-2026';

const EMPRESAS = [
  {
    razao_social: 'Ebisu Assistência Técnica Centro Ltda',
    nome_fantasia: 'Ebisu Centro',
    cnpj: '11222333000181',
  },
  {
    razao_social: 'Ebisu Assistência Técnica Shopping Ltda',
    nome_fantasia: 'Ebisu Shopping',
    cnpj: '11222333000262',
  },
] as const;

const NOMES = [
  'Ana Souza',
  'Bruno Lima',
  'Carla Mendes',
  'Diego Rocha',
  'Elisa Martins',
  'Felipe Araújo',
  'Gabriela Costa',
  'Henrique Alves',
  'Isabela Ribeiro',
  'João Pereira',
  'Karina Gomes',
  'Lucas Barbosa',
  'Mariana Teixeira',
  'Nicolas Cardoso',
  'Olívia Duarte',
  'Paulo Moreira',
  'Quésia Nunes',
  'Rafael Pinto',
  'Sofia Carvalho',
  'Tiago Freitas',
  'Úrsula Batista',
  'Vinícius Ramos',
  'Wesley Monteiro',
  'Yasmin Correia',
  'Alice Fernandes',
  'Bernardo Castro',
  'Cecília Lopes',
  'Davi Farias',
  'Eduarda Melo',
  'Fábio Rezende',
] as const;

const APARELHOS: ReadonlyArray<{
  tipo: $Enums.TipoDispositivo;
  marca: string;
  modelo: string;
  problema: string;
}> = [
  { tipo: 'CELULAR', marca: 'Apple', modelo: 'iPhone 13', problema: 'Tela trincada após queda' },
  {
    tipo: 'CELULAR',
    marca: 'Samsung',
    modelo: 'Galaxy S22',
    problema: 'Bateria descarrega muito rápido',
  },
  { tipo: 'CELULAR', marca: 'Motorola', modelo: 'Moto G84', problema: 'Não carrega' },
  { tipo: 'NOTEBOOK', marca: 'Dell', modelo: 'Inspiron 15', problema: 'Não liga' },
  {
    tipo: 'NOTEBOOK',
    marca: 'Lenovo',
    modelo: 'IdeaPad 3',
    problema: 'Teclado com teclas falhando',
  },
  {
    tipo: 'CELULAR',
    marca: 'Xiaomi',
    modelo: 'Redmi Note 13',
    problema: 'Câmera traseira embaçada',
  },
];

type Fase = 'NOVO' | 'QUALIFICACAO' | 'DIAGNOSTICO' | 'PERDIDO' | 'NUTRICAO';
// Empresa Centro: 24 contatos; Empresa Shopping: 6.
const FASES: ReadonlyArray<readonly Fase[]> = [
  [
    ...Array(8).fill('NOVO'),
    ...Array(6).fill('QUALIFICACAO'),
    ...Array(5).fill('DIAGNOSTICO'),
    ...Array(2).fill('PERDIDO'),
    ...Array(3).fill('NUTRICAO'),
  ],
  [...Array(3).fill('NOVO'), ...Array(2).fill('QUALIFICACAO'), 'DIAGNOSTICO'],
];
const ETAPA_DA_FASE: Record<Fase, string> = {
  NOVO: 'Novo contato',
  QUALIFICACAO: 'Qualificação',
  DIAGNOSTICO: 'Diagnóstico / Orçamento',
  PERDIDO: 'Perdido',
  NUTRICAO: 'Nutrição',
};

const horasAtras = (agora: Date, horas: number) => new Date(agora.getTime() - horas * 3_600_000);
const emailDe = (nome: string) =>
  `${nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(' ', '.')}@exemplo.com.br`;

async function criarEquipe(
  tx: Prisma.TransactionClient,
  tenantId: string,
  papeis: Record<string, string>,
  empresaIds: string[],
) {
  const membros: Record<string, string> = {};
  for (const { chave, nome } of PAPEIS_PADRAO) {
    const email = `${chave.toLowerCase()}@${DOMINIO_EMAIL}`;
    const usuario = await tx.usuario.upsert({
      where: { email },
      create: { email, nome: `${nome} Demo` },
      update: {},
      select: { id: true },
    });
    const membro = await tx.membro.create({
      data: { tenant_id: tenantId, usuario_id: usuario.id, status: 'ATIVO', cargo: nome },
      select: { id: true },
    });
    membros[chave] = membro.id;
    // OWNER/ADMIN valem para o tenant inteiro; GERENTE para as duas empresas; os demais, Centro.
    const empresasDoPapel =
      chave === 'OWNER' || chave === 'ADMIN'
        ? [null]
        : chave === 'GERENTE'
          ? empresaIds
          : [empresaIds[0]!];
    await tx.atribuicaoPapel.createMany({
      data: empresasDoPapel.map((empresa_id) => ({
        tenant_id: tenantId,
        membro_id: membro.id,
        papel_id: papeis[chave]!,
        empresa_id,
      })),
    });
  }
  return membros;
}

async function criarCarteira(
  tx: Prisma.TransactionClient,
  contexto: {
    tenantId: string;
    empresaId: string;
    indiceEmpresa: number;
    responsavelId: string;
    agora: Date;
  },
) {
  const { tenantId, empresaId, indiceEmpresa, responsavelId, agora } = contexto;
  const daEmpresa = { tenant_id: tenantId, empresa_id: empresaId };
  const funil = await tx.funil.findFirstOrThrow({
    where: { empresa_id: empresaId, padrao: true },
    select: { id: true, etapas: { select: { id: true, nome: true } } },
  });
  const etapaId = (fase: Fase) => funil.etapas.find((e) => e.nome === ETAPA_DA_FASE[fase])!.id;
  const origens = await tx.origemLead.findMany({
    where: { empresa_id: empresaId },
    orderBy: { nome: 'asc' },
  });
  const motivos = await tx.motivoPerda.findMany({
    where: { empresa_id: empresaId },
    orderBy: { nome: 'asc' },
  });

  const fases = FASES[indiceEmpresa]!;
  const deslocamento = indiceEmpresa === 0 ? 0 : FASES[0]!.length;
  for (const [i, fase] of fases.entries()) {
    const nome = NOMES[deslocamento + i]!;
    const aparelho = APARELHOS[i % APARELHOS.length]!;
    const qualificado = fase === 'DIAGNOSTICO' || (fase === 'QUALIFICACAO' && i % 2 === 0);
    const telefone = `+55119${String(80_000_000 + (deslocamento + i) * 7_919).padStart(8, '0')}`;
    const contato = await tx.contato.create({
      data: {
        ...daEmpresa,
        nome,
        email: emailDe(nome),
        email_normalizado: emailDe(nome),
        telefone_e164: telefone,
        whatsapp_e164: i % 3 === 0 ? null : telefone,
        canal_preferido: qualificado ? (i % 3 === 0 ? 'EMAIL' : 'WHATSAPP') : null,
        ciclo_vida: fase === 'DIAGNOSTICO' ? 'LEAD_QUALIFICADO' : 'LEAD',
        created_at: horasAtras(agora, 24 * (fases.length - i)),
      },
      select: { id: true, canal_preferido: true },
    });

    const origem = origens[i % origens.length]!;
    await tx.capturaLead.create({
      data: {
        ...daEmpresa,
        contato_id: contato.id,
        origem_id: origem.id,
        evento: 'form_contato',
        payload: { nome, mensagem: aparelho.problema },
        utm_source: origem.tipo === 'GOOGLE_ADS' ? 'google' : null,
        status: 'PROCESSADA',
        recebido_em: horasAtras(agora, 24 * (fases.length - i)),
      },
    });

    if (contato.canal_preferido) {
      await tx.consentimento.create({
        data: {
          ...daEmpresa,
          contato_id: contato.id,
          canal: contato.canal_preferido,
          finalidade: 'TRANSACIONAL',
          concedido: true,
          base_legal: 'execucao_contrato',
          evidencia: { origem: 'seed-demo' },
        },
      });
    }

    let dispositivoId: string | null = null;
    if (fase === 'DIAGNOSTICO') {
      const dispositivo = await tx.dispositivo.create({
        data: {
          ...daEmpresa,
          tipo: aparelho.tipo,
          marca: aparelho.marca,
          modelo: aparelho.modelo,
          imei:
            aparelho.tipo === 'CELULAR'
              ? `35${String(1_000_000_000_000 + deslocamento + i)}`
              : null,
          numero_serie: aparelho.tipo === 'NOTEBOOK' ? `SN-DEMO-${deslocamento + i}` : null,
          proprietario_atual_id: contato.id,
        },
        select: { id: true },
      });
      dispositivoId = dispositivo.id;
      await tx.dispositivoProprietario.create({
        data: { ...daEmpresa, dispositivo_id: dispositivo.id, contato_id: contato.id },
      });
    }

    const fechado = fase === 'PERDIDO';
    await tx.negocio.create({
      data: {
        ...daEmpresa,
        contato_id: contato.id,
        funil_id: funil.id,
        etapa_id: etapaId(fase),
        titulo: `${aparelho.problema} — ${aparelho.marca} ${aparelho.modelo}`,
        tipo_dispositivo: fase === 'NOVO' ? null : aparelho.tipo,
        descricao_problema: fase === 'NOVO' ? null : aparelho.problema,
        urgencia: qualificado ? (['BAIXA', 'MEDIA', 'ALTA'] as const)[i % 3] : null,
        dispositivo_id: dispositivoId,
        status: fechado ? 'PERDIDO' : fase === 'NUTRICAO' ? 'NUTRICAO' : 'ABERTO',
        motivo_perda_id: fechado ? motivos[i % motivos.length]!.id : null,
        fechado_em: fechado ? horasAtras(agora, 6) : null,
        nba_adiada_ate:
          fase === 'NUTRICAO' ? new Date(agora.getTime() + 30 * 24 * 3_600_000) : null,
        responsavel_id: responsavelId,
        entrou_etapa_em: horasAtras(agora, 1 + i * 5),
      },
    });
  }
  return fases.length;
}

/** Cria o tenant de demonstração com padrões, equipe e carteira. Roda com o papel migrador. */
/**
 * Grava SENHA_DEMO nos usuários *@demo.ebisu.local, inclusive num banco já semeado (antes do F3
 * eles não tinham senha). argon2id com os parâmetros da API (apps/api/src/modules/auth/senha.ts).
 */
async function definirSenhasDemo(cliente: PrismaClient): Promise<number> {
  // `Algorithm` é um const enum ambiente: o valor vai literal (2 = Argon2id).
  const senha_hash = await hash(SENHA_DEMO, {
    algorithm: 2 as Algorithm,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const { count } = await cliente.usuario.updateMany({
    where: { email: { endsWith: `@${DOMINIO_EMAIL}` } },
    data: { senha_hash },
  });
  return count;
}

export async function semearDemo(cliente: PrismaClient, agora = new Date()) {
  await semearCatalogoPermissoes(cliente);
  const resultado = await semearTenantDemo(cliente, agora);
  await definirSenhasDemo(cliente);
  return resultado;
}

async function semearTenantDemo(cliente: PrismaClient, agora: Date) {
  const tenantId = TENANT_DEMO_ID;
  return comTenant(
    cliente,
    tenantId,
    async (tx) => {
      if (await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })) {
        return { criado: false as const, tenantId };
      }
      await tx.tenant.create({
        data: { id: tenantId, nome: 'Assistência Demo', slug: SLUG_DEMO, status: 'ATIVO' },
      });
      const empresaIds: string[] = [];
      for (const empresa of EMPRESAS) {
        const { id } = await tx.empresa.create({
          data: { tenant_id: tenantId, ...empresa },
          select: { id: true },
        });
        empresaIds.push(id);
      }
      const { papeis } = await semearPadroesTenant(tx, tenantId);
      for (const empresaId of empresaIds) await semearPadroesEmpresa(tx, tenantId, empresaId);
      const membros = await criarEquipe(tx, tenantId, papeis, empresaIds);
      let contatos = 0;
      for (const [indiceEmpresa, empresaId] of empresaIds.entries()) {
        contatos += await criarCarteira(tx, {
          tenantId,
          empresaId,
          indiceEmpresa,
          responsavelId: membros.ATENDENTE!,
          agora,
        });
      }
      return { criado: true as const, tenantId, empresas: empresaIds.length, contatos };
    },
    { timeout: 60_000 },
  );
}
