/**
 * BGR Benefícios — Serviço de Ciclo de Vida de Proposta, Assinatura, Pagamento e Efetivação (Fase 4)
 *
 * Implementa a Máquina de Estados Comercial Obrigatória (Seções 3, 4, 5 e 8):
 * - Fluxo: cotacao_enviada -> aguardando_assinatura -> aguardando_pagamento -> aguardando_vistoria -> contratacao_confirmada
 * - Invariante Inegociável: A IA NUNCA pode inferir ativação a partir de intenção do cliente,
 *   assinatura isolada ou envio de comprovante não validado pelo sistema oficial (T27, T28, T29).
 * - Idempotência de Webhooks: Ignora eventos repetidos com o mesmo event_id (X-PowerCRM-Event-Id).
 */

import {
  validateOpportunityTransition,
  type AuditEvent,
  type Opportunity,
  type PaymentStatus,
  type QuoteResult,
} from '../domain/contracts.ts';
import { sanitizeForAudit } from '../observability/sanitizer.ts';

export type PowerCrmWebhookEventType =
  | 'proposal.created'
  | 'proposal.signed'
  | 'payment.confirmed'
  | 'inspection.approved'
  | 'member.activated'
  | 'opportunity.lost';

export interface OfficialCrmWebhookPayload {
  event_id: string;
  event_type: PowerCrmWebhookEventType;
  opportunity_id: string;
  session_id: string;
  occurred_at: string;
  metadata?: {
    proposal_url?: string;
    payment_id?: string;
    loss_reason?: string;
  };
}

export type ProposedNextAction =
  | 'enviar_link_assinatura'
  | 'orientar_pagamento_e_vistoria'
  | 'aguardar_compensacao_oficial'
  | 'confirmar_protecao_ativa_pos_venda'
  | 'encaminhar_contingencia_humana'
  | 'encerrar_oportunidade_perdida';

export interface ProposalStageOutput {
  opportunity: Opportunity;
  payment_status: PaymentStatus;
  stage: Opportunity['stage'];
  proposed_next_action: ProposedNextAction;
  event_id: string;
  duplicate_ignored: boolean;
  protection_active_declared: boolean;
  customer_message: string;
  audit_event: AuditEvent;
}

export class ProposalLifecycleService {
  private readonly opportunities = new Map<string, Opportunity>();
  private readonly payments = new Map<string, PaymentStatus>();
  private readonly processedWebhookEvents = new Set<string>();
  private readonly environment: 'teste' | 'homologacao' | 'producao';
  private readonly companyId: string;

  constructor(options?: { environment?: 'teste' | 'homologacao' | 'producao'; companyId?: string }) {
    this.environment = options?.environment ?? 'teste';
    this.companyId = options?.companyId ?? 'bgr_beneficios';
  }

  /**
   * Inicia uma oportunidade vinculada a uma cotação oficial quando o cliente escolhe um plano.
   */
  createOpportunityFromQuote(params: {
    opportunityId: string;
    leadId: string;
    quote: QuoteResult;
    selectedPlanId: string;
    sessionId: string;
  }): ProposalStageOutput {
    const { opportunityId, leadId, quote, selectedPlanId, sessionId } = params;
    const planExists = quote.plans.some((p) => p.plan_id === selectedPlanId);

    if (!planExists) {
      throw new Error(`Plano '${selectedPlanId}' não consta na cotação oficial '${quote.quotation_code}'.`);
    }

    const nowIso = new Date().toISOString();
    const opp: Opportunity = {
      opportunity_id: opportunityId,
      lead_id: leadId,
      quote_id: quote.quote_id,
      stage: 'aguardando_assinatura',
      signature_verified: false,
      payment_verified: false,
      inspection_verified: false,
      activation_confirmed: false,
      updated_at: nowIso,
    };

    const pay: PaymentStatus = {
      payment_id: `pay_${opportunityId}`,
      opportunity_id: opportunityId,
      status: 'nao_iniciado',
      verified_by_system: false,
      updated_at: nowIso,
    };

    this.opportunities.set(opportunityId, opp);
    this.payments.set(opportunityId, pay);

    const eventId = `evt_init_${opportunityId}`;
    return {
      opportunity: { ...opp },
      payment_status: { ...pay },
      stage: opp.stage,
      proposed_next_action: 'enviar_link_assinatura',
      event_id: eventId,
      duplicate_ignored: false,
      protection_active_declared: false,
      customer_message:
        'Excelente escolha! Sua proposta foi preparada e está com o status *Aguardando Assinatura Digital*. Assim que você assinar pelo link oficial e concluirmos a vistoria e o pagamento da adesão, o sistema confirmará a ativação da sua proteção.',
      audit_event: this.createAuditEvent({
        eventId,
        sessionId,
        eventType: 'opportunity_created_awaiting_signature',
        severity: 'MEDIUM',
        status: 'sucesso',
        rawSummary: `Oportunidade ${opportunityId} iniciada em aguardando_assinatura a partir da cotação ${quote.quotation_code}.`,
      }),
    };
  }

