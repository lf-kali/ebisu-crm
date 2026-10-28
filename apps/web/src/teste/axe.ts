import axe from 'axe-core';

/** Violações de acessibilidade (axe-core). Contraste de cor não é avaliável no jsdom. */
export async function violacoesA11y(container: Element) {
  const { violations } = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}
