import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { aguardarEncerramento } from '../src/aguardar-encerramento.js';
import { WorkerModule } from '../src/worker.module.js';

describe('worker', () => {
  it('sobe e encerra o contexto da aplicação (banco fora do ar não derruba o laço)', async () => {
    Object.assign(process.env, {
      DATABASE_URL_APP: 'postgresql://ninguem:x@127.0.0.1:1/nada',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_REMETENTE: 'ebisuCRM <nao-responda@ebisu.local>',
      WEB_URL: 'http://localhost:5173',
    });
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    await expect(app.close()).resolves.toBeUndefined();
  });

  it('recusa subir sem a configuração, sem mostrar valores', async () => {
    const { lerConfigWorker } = await import('../src/config.js');
    expect(() => lerConfigWorker({ DATABASE_URL_APP: 'postgresql://u:segredo@h/b' })).toThrow(
      /SMTP_HOST, SMTP_PORT, SMTP_REMETENTE, WEB_URL/,
    );
    expect(() => lerConfigWorker({ DATABASE_URL_APP: 'x:segredo' })).not.toThrow(/segredo/);
  });

  it('resolve aguardarEncerramento ao receber o sinal', async () => {
    const espera = aguardarEncerramento(['SIGUSR2']);
    process.emit('SIGUSR2', 'SIGUSR2');
    await expect(espera).resolves.toBe('SIGUSR2');
  });
});
