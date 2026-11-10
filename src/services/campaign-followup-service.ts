/**
 * BGR Benefícios — Serviço de Campanhas de Reativação e Follow-up Comercial (Fase 6)
 *
 * Implementa os requisitos das Seções 4, 5, 8 e 11 (T30, T31, T32) e config/variaveis-ambiente.md:
 * - Contrato: Entradas (contact_id, consent_state, stage) -> Saídas (eligibility, template_id, delivery_status)
 * - Validação rigorosa de Base Legal LGPD + Lista de Supressão (Opt-Out efetivo)
 * - Controle de Horário Comercial (09:00 às 18:00 BRT, segunda a sexta-feira)
 * - Cadência de Follow-up: máximo de 3 tentativas, respeitando intervalos [1, 3, 7] dias
 * - Prevenção de duplicidade (idempotência por campanha/etapa) e limite diário de envios
 */

import crypto from 'node:crypto';
import {
  isEligibleForCampaign,
  type AuditEvent,
  type Consent,
  type FunnelStage,
} from '../domain/contracts.ts';
import { sanitizeForAudit } from '../observability/sanitizer.ts';

export type FollowUpTemplateId =
  | 'followup_primeiro_contato'
  | 'followup_cotacao_enviada'
  | 'followup_negociacao'
  | 'followup_aguardando_assinatura'
  | 'bgr_reativacao';

export type DeliveryStatus =
  | 'queued_for_delivery'
  | 'suppressed_opt_out'
  | 'blocked_missing_consent'
  | 'blocked_outside_business_hours'
  | 'blocked_cadence_limit'
  | 'blocked_stage_not_eligible'
  | 'blocked_duplicate_dispatch'
  | 'blocked_daily_quota_exceeded';

export interface FollowUpCandidateInput {
  contact_id: string;
  phone: string;
  name: string;
  consent_state: Consent;
  stage: FunnelStage;
  followup_count: number;
  last_followup_at_iso?: string | null;
  campaign_id?: string;
  now_iso?: string;
}

export interface CampaignEligibilityResult {
  contact_id: string;
  eligibility: boolean;
  template_id: FollowUpTemplateId | null;
  delivery_status: DeliveryStatus;
  idempotency_key: string;
  reason: string;
  audit_event: AuditEvent;
}

export interface CampaignMetricsSummary {
  total_evaluated: number;
  eligible_queued: number;
  suppressed_opt_out: number;
  blocked_missing_consent: number;
  blocked_cadence_or_stage: number;
  blocked_duplicate_or_quota: number;
  blocked_outside_hours: number;
}

const STAGE_TO_TEMPLATE: Partial<Record<FunnelStage, FollowUpTemplateId>> = {
  contato_iniciado: 'followup_primeiro_contato',
  qualificacao: 'followup_primeiro_contato',
  cotacao_enviada: 'followup_cotacao_enviada',
  cliente_interessado: 'followup_negociacao',
  cliente_indeciso: 'followup_negociacao',
  aguardando_assinatura: 'followup_aguardando_assinatura',
};

export interface CampaignFollowUpConfig {
  startHourBrt?: number; // padrão 9 (09:00 BRT)
  endHourBrt?: number; // padrão 18 (18:00 BRT)
  weekdaysOnly?: boolean; // padrão true
  maxFollowUpAttempts?: number; // padrão 3
  intervalDays?: number[]; // padrão [1, 3, 7]
  dailyLimit?: number; // padrão 100
  environment?: 'teste' | 'homologacao' | 'producao';
  companyId?: string;
}

export class CampaignFollowUpService {
  private readonly suppressionListPhones = new Set<string>();
  private readonly dispatchedIdempotencyKeys = new Set<string>();
  private readonly dailyCountsByDate = new Map<string, number>();
  private readonly config: Required<CampaignFollowUpConfig>;

  private readonly metrics: CampaignMetricsSummary = {
    total_evaluated: 0,
    eligible_queued: 0,
    suppressed_opt_out: 0,
    blocked_missing_consent: 0,
    blocked_cadence_or_stage: 0,
    blocked_duplicate_or_quota: 0,
    blocked_outside_hours: 0,
  };

  constructor(config?: CampaignFollowUpConfig) {
    this.config = {
      startHourBrt: config?.startHourBrt ?? 9,
      endHourBrt: config?.endHourBrt ?? 18,
      weekdaysOnly: config?.weekdaysOnly ?? true,
      maxFollowUpAttempts: config?.maxFollowUpAttempts ?? 3,
      intervalDays: config?.intervalDays ?? [1, 3, 7],
      dailyLimit: config?.dailyLimit ?? 100,
      environment: config?.environment ?? 'teste',
      companyId: config?.companyId ?? 'bgr_beneficios',
    };
  }

