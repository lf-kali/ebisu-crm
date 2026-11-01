import type { EmpresaDoMembro, Papel } from '@ebisu/contracts';
import { Button } from '@ebisu/ui/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { Selecao } from '../formularios/selecao';

// Editor de papéis por empresa (plano docs/planos/f3-web-2-configuracoes.md, decisões 4 e 5): cada
// linha é "papel × empresa (ou todas)". O papel de dono só existe em todas as empresas. Quem
// decide as regras do dono (só um dono dá ou tira o papel) é a API.

export interface LinhaPapel {
  papel_id: string;
  /** null = todas as empresas da conta. */
  empresa_id: string | null;
}

const TODAS = '';
export const PAPEL_DONO = 'OWNER';

export function EditorPapeis({
  papeis,
  empresas,
  valor,
  aoMudar,
  erro,
}: {
  papeis: readonly Papel[];
  empresas: readonly Pick<EmpresaDoMembro, 'id' | 'nome_fantasia'>[];
  valor: readonly LinhaPapel[];
  aoMudar: (linhas: LinhaPapel[]) => void;
  erro?: string;
}) {
  const ehDono = (papelId: string) => papeis.find((p) => p.id === papelId)?.chave === PAPEL_DONO;
  const trocar = (indice: number, linha: LinhaPapel) =>
    aoMudar(valor.map((atual, i) => (i === indice ? linha : atual)));

  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={erro ? 'editor-papeis-erro' : undefined}
    >
      <legend className="mb-1 text-sm font-medium">Papéis</legend>
      {valor.map((linha, indice) => (
        <div key={indice} className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
          <div className="min-w-40 flex-1">
            <Selecao
              rotulo={`Papel ${indice + 1}`}
              value={linha.papel_id}
              onChange={(evento) => {
                const papel_id = evento.target.value;
                trocar(indice, {
                  papel_id,
                  empresa_id: ehDono(papel_id) ? null : linha.empresa_id,
                });
              }}
            >
              {papeis.map((papel) => (
                <option key={papel.id} value={papel.id}>
                  {papel.nome}
                </option>
              ))}
            </Selecao>
          </div>
          <div className="min-w-40 flex-1">
            <Selecao
              rotulo={`Empresa do papel ${indice + 1}`}
              value={linha.empresa_id ?? TODAS}
              disabled={ehDono(linha.papel_id)}
              onChange={(evento) =>
                trocar(indice, { ...linha, empresa_id: evento.target.value || null })
              }
            >
              <option value={TODAS}>Todas as empresas</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome_fantasia}
                </option>
              ))}
            </Selecao>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remover papel ${indice + 1}`}
            disabled={valor.length === 1}
            onClick={() => aoMudar(valor.filter((_, i) => i !== indice))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          const padrao = papeis.find((p) => p.chave !== PAPEL_DONO) ?? papeis[0];
          if (padrao)
            aoMudar([...valor, { papel_id: padrao.id, empresa_id: empresas[0]?.id ?? null }]);
        }}
      >
        <Plus aria-hidden /> Adicionar papel
      </Button>
      {erro ? (
        <p id="editor-papeis-erro" className="text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Papéis em texto curto: "Técnico (Centro), Gerente (todas)". */
export const resumoPapeis = (
  atribuicoes: readonly { papel: { nome: string }; empresa_id: string | null }[],
  empresas: readonly Pick<EmpresaDoMembro, 'id' | 'nome_fantasia'>[],
) =>
  atribuicoes
    .map(
      (a) =>
        `${a.papel.nome} (${
          a.empresa_id === null
            ? 'todas'
            : (empresas.find((e) => e.id === a.empresa_id)?.nome_fantasia ?? 'outra empresa')
        })`,
    )
    .join(', ');
