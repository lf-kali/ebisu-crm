// Para onde voltar depois do login (?redirect=). Só caminhos internos: um valor como
// "//site.com" ou "https://site.com" vindo da URL seria um open redirect.
const BASE = 'http://interno.invalid';

export function destinoSeguro(valor: unknown): string {
  // "//site.com" e "/\\site.com" passam no startsWith('/'), mas a checagem de origem abaixo os barra.
  if (typeof valor !== 'string' || !valor.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(valor, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  const caminho = `${url.pathname}${url.search}${url.hash}`;
  // Voltar para as telas de entrada criaria um ciclo.
  return url.pathname === '/login' || url.pathname === '/escolher-conta' ? '/' : caminho;
}
