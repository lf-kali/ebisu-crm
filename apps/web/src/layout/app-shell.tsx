import { Button } from '@ebisu/ui/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@ebisu/ui/components/ui/sheet';
import { cn } from '@ebisu/ui/lib/utils';
import { Menu } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type ItemNavegacao, NAVEGACAO } from './navegacao';

interface PropsAppShell {
  children: ReactNode;
  /** Caminho atual, para marcar o item ativo (vem do roteador no PR 2). */
  caminhoAtual?: string;
  /** Área à direita do cabeçalho (seletor de empresa e usuário, no PR 3). */
  cabecalho?: ReactNode;
  itens?: readonly ItemNavegacao[];
}

function ListaNavegacao({
  itens,
  caminhoAtual,
  aoNavegar,
}: {
  itens: readonly ItemNavegacao[];
  caminhoAtual?: string;
  aoNavegar?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {itens.map(({ rotulo, caminho, icone: Icone }) => {
        const ativo = caminho === caminhoAtual;
        return (
          <li key={caminho}>
            <a
              href={caminho}
              onClick={aoNavegar}
              aria-current={ativo ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none',
                ativo && 'bg-sidebar-accent text-sidebar-accent-foreground',
              )}
            >
              <Icone aria-hidden className="size-4" />
              {rotulo}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** Layout autenticado: cabeçalho, menu lateral por módulo e conteúdo (responsivo). */
export function AppShell({ children, caminhoAtual, cabecalho, itens = NAVEGACAO }: PropsAppShell) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
        <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir menu">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-sidebar p-4">
            <SheetHeader className="p-0 pb-4">
              <SheetTitle>ebisuCRM</SheetTitle>
            </SheetHeader>
            <nav aria-label="Menu principal">
              <ListaNavegacao
                itens={itens}
                caminhoAtual={caminhoAtual}
                aoNavegar={() => setMenuAberto(false)}
              />
            </nav>
          </SheetContent>
        </Sheet>
        <span className="text-base font-semibold tracking-tight">ebisuCRM</span>
        <div className="ml-auto flex items-center gap-2">{cabecalho}</div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-3 md:block">
          <nav aria-label="Menu principal">
            <ListaNavegacao itens={itens} caminhoAtual={caminhoAtual} />
          </nav>
        </aside>
        <main id="conteudo" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
