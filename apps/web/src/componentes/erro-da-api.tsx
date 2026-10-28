import { Problema } from '@ebisu/contracts';
import { EstadoErro } from '@ebisu/ui/components/estados';
import type { ReactNode } from 'react';
import { ErroApi } from '../api/erro-api';

const SEM_CONEXAO = 'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.';

/** Mostra um erro da API com a mensagem do catálogo (DoD §6.1) e o request_id para o suporte. */
export function ErroDaApi({ erro, acao }: { erro: unknown; acao?: ReactNode }) {
  if (erro instanceof ErroApi && erro.status === 0)
    return <EstadoErro titulo={SEM_CONEXAO} acao={acao} />;
  const problema = Problema.safeParse(erro instanceof ErroApi ? erro.problema : erro);
  if (!problema.success) return <EstadoErro titulo={SEM_CONEXAO} acao={acao} />;
  const { title, detail, request_id } = problema.data;
  return <EstadoErro titulo={title} descricao={detail} codigoSuporte={request_id} acao={acao} />;
}