  /**
   * Adiciona imediatamente um telefone à lista global de supressão (Opt-Out efetivo - T31).
   */
  registerOptOutSuppression(phone: string): void {
    const clean = this.normalizePhone(phone);
    if (clean) {
      this.suppressionListPhones.add(clean);
    }
  }

  isPhoneSuppressed(phone: string): boolean {
    return this.suppressionListPhones.has(this.normalizePhone(phone));
  }

  /**
   * Verifica se o horário informado está dentro da janela comercial de Brasília (BRT = UTC-3).
   */
  isWithinBusinessHoursBrt(nowIso: string): boolean {
    const utcDate = new Date(nowIso);
    // Converte para horário de Brasília (UTC-3)
    const brtMs = utcDate.getTime() - 3 * 60 * 60 * 1000;
    const brtDate = new Date(brtMs);

    const dayOfWeek = brtDate.getUTCDay(); // 0 = Domingo, 6 = Sábado
    if (this.config.weekdaysOnly && (dayOfWeek === 0 || dayOfWeek === 6)) {
      return false;
    }

    const hour = brtDate.getUTCHours();
    return hour >= this.config.startHourBrt && hour < this.config.endHourBrt;
  }

  /**
   * Avalia elegibilidade de um contato para Follow-up Comercial ou Campanha de Reativação (T30, T31, T32).
   */
  evaluateCandidate(
    input: FollowUpCandidateInput,
    mode: 'followup_funil' | 'campanha_reativacao' = 'followup_funil'
  ): CampaignEligibilityResult {
    this.metrics.total_evaluated += 1;

    const nowIso = input.now_iso ?? new Date().toISOString();
    const dateKey = nowIso.slice(0, 10);
    const cleanPhone = this.normalizePhone(input.phone);
    const campaignKey = input.campaign_id ?? mode;

    const attemptNumber = input.followup_count + 1;
    const rawIdem = `${campaignKey}|${input.contact_id}|${cleanPhone}|${input.stage}|attempt_${attemptNumber}`;
    const idemHash = crypto.createHash('sha256').update(rawIdem, 'utf8').digest('hex').slice(0, 20);
    const idempotencyKey = `idem_cmp_${idemHash}`;

    // 1. Verifica Lista de Supressão Global e flag de Opt-Out no Consent (T31)
    if (this.isPhoneSuppressed(cleanPhone) || input.consent_state.opt_out_requested) {
      this.metrics.suppressed_opt_out += 1;
      return this.buildResult({
        input,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'suppressed_opt_out',
        idempotencyKey,
        reason: 'Contato bloqueado: consta na lista de descadastro (opt-out ativo).',
        severity: 'HIGH',
      });
    }

    // 2. Verifica Consentimento e Base Legal LGPD (T30)
    const consentCheck = isEligibleForCampaign(input.consent_state);
    if (!consentCheck.eligible) {
      this.metrics.blocked_missing_consent += 1;
      return this.buildResult({
        input,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'blocked_missing_consent',
        idempotencyKey,
        reason: consentCheck.reason,
        severity: 'HIGH',
      });
    }

    // 3. Verifica Horário Comercial em BRT (09:00 às 18:00 dias úteis)
    if (!this.isWithinBusinessHoursBrt(nowIso)) {
      this.metrics.blocked_outside_hours += 1;
      return this.buildResult({
        input,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'blocked_outside_business_hours',
        idempotencyKey,
        reason: 'Disparo retido: fora do horário comercial permitido (09:00 às 18:00 BRT em dias úteis).',
        severity: 'LOW',
      });
    }

    // 4. Verifica Deduplicação (T32 - não enviar duas vezes a mesma mensagem no ciclo)
    if (this.dispatchedIdempotencyKeys.has(idempotencyKey)) {
      this.metrics.blocked_duplicate_or_quota += 1;
      return this.buildResult({
        input,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'blocked_duplicate_dispatch',
        idempotencyKey,
        reason: 'Disparo duplicado bloqueado por chave de idempotência.',
        severity: 'LOW',
      });
    }

    // 5. Verifica Limite Diário da Campanha
    const currentDailyCount = this.dailyCountsByDate.get(dateKey) ?? 0;
    if (currentDailyCount >= this.config.dailyLimit) {
      this.metrics.blocked_duplicate_or_quota += 1;
      return this.buildResult({
        input,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'blocked_daily_quota_exceeded',
        idempotencyKey,
        reason: `Limite diário de disparos (${this.config.dailyLimit}) atingido para a data ${dateKey}.`,
        severity: 'MEDIUM',
      });
    }

    // 6. Regras específicas de Follow-up do Funil vs. Campanha de Reativação
    let selectedTemplate: FollowUpTemplateId | null = null;

    if (mode === 'campanha_reativacao') {
      selectedTemplate = 'bgr_reativacao';
    } else {
      // Verifica estágio elegível (não dispara para contratacao_confirmada, oportunidade_perdida ou atendimento_humano)
      selectedTemplate = STAGE_TO_TEMPLATE[input.stage] ?? null;
      if (!selectedTemplate) {
        this.metrics.blocked_cadence_or_stage += 1;
        return this.buildResult({
          input,
          eligibility: false,
          templateId: null,
          deliveryStatus: 'blocked_stage_not_eligible',
          idempotencyKey,
          reason: `Estágio '${input.stage}' não permite follow-up comercial automático.`,
          severity: 'LOW',
        });
      }

      // Verifica número máximo de tentativas (max_tentativas = 3)
      if (input.followup_count >= this.config.maxFollowUpAttempts) {
        this.metrics.blocked_cadence_or_stage += 1;
        return this.buildResult({
          input,
          eligibility: false,
          templateId: null,
          deliveryStatus: 'blocked_cadence_limit',
          idempotencyKey,
          reason: `Contato já atingiu o limite máximo de ${this.config.maxFollowUpAttempts} tentativas de follow-up.`,
          severity: 'LOW',
        });
      }

      // Verifica intervalo mínimo em dias desde o último follow-up ([1, 3, 7] dias)
      if (input.last_followup_at_iso) {
        const requiredDays =
          this.config.intervalDays[input.followup_count] ??
          this.config.intervalDays[this.config.intervalDays.length - 1];
        const elapsedMs = Date.parse(nowIso) - Date.parse(input.last_followup_at_iso);
        const requiredMs = requiredDays * 24 * 60 * 60 * 1000;

        if (elapsedMs < requiredMs) {
          this.metrics.blocked_cadence_or_stage += 1;
          return this.buildResult({
            input,
            eligibility: false,
            templateId: null,
            deliveryStatus: 'blocked_cadence_limit',
            idempotencyKey,
            reason: `Intervalo mínimo de cadência (${requiredDays} dia(s)) ainda não cumprido desde o último follow-up.`,
            severity: 'LOW',
          });
        }
      }
    }

    // Contato 100% elegível! Registra envio e incrementa métricas
    this.dispatchedIdempotencyKeys.add(idempotencyKey);
    this.dailyCountsByDate.set(dateKey, currentDailyCount + 1);
    this.metrics.eligible_queued += 1;

    return this.buildResult({
      input,
      eligibility: true,
      templateId: selectedTemplate,
      deliveryStatus: 'queued_for_delivery',
      idempotencyKey,
      reason: `Contato elegível para template '${selectedTemplate}' (tentativa ${attemptNumber}).`,
      severity: 'LOW',
    });
  }

