import { URL_MAILPIT } from './ambiente';

// Lê o e-mail que o worker mandou ao Mailpit (API em /api/v1).

interface Busca {
  messages: Array<{ ID: string }>;
}

/** Espera o primeiro e-mail para o endereço e devolve o texto dele. */
export async function esperarEmail(para: string, prazoMs = 30_000): Promise<string> {
  const fim = Date.now() + prazoMs;
  while (Date.now() < fim) {
    const busca = (await (
      await fetch(`${URL_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}`)
    ).json()) as Busca;
    const [primeira] = busca.messages;
    if (primeira) {
      const mensagem = (await (
        await fetch(`${URL_MAILPIT}/api/v1/message/${primeira.ID}`)
      ).json()) as { Text: string };
      return mensagem.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nenhum e-mail para ${para} em ${prazoMs / 1000} s`);
}

/** O link do convite (`…/convite#token=…`) no texto do e-mail. */
export function linkDoConvite(texto: string): string {
  const link = /https?:\/\/\S+\/convite#token=[A-Za-z0-9_-]{43}/.exec(texto)?.[0];
  if (!link) throw new Error('E-mail sem o link do convite');
  return link;
}
