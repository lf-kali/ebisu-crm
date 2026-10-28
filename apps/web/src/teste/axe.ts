import axe from 'axe-core';

/**
 * Violações de acessibilidade (axe-core). Contraste de cor não é avaliável no jsdom.
 * `semRegras` desliga regras pontuais, com o motivo documentado no teste que usa.
 */
export async function violacoesA11y(container: Element, semRegras: readonly string[] = []) {
  const { violations } = await axe.run(container, {
    rules: Object.fromEntries(
      ['color-contrast', ...semRegras].map((regra) => [regra, { enabled: false }]),
    ),
  });
  return violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}