  /**
   * Trata alegações enviadas pelo cliente no chat ("já assinei", "segue o comprovante do PIX", "já estou protegido?")
   * SEM alterar flags oficiais de verificação e SEM declarar proteção ativa prematuramente (T27 / T28).
   */
  handleCustomerUnverifiedClaim(params: {
    opportunityId: string;
    sessionId: string;
    claimType: 'alega_assinatura_concluida' | 'enviou_comprovante_pagamento' | 'pergunta_se_esta_ativo';
  }): ProposalStageOutput {
    const { opportunityId, sessionId, claimType } = params;
    const opp = this.opportunities.get(opportunityId);
    const pay = this.payments.get(opportunityId);

    if (!opp || !pay) {
      throw new Error(`Oportunidade '${opportunityId}' não encontrada.`);
    }

    const nowIso = new Date().toISOString();
    const eventId = `evt_claim_${claimType}_${Date.now()}`;

    if (claimType === 'enviou_comprovante_pagamento' && !pay.verified_by_system) {
      pay.status = 'comprovante_enviado_nao_validado';
      pay.verified_by_system = false;
      pay.updated_at = nowIso;
    }

    // Verifica invariante: proteção ativa só pode ser declarada se activation_confirmed == true
    const isOfficiallyActive =
      opp.stage === 'contratacao_confirmada' &&
      opp.activation_confirmed &&
      opp.signature_verified &&
      opp.payment_verified;

    let message = '';
    let nextAction: ProposedNextAction = 'aguardar_compensacao_oficial';

    if (isOfficiallyActive) {
      message =
        'Confirmado! Consta em nosso sistema oficial que sua assinatura, vistoria e pagamento já foram validados e sua proteção veicular BGR está *oficialmente ativa*.';
      nextAction = 'confirmar_protecao_ativa_pos_venda';
    } else if (claimType === 'alega_assinatura_concluida' && !opp.signature_verified) {
      message =
        'Obrigado por avisar! No momento o sistema oficial ainda registra sua proposta como *Aguardando Confirmação da Assinatura Digital*. Assim que a plataforma de assinatura notificar nosso sistema, avançaremos para a etapa de pagamento e vistoria. Lembrando que a proteção ainda não está ativa nesta etapa.';
      nextAction = 'enviar_link_assinatura';
    } else if (claimType === 'enviou_comprovante_pagamento' && !opp.payment_verified) {
      message =
        'Recebemos o seu comprovante! Registrei o envio para conferência, porém *o comprovante no chat ainda não ativa a proteção automaticamente*. A cobertura somente entra em vigor após a compensação bancária e a confirmação oficial no sistema da BGR Benefícios.';
      nextAction = 'aguardar_compensacao_oficial';
    } else {
      message =
        `Consultei o status atual da sua proposta (*${opp.stage}*): ` +
        `Assinatura verificada: *${opp.signature_verified ? 'Sim' : 'Pendente'}* | ` +
        `Pagamento compensado: *${opp.payment_verified ? 'Sim' : 'Pendente'}* | ` +
        `Vistoria aprovada: *${opp.inspection_verified ? 'Sim' : 'Pendente'}*. ` +
        `Portanto, seu veículo *ainda não está com a proteção ativa*. Avisarei você assim que o sistema confirmar todas as etapas!`;
      nextAction = 'aguardar_compensacao_oficial';
    }

    return {
      opportunity: { ...opp },
      payment_status: { ...pay },
      stage: opp.stage,
      proposed_next_action: nextAction,
      event_id: eventId,
      duplicate_ignored: false,
      protection_active_declared: isOfficiallyActive,
      customer_message: message,
      audit_event: this.createAuditEvent({
        eventId,
        sessionId,
        eventType: `customer_unverified_claim_${claimType}`,
        severity: 'MEDIUM',
        status: 'pendente',
        rawSummary: `Cliente enviou alegação '${claimType}' na oportunidade ${opportunityId}. Status oficial mantido (${opp.stage}, ativo=${isOfficiallyActive}).`,
      }),
    };
  }

