import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { aguardarEncerramento } from './aguardar-encerramento.js';
import { WorkerModule } from './worker.module.js';

async function iniciar(): Promise<void> {
  const logger = new Logger('Worker');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  logger.log('Worker iniciado');

  const sinal = await aguardarEncerramento();
  logger.log(`Recebido ${sinal}, encerrando`);
  await app.close();
}

void iniciar();
