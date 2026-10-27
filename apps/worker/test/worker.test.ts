import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { aguardarEncerramento } from '../src/aguardar-encerramento.js';
import { WorkerModule } from '../src/worker.module.js';

describe('worker', () => {
  it('sobe e encerra o contexto da aplicação', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    await expect(app.close()).resolves.toBeUndefined();
  });

  it('resolve aguardarEncerramento ao receber o sinal', async () => {
    const espera = aguardarEncerramento(['SIGUSR2']);
    process.emit('SIGUSR2', 'SIGUSR2');
    await expect(espera).resolves.toBe('SIGUSR2');
  });
});
