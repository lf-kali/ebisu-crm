import { Button } from '@ebisu/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ebisu/ui/components/ui/dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { consultaEu } from '../auth/consultas';

const rotaApp = getRouteApi('/_app');

/** Cabeçalho: quem está logado, em qual conta; trocar de conta e sair. */
export function MenuUsuario() {
  const { sessao, cliente } = rotaApp.useRouteContext();
  const navigate = useNavigate();
  const href = useRouterState({ select: (estado) => estado.location.href });
  const atual = useSyncExternalStore(sessao.assinar, sessao.obter);
  const eu = useQuery(consultaEu(cliente));
  if (!atual || !eu.data) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2">
          <span className="flex flex-col items-end leading-tight">
            <span>{eu.data.usuario.nome}</span>
            <span className="text-xs font-normal text-muted-foreground">{atual.conta.nome}</span>
          </span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block text-sm font-medium">{eu.data.usuario.nome}</span>
          <span className="block text-xs text-muted-foreground">{eu.data.usuario.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {atual.contas.length > 1 ? (
          <DropdownMenuItem
            onSelect={() => void navigate({ to: '/escolher-conta', search: { redirect: href } })}
          >
            Trocar de conta
          </DropdownMenuItem>
        ) : null}
        {/* O layout reage à sessão encerrada: navega para o login e limpa o cache. */}
        <DropdownMenuItem onSelect={() => void sessao.sair()}>Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
