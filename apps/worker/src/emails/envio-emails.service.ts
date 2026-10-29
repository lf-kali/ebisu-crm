import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PrismaClient } from '@ebisu/db';
import { CONFIG_WORKER, type ConfigWorker } from '../config.js';
import { processarEmails } from './processar.js';
import { type Remetente, remetenteSmtp } from './remetente.js';

/**
 * Laço do outbox de e-mail: uma rodada a cada `EMAIL_INTERVALO_MS` (sem sobrepor rodadas). Uma
 * rodada que falha (banco fora do ar) é registrada e a próxima tenta de novo. No encerramento,
 * espera a rodada em curso terminar.
 */
@Injectable()
export class EnvioEmailsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('EnvioEmails');
  private readonly db: PrismaClient;
  private readonly remetente: Remetente;
  private temporizador: NodeJS.Timeout | undefined;
  private rodadaAtual: Promise<void> | undefined;
  private parado = false;

  constructor(@Inject(CONFIG_WORKER) private readonly config: ConfigWorker) {
    this.db = new PrismaClient({ datasourceUrl: config.DATABASE_URL_APP });
    this.remetente = remetenteSmtp({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      de: config.SMTP_REMETENTE,
    });
  }

  onApplicationBootstrap(): void {
    this.agendar(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.parado = true;
    clearTimeout(this.temporizador);
    await this.rodadaAtual;
    await this.db.$disconnect();
  }

  private agendar(espera: number): void {
    if (this.parado) return;
    this.temporizador = setTimeout(() => {
      this.rodadaAtual = this.rodada().finally(() => this.agendar(this.config.EMAIL_INTERVALO_MS));
    }, espera);
  }

  private async rodada(): Promise<void> {
    try {
      const enviados = await processarEmails(this.db, this.remetente, {
        webUrl: this.config.WEB_URL,
      });
      if (enviados > 0) this.logger.log(`E-mails processados: ${enviados}`);
    } catch (erro) {
      this.logger.error(`Rodada de e-mails falhou: ${erro instanceof Error ? erro.message : erro}`);
    }
  }
}
