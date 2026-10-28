import { Button } from '@ebisu/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ebisu/ui/components/ui/dropdown-menu';
import { getRouteApi } from '@tanstack/react-router';
import { Building2, ChevronDown } from 'lucide-react';
import { useAcesso } from '../auth/acesso';
import { donoDaPreferencia } from '../auth/empresa';

const rotaApp = getRouteApi('/_app');

/** Empresa atual no cabeçalho; com mais de uma, troca por um menu (X-Empresa-Id). */
export function SeletorEmpresa() {
  const { empresa: empresaAtual } = rotaApp.useRouteContext();
  const { eu, empresa, empresas } = useAcesso();
  if (!eu || !empresa) return null;

  const nome = (
    <>
      <Building2 aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">Empresa: </span>
      <span className="min-w-0 truncate sm:max-w-[10rem]">{empresa.nome_fantasia}</span>
    </>
  );
  if (empresas.length === 1) {
    return (
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">{nome}</span>
    );
  }

  function escolher(id: string) {
    if (!eu || id === empresa?.id) return;
    // O layout reage à troca: refaz os dados de domínio (que são por empresa).
    empresaAtual.escolher(donoDaPreferencia(eu), id);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 shrink gap-2">
          {nome}
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Empresa</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={empresa.id} onValueChange={escolher}>
          {empresas.map((e) => (
            <DropdownMenuRadioItem key={e.id} value={e.id}>
              {e.nome_fantasia}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
