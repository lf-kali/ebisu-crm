// Empresa atual (X-Empresa-Id, spec §5.1). A escolha é lembrada por usuário e conta no
// armazenamento local, só como conveniência: vale apenas se a empresa estiver entre as do /v1/eu
// (quem nega é a API).

/** De quem é a preferência: usuário + conta (dois usuários no mesmo navegador não a herdam). */
export const donoDaPreferencia = (eu: { usuario: { id: string }; conta: { tenant_id: string } }) =>
  `${eu.conta.tenant_id}.${eu.usuario.id}`;

const chave = (dono: string) => `ebisu.empresa.${dono}`;

export function criarEmpresaAtual({ armazenamento }: { armazenamento?: Storage } = {}) {
  let atual: string | null = null;
  const ouvintes = new Set<() => void>();

  const definir = (proxima: string | null) => {
    if (proxima === atual) return;
    atual = proxima;
    for (const ouvinte of ouvintes) ouvinte();
  };

  const lembrada = (dono: string) => {
    try {
      return armazenamento?.getItem(chave(dono)) ?? null;
    } catch {
      return null;
    }
  };

  return {
    obter: () => atual,
    assinar(ouvinte: () => void) {
      ouvintes.add(ouvinte);
      return () => void ouvintes.delete(ouvinte);
    },
    /**
     * Escolhe a empresa válida para a conta: a atual, se ainda está na lista; senão a lembrada;
     * senão a primeira. Sem empresas, fica sem nenhuma.
     */
    resolver(dono: string, empresas: readonly { id: string }[]): string | null {
      const ids = new Set(empresas.map((e) => e.id));
      const candidata = [atual, lembrada(dono)].find((id) => id !== null && ids.has(id));
      definir(candidata ?? empresas[0]?.id ?? null);
      return atual;
    },
    escolher(dono: string, empresaId: string) {
      try {
        armazenamento?.setItem(chave(dono), empresaId);
      } catch {
        // Sem armazenamento: a escolha só não sobrevive ao F5.
      }
      definir(empresaId);
    },
    limpar: () => definir(null),
  };
}

export type EmpresaAtual = ReturnType<typeof criarEmpresaAtual>;
