import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurarApp } from './configurar-app.js';

async function iniciar(): Promise<void> {
  const app = configurarApp(await NestFactory.create(AppModule));
  const porta = Number(process.env.API_PORT ?? 3000);
  await app.listen(porta);
}

void iniciar();
