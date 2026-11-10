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
  | 'bgr_reativacao'
  | 'cobranca_lembrete_d_menos_3'
  | 'cobranca_vencimento_hoje_d0'
  | 'cobranca_aviso_atraso_d_mais_2'
  | 'cobranca_regularizacao_d_mais_5'
  | 'cobranca_negociacao_d_mais_10';

export type CadenceCategory = 'vendas' | 'cobranca';

export interface CadenceStepRule {
  step_id: string;
  category: CadenceCategory;
  day_label: string;
  day_offset: number;
  title: string;
  icon: string;
  template_id: FollowUpTemplateId;
  message_template: string;
  enabled: boolean;
}

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

export const DEFAULT_CADENCE_RULES: CadenceStepRule[] = [
  // Régua de Campanhas de Venda & Follow-up Comercial
  {
    step_id: 'vendas_d1_qualificacao',
    category: 'vendas',
    day_label: 'D+1',
    day_offset: 1,
    title: 'Retomada de Qualificação (24h)',
    icon: '👋',
    template_id: 'followup_primeiro_contato',
    message_template:
      'Olá {{nome}}, tudo bem? Sou da BGR Benefícios ({{numero_agente}}). Vi que você iniciou o atendimento para proteger seu veículo. Posso concluir sua simulação agora?',
    enabled: true,
  },
  {
    step_id: 'vendas_d2_cotacao',
    category: 'vendas',
    day_label: 'D+2',
    day_offset: 2,
    title: 'Follow-up de Cotação Oficial (48h)',
    icon: '📋',
    template_id: 'followup_cotacao_enviada',
    message_template:
      'Olá {{nome}}! Sua cotação oficial BGR Benefícios continua reservada ({{numero_agente}}). Ficou alguma dúvida sobre cobertura de Roubo, Furto, Colisão e Assistência 24h?',
    enabled: true,
  },
  {
    step_id: 'vendas_d5_objecao',
    category: 'vendas',
    day_label: 'D+5',
    day_offset: 5,
    title: 'Destravamento de Objeção & Valor',
    icon: '🛡️',
    template_id: 'followup_negociacao',
    message_template:
      'Olá {{nome}}, passando para lembrar que na BGR Benefícios você conta com cobertura nacional e excelente custo-benefício sem perfil de condutor. Vamos ativar sua proposta hoje?',
    enabled: true,
  },
  {
    step_id: 'vendas_d7_assinatura',
    category: 'vendas',
    day_label: 'D+7',
    day_offset: 7,
    title: 'Lembrete de Assinatura Digital Pendente',
    icon: '✍️',
    template_id: 'followup_aguardando_assinatura',
    message_template:
      'Olá {{nome}}! Falta apenas concluir a assinatura digital do seu termo de adesão BGR ({{numero_agente}}) para liberarmos a vistoria do seu veículo.',
    enabled: true,
  },
  {
    step_id: 'vendas_d15_reativacao',
    category: 'vendas',
    day_label: 'D+15',
    day_offset: 15,
    title: 'Campanha de Reativação Comercial',
    icon: '🚀',
    template_id: 'bgr_reativacao',
    message_template:
      'Olá {{nome}}, temos condições atualizadas nos planos BGR Essencial, Plus e Total para o seu veículo! Responda SIM para atualizar sua cotação.',
    enabled: true,
  },

  // Régua de Cobranças em Modo Geral
  {
    step_id: 'cobranca_dm3_preventivo',
    category: 'cobranca',
    day_label: 'D-3',
    day_offset: -3,
    title: 'Lembrete Preventivo de Vencimento',
    icon: '🔔',
    template_id: 'cobranca_lembrete_d_menos_3',
    message_template:
      'Olá {{nome}}! Lembrete amigável da BGR Benefícios ({{numero_agente}}): sua mensalidade vence em 3 dias. O boleto e o código PIX oficial já estão disponíveis.',
    enabled: true,
  },
  {
    step_id: 'cobranca_d0_vencimento',
    category: 'cobranca',
    day_label: 'D0',
    day_offset: 0,
    title: 'Aviso de Vencimento Hoje + PIX / 2ª Via',
    icon: '💳',
    template_id: 'cobranca_vencimento_hoje_d0',
    message_template:
      'Olá {{nome}}, sua contribuição mensal BGR Benefícios vence hoje! Utilize o código PIX oficial ou solicite a 2ª via por aqui ({{numero_agente}}) para manter seus benefícios em dia.',
    enabled: true,
  },
  {
    step_id: 'cobranca_dp2_atraso_amigavel',
    category: 'cobranca',
    day_label: 'D+2',
    day_offset: 2,
    title: 'Aviso Amigável de Pendência (48h)',
    icon: '⚠️',
    template_id: 'cobranca_aviso_atraso_d_mais_2',
    message_template:
      'Olá {{nome}}, ainda não identificamos a compensação da sua mensalidade BGR vencida há 2 dias. Caso já tenha pago, desconsidere; se precisar de 2ª via atualizada, responda 2VIA.',
    enabled: true,
  },
  {
    step_id: 'cobranca_dp5_regularizacao',
    category: 'cobranca',
    day_label: 'D+5',
    day_offset: 5,
    title: 'Alerta de Regularização de Cobertura',
    icon: '🚨',
    template_id: 'cobranca_regularizacao_d_mais_5',
    message_template:
      'Importante {{nome}}: identificamos pendência de 5 dias na sua mensalidade BGR Benefícios ({{numero_agente}}). Regularize via PIX oficial hoje para evitar suspensão da proteção veicular.',
    enabled: true,
  },
  {
    step_id: 'cobranca_dp10_negociacao',
    category: 'cobranca',
    day_label: 'D+10',
    day_offset: 10,
    title: 'Recuperação & Negociação Financeira',
    icon: '🤝',
    template_id: 'cobranca_negociacao_d_mais_10',
    message_template:
      'Olá {{nome}}, queremos ajudar você a manter seu veículo protegido na BGR Benefícios! Fale com nosso setor financeiro ({{numero_agente}}) para regularização assistida.',
    enabled: true,
  },
];

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
  private cadenceRules: CadenceStepRule[] = DEFAULT_CADENCE_RULES.map((r) => ({ ...r }));

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

  getCadenceRules(category?: CadenceCategory): CadenceStepRule[] {
    const list = category
      ? this.cadenceRules.filter((r) => r.category === category)
      : this.cadenceRules;
    return list.map((r) => ({ ...r }));
  }

  updateCadenceStep(params: {
    step_id: string;
    enabled?: boolean;
    day_label?: string;
    day_offset?: number;
    title?: string;
    message_template?: string;
  }): CadenceStepRule | null {
    const target = this.cadenceRules.find((r) => r.step_id === params.step_id);
    if (!target) return null;
    if (typeof params.enabled === 'boolean') target.enabled = params.enabled;
    if (typeof params.day_label === 'string' && params.day_label.trim()) {
      target.day_label = params.day_label.trim();
    }
    if (typeof params.day_offset === 'number' && !Number.isNaN(params.day_offset)) {
      target.day_offset = params.day_offset;
    }
    if (typeof params.title === 'string' && params.title.trim()) {
      target.title = params.title.trim();
    }
    if (typeof params.message_template === 'string' && params.message_template.trim()) {
      target.message_template = params.message_template.trim();
    }
    return { ...target };
  }

  addCadenceStep(params: {
    category: CadenceCategory;
    day_label: string;
    day_offset: number;
    title: string;
    icon?: string;
    message_template: string;
  }): CadenceStepRule {
    const templateId: FollowUpTemplateId =
      params.category === 'cobranca' ? 'cobranca_vencimento_hoje_d0' : 'followup_negociacao';
    const newRule: CadenceStepRule = {
      step_id: `${params.category}_custom_${Date.now()}`,
      category: params.category,
      day_label: params.day_label.trim() || 'D+1',
      day_offset: Number.isNaN(params.day_offset) ? 1 : params.day_offset,
      title: params.title.trim() || 'Nova Etapa Personalizada',
      icon: params.icon?.trim() || (params.category === 'cobranca' ? '💳' : '💬'),
      template_id: templateId,
      message_template: params.message_template.trim(),
      enabled: true,
    };
    this.cadenceRules.push(newRule);
    return { ...newRule };
  }

  evaluateCadenceStepDispatch(params: {
    step_id: string;
    contact: FollowUpCandidateInput;
    agent_phone: string;
  }): CampaignEligibilityResult & { rendered_message: string | null; step_rule: CadenceStepRule | null } {
    const rule = this.cadenceRules.find((r) => r.step_id === params.step_id) ?? null;
    if (!rule || !rule.enabled) {
      const dummyIdem = `idem_disabled_${params.step_id}_${params.contact.contact_id}`;
      const res = this.buildResult({
        input: params.contact,
        eligibility: false,
        templateId: null,
        deliveryStatus: 'blocked_cadence_limit',
        idempotencyKey: dummyIdem,
        reason: `Etapa da régua '${params.step_id}' está desativada ou não existe.`,
        severity: 'LOW',
      });
      return { ...res, rendered_message: null, step_rule: rule };
    }

    const evalRes = this.evaluateCandidate(
      {
        ...params.contact,
        campaign_id: `regua_${rule.category}_${rule.step_id}`,
      },
      'campanha_reativacao'
    );

    if (!evalRes.eligibility) {
      return { ...evalRes, rendered_message: null, step_rule: rule };
    }

    const rendered = rule.message_template
      .replace(/\{\{nome\}\}/g, params.contact.name)
      .replace(/\{\{numero_agente\}\}/g, params.agent_phone);

    return {
      ...evalRes,
      template_id: rule.template_id,
      rendered_message: rendered,
      step_rule: rule,
    };
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
