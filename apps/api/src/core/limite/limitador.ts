import type { Redis } from 'ioredis';

// Limite de tentativas em janela fixa (§7: rate limit no login). A contagem vive no Redis para
// valer entre instâncias da API; a versão em memória serve aos testes de unidade.

export interface Limitador {
  /** Conta uma tentativa na chave; devolve em quantos segundos libera, ou 0 se está liberado. */
  registrar(chave: string, maximo: number, janelaSegundos: number): Promise<number>;
}

export const LIMITADOR = Symbol('LIMITADOR');

export function limitadorRedis(redis: Redis): Limitador {
  return {
    async registrar(chave, maximo, janelaSegundos) {
      const completa = `ebisu:limite:${chave}`;
      const [[, contagem], [, ttl]] = (await redis
        .multi()
        .incr(completa)
        // NX: a janela começa na primeira tentativa e não se renova a cada nova.
        .expire(completa, janelaSegundos, 'NX')
        .ttl(completa)
        .exec()) as [[null, number], [null, number], [null, number]];
      return contagem > maximo ? Math.max(Number(ttl), 1) : 0;
    },
  };
}

export function limitadorEmMemoria(agora: () => number = Date.now): Limitador {
  const janelas = new Map<string, { contagem: number; fim: number }>();
  return {
    async registrar(chave, maximo, janelaSegundos) {
      const instante = agora();
      const atual = janelas.get(chave);
      const janela =
        atual && atual.fim > instante
          ? atual
          : { contagem: 0, fim: instante + janelaSegundos * 1000 };
      janela.contagem += 1;
      janelas.set(chave, janela);
      return janela.contagem > maximo ? Math.ceil((janela.fim - instante) / 1000) : 0;
    },
  };
}
