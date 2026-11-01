import { EstadoVazio } from '@ebisu/ui/components/estados';
import { Card, CardDescription, CardHeader, CardTitle } from '@ebisu/ui/components/ui/card';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useAcesso } from '../../../auth/acesso';
import { podeVerSecao, SECOES } from '../../../configuracoes/secoes';

export const Route = createFileRoute('/_app/configuracoes/')({ component: Configuracoes });

function Configuracoes() {
  const { escopo } = useAcesso();
  const visiveis = SECOES.filter((secao) => podeVerSecao(secao, escopo));
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Configurações</h1>
      {visiveis.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma configuração disponível"
          descricao="Seu papel nesta empresa não inclui configurações."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visiveis.map(({ titulo, descricao, caminho, icone: Icone }) => (
            <li key={caminho}>
              <Link
                to={caminho}
                className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Card className="h-full transition-colors hover:bg-accent">
                  <CardHeader>
                    <Icone className="size-5 text-primary" aria-hidden />
                    <CardTitle>
                      <h2 className="text-base">{titulo}</h2>
                    </CardTitle>
                    <CardDescription>{descricao}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
