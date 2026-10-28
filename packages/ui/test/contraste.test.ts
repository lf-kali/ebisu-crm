import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guarda de contraste (DESIGN.md): lê os tokens do globals.css e mede os pares que os
// componentes usam, compondo transparências como o navegador (em sRGB). Texto ≥ 4,5:1;
// componente de interface e foco ≥ 3:1 (WCAG 1.4.3 e 1.4.11).

const css = readFileSync(new URL('../src/styles/globals.css', import.meta.url), 'utf8');

function tokens(seletor: ':root' | '.dark'): Record<string, string> {
  const bloco =
    new RegExp(`(?:^|\\n)${seletor.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  return Object.fromEntries(
    [...bloco.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, k, v]) => [k!, v!.trim()]),
  );
}

type Rgb = [number, number, number];
const codificar = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const decodificar = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** oklch(L C h [/ a%]) → sRGB codificado + alpha. */
function lerOklch(valor: string): { rgb: Rgb; alpha: number } {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(valor);
  if (!m) throw new Error(`Cor não suportada no teste: ${valor}`);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear: Rgb = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return {
    rgb: linear.map((x) => codificar(Math.min(Math.max(x, 0), 1))) as Rgb,
    alpha: m[4] ? Number(m[4]) / 100 : 1,
  };
}

function sobre(frente: { rgb: Rgb; alpha: number }, fundo: Rgb, alphaExtra = 1): Rgb {
  const a = frente.alpha * alphaExtra;
  return frente.rgb.map((c, i) => a * c + (1 - a) * fundo[i]!) as Rgb;
}

const luminancia = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(decodificar) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (x: Rgb, y: Rgb) => {
  const [a, b] = [luminancia(x), luminancia(y)].sort((p, q) => q - p) as [number, number];
  return (a + 0.05) / (b + 0.05);
};

// [frente, fundo, mínimo, alpha da frente, alpha do fundo, superfície onde o fundo é composto,
//  modo]. Sem modo = vale nos dois; com modo = a combinação só existe nele (classe `dark:`).
type Modo = ':root' | '.dark';
const PARES: Array<[string, string, number, number?, number?, string?, Modo?]> = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['primary-foreground', 'primary', 4.5, 1, 0.9], // hover do botão
  ['primary', 'background', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['sidebar-accent-foreground', 'sidebar-accent', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['destructive', 'background', 4.5],
  ['destructive', 'background', 4.5, 0.9], // text-destructive/90 do alert
  ['destructive', 'card', 4.5], // erro do campo nos formulários em cartão (login)
  ['destructive-foreground', 'destructive', 4.5],
  ['destructive-foreground', 'destructive', 4.5, 1, 0.9], // hover do botão
  ['sucesso', 'background', 4.5],
  ['sucesso-foreground', 'sucesso', 4.5],
  ['alerta', 'background', 4.5],
  ['ring', 'background', 3], // anel de foco (opaco)
  ['input', 'background', 3], // borda de campo
  ['input', 'muted', 3], // campo sobre superfície cinza
  ['input', 'secondary', 3],
  ['input', 'accent', 3],
  ['input', 'card', 3],
  // Botão outline e campo no escuro: dark:bg-input/30 e dark:hover:bg-input/50.
  ['foreground', 'input', 4.5, 1, 0.3, undefined, '.dark'],
  ['muted-foreground', 'input', 4.5, 1, 0.5, undefined, '.dark'],
  ['accent-foreground', 'input', 4.5, 1, 0.5, undefined, '.dark'],
  // Item destrutivo do dropdown em foco: focus:bg-destructive/10 e dark:focus:bg-destructive/20.
  ['destructive', 'destructive', 4.5, 1, 0.1, 'popover', ':root'],
  ['destructive', 'destructive', 4.5, 1, 0.2, 'popover', '.dark'],
  ['ring', 'popover', 3], // foco dos itens do dropdown
  ['sidebar-ring', 'sidebar', 3], // foco dos links do menu
  ['sidebar-ring', 'sidebar-accent', 3],
  ['sidebar-primary', 'sidebar-accent', 3], // barra do item ativo do menu
];

describe.each([':root', '.dark'] as const)('contraste dos tokens (%s)', (seletor) => {
  const pares = PARES.filter(([, , , , , , modo]) => !modo || modo === seletor);
  const t = tokens(seletor);
  const base = tokens(':root');
  const cor = (nome: string) => lerOklch(t[nome] ?? base[nome]!);
  const fundo = cor('background').rgb;

  it.each(pares)(
    '%s sobre %s ≥ %s:1',
    (frente, atras, minimo, alphaFrente = 1, alphaFundo = 1, superficie) => {
      const corFundo = sobre(cor(atras), superficie ? cor(superficie).rgb : fundo, alphaFundo);
      const corFrente = sobre(cor(frente), corFundo, alphaFrente);
      expect(contraste(corFrente, corFundo)).toBeGreaterThanOrEqual(minimo);
    },
  );
});

// Componentes do ui e telas do web (exceto testes).
const arquivosTsx = (pasta: URL): URL[] =>
  readdirSync(pasta, { withFileTypes: true }).flatMap((item) =>
    item.isDirectory()
      ? arquivosTsx(new URL(`${item.name}/`, pasta))
      : item.name.endsWith('.tsx') && !item.name.endsWith('.test.tsx')
        ? [new URL(item.name, pasta)]
        : [],
  );

describe('componentes e telas não usam combinações que fogem da tabela de contraste', () => {
  const arquivos = [
    ...arquivosTsx(new URL('../src/', import.meta.url)),
    ...arquivosTsx(new URL('../../../apps/web/src/', import.meta.url)),
  ].map((url) => [url.pathname.split('/').slice(-3).join('/'), url] as const);

  it.each(arquivos)('%s', (_, url) => {
    const fonte = readFileSync(url, 'utf8');
    // Anel de foco translúcido não chega a 3:1; texto branco sobre cor de status idem.
    expect(fonte).not.toMatch(/ring-ring\/\d+|outline-ring\/\d+/);
    expect(fonte).not.toMatch(/text-white/);
  });
});

describe('componentes do ui não escondem o foco sem um anel no lugar', () => {
  const componentes = arquivosTsx(new URL('../src/components/', import.meta.url));

  it.each(componentes.map((url) => [url.pathname.split('/').slice(-2).join('/'), url] as const))(
    '%s',
    (_, url) => {
      // Cada grupo de classes que tira o outline precisa trazer um ring (foco visível, 1.4.11).
      // Grupo = strings seguidas separadas só por vírgula (argumentos de um mesmo cn(...)).
      const literal = String.raw`(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60)`;
      const grupo = new RegExp(`${literal}(?:\\s*,\\s*${literal})*`, 'g');
      const classes = [...readFileSync(url, 'utf8').matchAll(grupo)]
        .map(([texto]) => texto)
        .filter((texto) => /\boutline-(hidden|none)\b/.test(texto));
      expect(classes.filter((texto) => !/\bring\b|ring-/.test(texto))).toEqual([]);
    },
  );
});