  /**
   * Processa eventos oficiais autenticados vindos do Power CRM (Webhooks V2).
   * Garante idempotência por event_id e impede ativação se assinatura ou pagamento não estiverem verificados.
   */
  processOfficialWebhookEvent(payload: OfficialCrmWebhookPayload): ProposalStageOutput {
    const { event_id: eventId, event_type: eventType, opportunity_id: opportunityId, session_id: sessionId } = payload;

    const opp = this.opportunities.get(opportunityId);
    const pay = this.payments.get(opportunityId);

    if (!opp || !pay) {
      throw new Error(`Oportunidade '${opportunityId}' não encontrada para processar evento '${eventType}'.`);
    }

    // Deduplicação de Webhook (Idempotência por X-PowerCRM-Event-Id)
    if (this.processedWebhookEvents.has(eventId)) {
      return {
        opportunity: { ...opp },
        payment_status: { ...pay },
        stage: opp.stage,
        proposed_next_action:
          opp.stage === 'contratacao_confirmada'
            ? 'confirmar_protecao_ativa_pos_venda'
            : 'aguardar_compensacao_oficial',
        event_id: eventId,
        duplicate_ignored: true,
        protection_active_declared: opp.activation_confirmed,
        customer_message: 'Evento já processado anteriormente.',
        audit_event: this.createAuditEvent({
          eventId,
          sessionId,
          eventType: `webhook_duplicate_ignored_${eventType}`,
          severity: 'LOW',
          status: 'sucesso',
          rawSummary: `Evento duplicado ${eventId} (${eventType}) ignorado por idempotência na oportunidade ${opportunityId}.`,
        }),
      };
    }

    const nowIso = payload.occurred_at || new Date().toISOString();

    switch (eventType) {
      case 'proposal.created': {
        opp.stage = 'aguardando_assinatura';
        opp.updated_at = nowIso;
        this.processedWebhookEvents.add(eventId);
        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'enviar_link_assinatura',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: false,
          customer_message:
            'Sua proposta oficial foi emitida no sistema da BGR! Envio o link oficial para conferência dos termos e assinatura digital. Lembre-se: a proteção passará a valer após assinatura, vistoria e confirmação do pagamento.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_proposal_created',
            severity: 'MEDIUM',
            status: 'sucesso',
            rawSummary: `Proposta oficial criada na oportunidade ${opportunityId}.`,
          }),
        };
      }

      case 'proposal.signed': {
        opp.signature_verified = true;
        opp.stage = opp.payment_verified ? 'aguardando_vistoria' : 'aguardando_pagamento';
        opp.updated_at = nowIso;
        if (pay.status === 'nao_iniciado') {
          pay.status = 'aguardando_pagamento';
          pay.updated_at = nowIso;
        }
        this.processedWebhookEvents.add(eventId);
        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'orientar_pagamento_e_vistoria',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: false,
          customer_message:
            'Recebemos a confirmação oficial da sua *Assinatura Digital*! O próximo passo para concluir sua adesão é a confirmação do pagamento e da vistoria. Importante: seu veículo ainda aguarda essa validação final para ficar com a proteção ativa.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_proposal_signed',
            severity: 'HIGH',
            status: 'sucesso',
            rawSummary: `Assinatura digital confirmada oficialmente para oportunidade ${opportunityId}. Avançou para ${opp.stage}.`,
          }),
        };
      }

      case 'payment.confirmed': {
        opp.payment_verified = true;
        opp.updated_at = nowIso;
        pay.status = 'confirmado_oficial';
        pay.verified_by_system = true;
        pay.updated_at = nowIso;
        if (opp.signature_verified && !opp.activation_confirmed) {
          opp.stage = 'aguardando_vistoria';
        }
        this.processedWebhookEvents.add(eventId);
        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'aguardar_compensacao_oficial',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: false,
          customer_message:
            'Seu pagamento foi *identificado e confirmado oficialmente* pelo sistema financeiro da BGR! Agora aguardamos apenas a liberação final de ativação do cadastro no sistema para confirmar o início da sua vigência.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_payment_confirmed',
            severity: 'HIGH',
            status: 'sucesso',
            rawSummary: `Pagamento confirmado oficialmente (${pay.payment_id}) na oportunidade ${opportunityId}.`,
          }),
        };
      }

      case 'inspection.approved': {
        opp.inspection_verified = true;
        opp.updated_at = nowIso;
        this.processedWebhookEvents.add(eventId);
        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'aguardar_compensacao_oficial',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: false,
          customer_message:
            'Sua vistoria prévia foi *aprovada* no sistema da BGR! Assim que todas as validações de contrato e pagamento estiverem concluídas com a ativação do cadastro, enviarei sua confirmação oficial.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_inspection_approved',
            severity: 'MEDIUM',
            status: 'sucesso',
            rawSummary: `Vistoria aprovada oficialmente na oportunidade ${opportunityId}.`,
          }),
        };
      }

      case 'member.activated': {
        const candidateOpp: Opportunity = {
          ...opp,
          stage: 'contratacao_confirmada',
          activation_confirmed: true,
          updated_at: nowIso,
        };

        const transitionCheck = validateOpportunityTransition(candidateOpp, pay);
        if (!transitionCheck.valid) {
          // Bloqueia ativação inconsistente e encaminha para auditoria humana!
          return {
            opportunity: { ...opp },
            payment_status: { ...pay },
            stage: opp.stage,
            proposed_next_action: 'encaminhar_contingencia_humana',
            event_id: eventId,
            duplicate_ignored: false,
            protection_active_declared: false,
            customer_message:
              'Recebemos uma atualização no seu cadastro que requer conferência final de um consultor da BGR antes da confirmação de vigência. Já acionei nossa equipe para concluir essa verificação com prioridade!',
            audit_event: this.createAuditEvent({
              eventId,
              sessionId,
              eventType: 'webhook_member_activated_blocked_inconsistent_state',
              severity: 'CRITICAL',
              status: 'bloqueado',
              rawSummary: `BLOQUEIO DE SEGURANÇA na oportunidade ${opportunityId}: tentativa de ativar sem pré-requisitos (${transitionCheck.errors.join(' | ')}).`,
            }),
          };
        }

        opp.stage = 'contratacao_confirmada';
        opp.activation_confirmed = true;
        opp.updated_at = nowIso;
        this.processedWebhookEvents.add(eventId);

        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'confirmar_protecao_ativa_pos_venda',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: true,
          customer_message:
            '🎉 *Parabéns! Sua proteção veicular na BGR Benefícios está OFICIALMENTE ATIVA!* ' +
            'Conferimos no sistema a confirmação da sua assinatura digital, vistoria e pagamento. ' +
            'Seja muito bem-vindo(a) como associado(a) BGR! Em instantes você receberá as informações de pós-venda e canais 24h.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_member_activated_confirmed',
            severity: 'CRITICAL',
            status: 'sucesso',
            rawSummary: `Contratação e ativação OFICIALMENTE CONFIRMADAS na oportunidade ${opportunityId}.`,
          }),
        };
      }

      case 'opportunity.lost': {
        opp.stage = 'oportunidade_perdida';
        opp.activation_confirmed = false;
        opp.updated_at = nowIso;
        this.processedWebhookEvents.add(eventId);
        return {
          opportunity: { ...opp },
          payment_status: { ...pay },
          stage: opp.stage,
          proposed_next_action: 'encerrar_oportunidade_perdida',
          event_id: eventId,
          duplicate_ignored: false,
          protection_active_declared: false,
          customer_message:
            'Agradecemos seu tempo e interesse na BGR Benefícios! Caso decida retomar a proteção do seu veículo no futuro, estaremos sempre à disposição.',
          audit_event: this.createAuditEvent({
            eventId,
            sessionId,
            eventType: 'webhook_opportunity_lost',
            severity: 'LOW',
            status: 'sucesso',
            rawSummary: `Oportunidade ${opportunityId} encerrada como perdida. Motivo: ${payload.metadata?.loss_reason ?? 'nao_informado'}.`,
          }),
        };
      }
    }
  }

  private createAuditEvent(params: {
    eventId: string;
    sessionId: string;
    eventType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    status: 'sucesso' | 'pendente' | 'erro' | 'bloqueado';
    rawSummary: string;
  }): AuditEvent {
    const sanitized = sanitizeForAudit(params.rawSummary);
    return {
      event_id: params.eventId,
      idempotency_key: `idem_${params.eventId}`,
      correlation_id: `corr_${params.eventId}`,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      company_id: this.companyId,
      session_id: params.sessionId,
      event_type: params.eventType,
      severity: params.severity,
      status: params.status,
      http_code: 200,
      safe_summary: sanitized.sanitized_text,
    };
  }
}
