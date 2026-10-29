import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErroDominio } from '../../core/erros/erro-dominio.js';

// Política de senha (plano docs/planos/f3-4a-cadastro-empresas.md, decisão 3; OWASP ASVS 2.1):
// 12 a 128 caracteres, fora da lista de senhas vazadas e sem o e-mail ou o nome de quem cadastra.
// Vale no cadastro (e, depois, no convite e na troca de senha). O login não aplica a política.

export const SENHA_MINIMO = 12;
export const SENHA_MAXIMO = 128;
/** Partes do nome ou do e-mail mais curtas que isto não contam (ex.: "ana" em "banana"). */
const PARTE_MINIMA = 4;
/** Caracteres diferentes: "            " (12 espaços) e "abcabcabcabc" não passam. */
const DISTINTOS_MINIMO = 5;

let vazadas: ReadonlySet<string> | undefined;

/**
 * A lista (senhas-vazadas.txt, em minúsculas), lida uma vez. O serviço de cadastro a carrega
 * ao subir: sem o arquivo, a API não sobe, em vez de aceitar qualquer senha.
 */
export function senhasVazadas(): ReadonlySet<string> {
  vazadas ??= new Set(
    readFileSync(join(__dirname, 'senhas-vazadas.txt'), 'utf8')
      .split('\n')
      .filter((linha) => linha && !linha.startsWith('#')),
  );
  return vazadas;
}

/** Minúsculas e sem acento: "José" e "jose" contam como o mesmo nome. */
const simplificar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * O e-mail, a parte antes do @ (inteira, sem pontuação e em pedaços) e o nome (inteiro, sem
 * espaços e cada palavra).
 */
function partesPessoais(email: string, nome: string): string[] {
  const palavras = simplificar(nome).split(/[^a-z0-9]+/);
  const usuario = simplificar(email).split('@')[0] ?? '';
  const pedacos = usuario.split(/[^a-z0-9]+/);
  return [
    simplificar(email),
    usuario,
    pedacos.join(''),
    ...pedacos,
    palavras.join(''),
    ...palavras,
  ].filter((parte) => parte.length >= PARTE_MINIMA);
}

/** Sem espaços nem caracteres invisíveis: "pass\u200bword 1234" conta como "password1234". */
const compactar = (texto: string) => texto.replace(/[\p{Cf}\p{Z}\s]/gu, '');

/** 422 `validacao` no campo `senha`, sem dizer qual regra falhou. */
export function validarSenha(senha: string, pessoa: { email: string; nome: string }): void {
  // NFKC: "ＰＡＳＳＷＯＲＤ１２３４" (largura total) conta como "password1234".
  const normal = senha.normalize('NFKC');
  const simples = simplificar(normal);
  const fraca =
    senha.length < SENHA_MINIMO ||
    senha.length > SENHA_MAXIMO ||
    new Set(normal).size < DISTINTOS_MINIMO ||
    senhasVazadas().has(normal.toLowerCase()) ||
    senhasVazadas().has(compactar(normal).toLowerCase()) ||
    partesPessoais(pessoa.email, pessoa.nome).some((parte) => compactar(simples).includes(parte));
  if (fraca)
    throw new ErroDominio('validacao', {
      campos: [
        {
          campo: 'senha',
          code: 'senha_fraca',
          mensagem:
            'Senha fraca: use 12 ou mais caracteres, sem seu nome ou e-mail, e evite senhas comuns.',
        },
      ],
    });
}
