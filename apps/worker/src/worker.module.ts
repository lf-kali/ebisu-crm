import { Module } from '@nestjs/common';
import { CONFIG_WORKER, lerConfigWorker } from './config.js';
import { EnvioEmailsService } from './emails/envio-emails.service.js';

// Registro dos processadores (notificações, scoring, lotes, jobs agendados). Por ora, só o
// outbox de e-mails do sistema (F3-4b2); BullMQ entra na F10.
@Module({
  providers: [
    { provide: CONFIG_WORKER, useFactory: () => lerConfigWorker(process.env) },
    EnvioEmailsService,
  ],
})
export class WorkerModule {}
