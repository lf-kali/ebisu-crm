import type { PrismaClient } from '@ebisu/db';

// Nome e e-mail dos usuários dos membros. `usuario` é global e só o ebisu_auth lê (SEG-6): os ids
// vêm sempre de membros já lidos sob o RLS da conta, então nada de outra conta é consultado.

export async function dadosDosUsuarios(
  auth: PrismaClient,
  ids: readonly string[],
): Promise<Map<string, { nome: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const usuarios = await auth.usuario.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, nome: true, email: true },
  });
  return new Map(usuarios.map((u) => [u.id, { nome: u.nome, email: u.email }]));
}
