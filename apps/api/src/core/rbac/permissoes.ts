import type { EscopoPermissao } from '@ebisu/contracts';
import type { TxContext } from '../tx/contexto.js';
import { ErroDominio } from '../erros/erro-dominio.js';

const PESO: Record<EscopoPermissao, number> = { PROPRIO: 1, EMPRESA: 2, TENANT: 3 };

/**
 * Permissões efetivas por empresa: união dos papéis atribuídos à empresa e dos atribuídos a
 * todas as empresas (empresa_id nulo), ficando com o maior escopo (TENANT > EMPRESA > PROPRIO).
 */
export function permissoesPorEmpresa(
  empresas: readonly string[],
  atribuicoes: ReadonlyArray<{
    empresaId: string | null;
    permissoes: ReadonlyArray<{ chave: string; escopo: EscopoPermissao }>;
  }>,
): Map<string, Record<string, EscopoPermissao>> {
  const resultado = new Map<string, Record<string, EscopoPermissao>>();
  for (const atribuicao of atribuicoes) {
    const alvos = atribuicao.empresaId
      ? empresas.filter((id) => id === atribuicao.empresaId)
      : empresas;
    for (const empresaId of alvos) {
      const atual = resultado.get(empresaId) ?? {};
      for (const { chave, escopo } of atribuicao.permissoes) {
        const anterior = atual[chave];
        if (!anterior || PESO[escopo] > PESO[anterior]) atual[chave] = escopo;
      }
      resultado.set(empresaId, atual);
    }
  }
  return resultado;
}

/**
 * Filtro do escopo PROPRIO (SEG-4) para o `where` do repositório: com PROPRIO, só os registros
 * em que o membro é o responsável (`campo`); com EMPRESA ou TENANT, nenhum filtro a mais. O
 * filtro por `empresa_id: ctx.empresaId` é sempre do repositório, à parte.
 */
export function filtroDeEscopo<C extends string>(
  ctx: Pick<TxContext, 'permissoes' | 'membroId'>,
  chave: string,
  campo: C,
): Partial<Record<C, string>> {
  const escopo = ctx.permissoes.get(chave);
  if (!escopo) throw new ErroDominio('sem_permissao');
  if (escopo !== 'PROPRIO') return {};
  // PROPRIO sem membro (API key, job) não tem "próprio": recusa em vez de liberar tudo.
  if (!ctx.membroId) throw new ErroDominio('sem_permissao');
  return { [campo]: ctx.membroId } as Partial<Record<C, string>>;
}
