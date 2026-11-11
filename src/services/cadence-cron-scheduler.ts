/**
 * BGR Benefícios — Agendador Cron Automático da Régua de Vendas e Cobranças (Prioridade 5)
 * Executa periodicamente a avaliação de elegibilidade das Réguas de Campanhas de Venda (D+1 a D+7)
 * e Cobranças em Modo Geral (D-3 a D+10), respeitando a janela comercial BRT (09:00–18:00, seg-sex)
 * e a lista de supressão LGPD (Opt-Out).
 */

export interface CronSchedulerStatus {
  enabled: boolean;
  interval_seconds: number;
  respect_business_hours_brt: boolean;
  total_runs: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_summary: string;
}

export class CadenceCronScheduler {
  private enabled = false;
  private intervalSeconds = 300; // Padrão: a cada 5 minutos (300s)
  private respectBusinessHoursBrt = true;
  private totalRuns = 0;
  private lastRunAt: string | null = null;
  private nextRunAt: string | null = null;
  private lastRunSummary = 'Agendador Cron pronto (aguardando ativação automática ou disparo manual).';
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private readonly onTickCallback: () => Promise<{ sent: number; blocked: number }>;

  constructor(onTickCallback: () => Promise<{ sent: number; blocked: number }>) {
    this.onTickCallback = onTickCallback;
  }

  static isWithinBrtBusinessHours(now = new Date()): boolean {
    // UTC-3 (Horário de Brasília)
    const brtTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const dayOfWeek = brtTime.getUTCDay(); // 0 = Dom, 6 = Sáb
    const hour = brtTime.getUTCHours();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    return isWeekday && hour >= 9 && hour < 18;
  }

  configure(params: {
    enabled?: boolean;
    intervalSeconds?: number;
    respectBusinessHoursBrt?: boolean;
  }): CronSchedulerStatus {
    if (typeof params.intervalSeconds === 'number' && params.intervalSeconds >= 10) {
      this.intervalSeconds = params.intervalSeconds;
    }
    if (typeof params.respectBusinessHoursBrt === 'boolean') {
      this.respectBusinessHoursBrt = params.respectBusinessHoursBrt;
    }
    if (typeof params.enabled === 'boolean') {
      if (params.enabled) {
        this.start();
      } else {
        this.stop();
      }
    } else if (this.enabled) {
      this.start();
    }
    return this.getStatus();
  }

  start(): void {
    this.stop();
    this.enabled = true;
    this.nextRunAt = new Date(Date.now() + this.intervalSeconds * 1000).toISOString();
    this.lastRunSummary = `Cron automático ATIVO (ciclo a cada ${this.intervalSeconds}s).`;
    this.timerHandle = setInterval(() => {
      void this.executeTick();
    }, this.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.enabled = false;
    this.nextRunAt = null;
    this.lastRunSummary = 'Cron automático PAUSADO.';
  }

  async executeTick(): Promise<void> {
    const now = new Date();
    this.lastRunAt = now.toISOString();
    if (this.enabled) {
      this.nextRunAt = new Date(now.getTime() + this.intervalSeconds * 1000).toISOString();
    }

    if (this.respectBusinessHoursBrt && !CadenceCronScheduler.isWithinBrtBusinessHours(now)) {
      this.lastRunSummary =
        'Ciclo avaliado e retido: fora do horário comercial de Brasília (09:00 às 18:00 BRT, seg–sex).';
      return;
    }

    this.totalRuns += 1;
    const res = await this.onTickCallback();
    this.lastRunSummary = `Ciclo #${this.totalRuns} concluído: ${res.sent} disparo(s) elegível(is) enviado(s) e ${res.blocked} bloqueado(s) por proteção LGPD/Opt-Out.`;
  }

  getStatus(): CronSchedulerStatus {
    return {
      enabled: this.enabled,
      interval_seconds: this.intervalSeconds,
      respect_business_hours_brt: this.respectBusinessHoursBrt,
      total_runs: this.totalRuns,
      last_run_at: this.lastRunAt,
      next_run_at: this.nextRunAt,
      last_run_summary: this.lastRunSummary,
    };
  }
}
