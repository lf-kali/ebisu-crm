import { Carregando, EstadoVazio } from '@ebisu/ui/components/estados';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useAcesso } from '../../../../auth/acesso';
import { ErroDaApi } from '../../../../componentes/erro-da-api';
import { consultaContato } from '../../../../contatos/consultas';
import { FormularioContato } from '../../../../contatos/formulario';
import { CabecalhoContatos } from '../../../../contatos/pagina';

// Editar contato (plano docs/planos/f4-web-1-contatos.md, decisões 1 e 3).

export const Route = createFileRoute('/_app/contatos/$id/editar')({ component: EditarContato });

function EditarContato() {
  const { id } = Route.useParams();
  const { cliente } = Route.useRouteContext();
  const { pode } = useAcesso();
  const contato = useQuery(consultaContato(cliente, id));
  const voltar = {
    link: { to: '/contatos/$id', params: { id } },
    rotulo: 'Ficha do contato',
  } as const;

  if (contato.isPending) return <Carregando />;
  if (contato.isError)
    return (
      <>
        <CabecalhoContatos titulo="Editar contato" voltar={voltar} />
        <ErroDaApi erro={contato.error} />
      </>
    );
  return (
    <>
      <CabecalhoContatos titulo={`Editar ${contato.data.nome}`} voltar={voltar} />
      {pode('contato.update') ? (
        // A chave recria o formulário se o contato mudar por baixo (outra aba, outro usuário).
        <FormularioContato key={contato.data.updated_at} contato={contato.data} />
      ) : (
        <EstadoVazio
          titulo="Sem permissão para editar contatos"
          descricao="Seu papel nesta empresa não inclui editar contatos."
        />
      )}
    </>
  );
}
