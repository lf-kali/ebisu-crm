// Modo escuro segue a preferência do sistema (tokens em packages/ui/src/styles/globals.css).
export function aplicarTemaDoSistema(raiz: HTMLElement = document.documentElement): () => void {
  const consulta = window.matchMedia('(prefers-color-scheme: dark)');
  const aplicar = () => raiz.classList.toggle('dark', consulta.matches);
  aplicar();
  consulta.addEventListener('change', aplicar);
  return () => consulta.removeEventListener('change', aplicar);
}