  getMetricsSummary(): CampaignMetricsSummary {
    return { ...this.metrics };
  }

  private normalizePhone(phone: string): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('55') ? digits : `55${digits}`;
  }

  private buildResult(params: {
    input: FollowUpCandidateInput;
    eligibility: boolean;
    templateId: FollowUpTemplateId | null;
    deliveryStatus: DeliveryStatus;
    idempotencyKey: string;
    reason: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }): CampaignEligibilityResult {
    const { input, eligibility, templateId, deliveryStatus, idempotencyKey, reason, severity } = params;
    const rawSummary = `Campanha/Follow-up [${deliveryStatus}] para contato ${input.contact_id} (${input.phone}): ${reason}`;
    const sanitized = sanitizeForAudit(rawSummary);

    const auditEvent: AuditEvent = {
      event_id: `evt_cmp_${idempotencyKey.slice(-10)}`,
      idempotency_key: idempotencyKey,
      correlation_id: `corr_${idempotencyKey.slice(-10)}`,
      timestamp: input.now_iso ?? new Date().toISOString(),
      environment: this.config.environment,
      company_id: this.config.companyId,
      session_id: `sess_cmp_${input.contact_id}`,
      event_type: `campaign_evaluation_${deliveryStatus}`,
      severity,
      status: eligibility ? 'sucesso' : 'bloqueado',
      http_code: eligibility ? 200 : 422,
      safe_summary: sanitized.sanitized_text,
    };

    return {
      contact_id: input.contact_id,
      eligibility,
      template_id: templateId,
      delivery_status: deliveryStatus,
      idempotency_key: idempotencyKey,
      reason,
      audit_event: auditEvent,
    };
  }
}
