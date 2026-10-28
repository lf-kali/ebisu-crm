import { EstadoVazio } from '@ebisu/ui/components/estados';

/** Página de um módulo cuja tela ainda não foi entregue (frente indicada na spec §4). */
export function EmConstrucao({ titulo, frente }: { titulo: string; frente: string }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">{titulo}</h1>
      <EstadoVazio titulo="Em construção" descricao={`Esta tela chega com a frente ${frente}.`} />
    </>
  );
}
