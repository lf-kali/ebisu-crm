import type { EmpresaDoMembro, ResumoConta } from '@ebisu/contracts';

// Dados de demonstração da API simulada (MSW). Só existem no navegador em `pnpm dev` com
// VITE_API_SIMULADA=1 e nos testes; nunca entram no build de produção.

export const SENHA_DEMO = 'demo1234';

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const CONTAS = {
  ebisu: { tenant_id: id(1), nome: 'Assistência Ebisu', slug: 'ebisu' },
  oficina: { tenant_id: id(2), nome: 'Oficina do Bairro', slug: 'oficina' },
} satisfies Record<string, ResumoConta>;

const TODAS: EmpresaDoMembro['permissoes'] = Object.fromEntries(
  ['contato', 'negocio', 'dispositivo', 'orcamento', 'os', 'estoque', 'financeiro']
    .flatMap((recurso) => [`${recurso}.read`, `${recurso}.create`, `${recurso}.update`])
    .map((chave) => [chave, 'TENANT' as const]),
);

const empresa = (
  n: number,
  nome: string,
  permissoes: EmpresaDoMembro['permissoes'],
): EmpresaDoMembro => ({
  id: id(100 + n),
  nome_fantasia: nome,
  razao_social: `${nome} LTDA`,
  logo_url: null,
  permissoes,
});

export interface UsuarioDemo {
  id: string;
  nome: string;
  email: string;
  /** Por conta: membro e empresas com as permissões efetivas. */
  contas: Array<{ conta: ResumoConta; membroId: string; empresas: EmpresaDoMembro[] }>;
}

export const USUARIOS: readonly UsuarioDemo[] = [
  {
    id: id(10),
    nome: 'Ana Souza',
    email: 'ana@demo.test',
    contas: [
      {
        conta: CONTAS.ebisu,
        membroId: id(20),
        empresas: [empresa(1, 'Ebisu Centro', TODAS), empresa(2, 'Ebisu Shopping', TODAS)],
      },
      {
        conta: CONTAS.oficina,
        membroId: id(21),
        empresas: [empresa(3, 'Oficina do Bairro', TODAS)],
      },
    ],
  },
  {
    id: id(11),
    nome: 'Bruno Lima',
    email: 'bruno@demo.test',
    contas: [
      {
        conta: CONTAS.ebisu,
        membroId: id(22),
        // Técnico: só bancada e dispositivos, e só onde é responsável.
        empresas: [
          empresa(1, 'Ebisu Centro', {
            'os.read': 'PROPRIO',
            'os.update': 'PROPRIO',
            'dispositivo.read': 'EMPRESA',
          }),
        ],
      },
    ],
  },
];
