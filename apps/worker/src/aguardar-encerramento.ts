// Mantém o processo vivo até receber um sinal de encerramento.
export function aguardarEncerramento(
  sinais: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'],
): Promise<NodeJS.Signals> {
  return new Promise((resolver) => {
    const manter = setInterval(() => undefined, 60_000);
    for (const sinal of sinais) {
      process.once(sinal, () => {
        clearInterval(manter);
        resolver(sinal);
      });
    }
  });
}
