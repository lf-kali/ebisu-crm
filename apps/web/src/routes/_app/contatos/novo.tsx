import { EstadoVazio } from '@ebisu/ui/components/estados';
import { createFileRoute } from '@tanstack/react-router';
import { useAcesso } from '../../../auth/acesso';
import { FormularioContato } from '../../../contatos/formulario';
import { CabecalhoContatos } from '../../../contatos/pagina';

// Novo contato (plano docs/planos/f4-web-1-contatos.md, decisões 1 e 3).

export const Route = createFileRoute('/_app/contatos/novo')({ component: NovoContato });

function NovoContato() {
  const { pode } = useAcesso();
  return (
    <>
      <CabecalhoContatos
        titulo="Novo contato"
        voltar={{ link: { to: '/contatos' }, rotulo: 'Contatos' }}
      />
      {pode('contato.create') ? (
        <FormularioContato contato={null} />
      ) : (
        <EstadoVazio
          titulo="Sem permissão para criar contatos"
          descricao="Seu papel nesta empresa não inclui cadastrar contatos."
        />
      )}
    </>
  );
}
