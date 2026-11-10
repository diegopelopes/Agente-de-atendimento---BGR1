/**
 * BGR Benefícios — Serviço de Canal WhatsApp Business Platform (Cloud API v18.0) (Fase 5)
 *
 * Implementa os requisitos da Seção 4, 5, 8 e 11 (T23, T24, T25, T26, T31, T32):
 * - Isolamento de sessão por contato (session_id determinístico e isolado)
 * - Deduplicação de eventos Webhook por message_id (wamid)
 * - Detecção imediata de comando de Opt-Out (PARAR / SAIR / DESCADASTRAR) com revogação de Consent
 * - Validação da janela de 24 horas da Meta (texto livre permitido somente dentro de 24h;
 *   fora da janela exige Template oficialmente aprovado)
 * - Integração com a trava de concorrência do HandoffService (IA vs. Humano)
 */

import crypto from 'node:crypto';
import type { AuditEvent, Consent } from '../../domain/contracts.ts';
import { sanitizeForAudit } from '../../observability/sanitizer.ts';
import { HandoffService } from '../../services/handoff-service.ts';

export type ApprovedWhatsAppTemplateName =
  | 'bgr_saudacao'
  | 'bgr_cotacao_pronta'
  | 'bgr_followup'
  | 'bgr_reativacao';

const APPROVED_TEMPLATES = new Set<string>([
  'bgr_saudacao',
  'bgr_cotacao_pronta',
  'bgr_followup',
  'bgr_reativacao',
]);

const OPT_OUT_KEYWORDS = new Set<string>([
  'parar',
  'sair',
  'descadastrar',
  'cancelar recebimento',
  'nao quero mais',
  'não quero mais',
  'stop',
]);

export interface WhatsAppInboundWebhookItem {
  message_id: string; // ex: wamid.HBgM...
  from_phone: string; // ex: 5511999990001
  profile_name?: string;
  text_body: string;
  received_at_iso: string;
}

export interface InboundProcessingDecision {
  session_id: string;
  duplicate_ignored: boolean;
  opt_out_processed: boolean;
  allow_ai_agent: boolean;
  routed_to_human_queue: string | null;
  immediate_reply_text: string | null;
  consent_state: Consent;
  audit_event: AuditEvent;
}

export interface OutboundSendRequest {
  session_id: string;
  to_phone: string;
  message_type: 'text' | 'template';
  text_body?: string;
  template_name?: string;
  template_params?: string[];
  now_iso?: string;
}

export interface OutboundSendDecision {
  allowed: boolean;
  blocked_reason:
    | null
    | 'OPT_OUT_ACTIVE'
    | 'OUTSIDE_24H_WINDOW_REQUIRES_TEMPLATE'
    | 'UNAPPROVED_TEMPLATE'
    | 'EMPTY_MESSAGE';
  within_24h_window: boolean;
  meta_api_payload: Record<string, unknown> | null;
  audit_event: AuditEvent;
}

export class WhatsAppChannelService {
  private readonly processedMessageIds = new Set<string>();
  private readonly lastInboundTimestampBySession = new Map<string, number>();
  private readonly consentsBySession = new Map<string, Consent>();
  private readonly handoffService: HandoffService;
  private readonly environment: 'teste' | 'homologacao' | 'producao';
  private readonly companyId: string;

  constructor(
    handoffService: HandoffService,
    options?: { environment?: 'teste' | 'homologacao' | 'producao'; companyId?: string }
  ) {
    this.handoffService = handoffService;
    this.environment = options?.environment ?? 'teste';
    this.companyId = options?.companyId ?? 'bgr_beneficios';
  }

  /**
   * Gera um session_id determinístico e isolado para cada telefone no canal WhatsApp.
   */
  static buildSessionIdForPhone(phone: string): string {
    const clean = phone.replace(/\D/g, '');
    const normalized = clean.startsWith('55') ? clean : `55${clean}`;
    const hash = crypto.createHash('sha256').update(`wa_session|${normalized}`, 'utf8').digest('hex').slice(0, 16);
    return `wa_sess_${hash}`;
  }

  /**
   * Processa uma mensagem recebida no Webhook do WhatsApp (T23, T31, T32 + Trava Humana):
   * 1. Ignora wamid duplicado (idempotência de Webhook)
   * 2. Registra abertura/renovação da janela de 24h de atendimento
   * 3. Verifica comando imediato de Opt-Out (LGPD / Meta compliance)
   * 4. Verifica trava de concorrência (ia_ativa vs aguardando_humano vs humano_ativo)
   */
  processInboundWebhook(item: WhatsAppInboundWebhookItem): InboundProcessingDecision {
    const sessionId = WhatsAppChannelService.buildSessionIdForPhone(item.from_phone);
    const receivedMs = Date.parse(item.received_at_iso) || Date.now();
    const receivedIso = new Date(receivedMs).toISOString();

    const consent = this.getOrCreateConsent(sessionId, item.from_phone, receivedIso);

    // 1. Deduplicação de evento por message_id (wamid)
    if (this.processedMessageIds.has(item.message_id)) {
      return {
        session_id: sessionId,
        duplicate_ignored: true,
        opt_out_processed: false,
        allow_ai_agent: false,
        routed_to_human_queue: null,
        immediate_reply_text: null,
        consent_state: { ...consent },
        audit_event: this.buildAudit({
          eventId: `evt_wa_dup_${item.message_id}`,
          sessionId,
          eventType: 'whatsapp_inbound_duplicate_ignored',
          severity: 'LOW',
          status: 'sucesso',
          rawSummary: `Mensagem WhatsApp duplicada ignorada (${item.message_id}) para ${item.from_phone}.`,
        }),
      };
    }

    this.processedMessageIds.add(item.message_id);
    this.lastInboundTimestampBySession.set(sessionId, receivedMs);

    // 2. Verifica comando de Opt-Out / Descadastro imediato (T31)
    const normalizedText = item.text_body.trim().toLowerCase();
    if (OPT_OUT_KEYWORDS.has(normalizedText)) {
      consent.opt_in_status = 'revoked';
      consent.opt_out_requested = true;
      consent.updated_at = receivedIso;

      return {
        session_id: sessionId,
        duplicate_ignored: false,
        opt_out_processed: true,
        allow_ai_agent: false,
        routed_to_human_queue: null,
        immediate_reply_text:
          'Seu descadastro foi realizado com sucesso! Você não receberá mais mensagens de campanhas ou lembretes comerciais da BGR Benefícios. Caso precise de atendimento no futuro, basta nos enviar uma mensagem.',
        consent_state: { ...consent },
        audit_event: this.buildAudit({
          eventId: `evt_wa_optout_${item.message_id}`,
          sessionId,
          eventType: 'whatsapp_opt_out_confirmed',
          severity: 'HIGH',
          status: 'sucesso',
          rawSummary: `Opt-out solicitado e processado imediatamente para ${item.from_phone}.`,
        }),
      };
    }

    // Se o cliente iniciou conversa espontânea (e não pediu opt-out), registra consentimento de execução/atendimento
    if (!consent.opt_out_requested && consent.opt_in_status === 'unknown') {
      consent.opt_in_status = 'granted';
      consent.legal_basis = 'execucao_contrato';
      consent.consent_source = 'inbound_whatsapp';
      consent.updated_at = receivedIso;
    }

    // 3. Verifica trava de concorrência IA vs. Humano no HandoffService
    const gate = this.handoffService.evaluateIncomingMessageGate(sessionId, 'whatsapp_oficial');

    if (!gate.allow_ai_processing) {
      return {
        session_id: sessionId,
        duplicate_ignored: false,
        opt_out_processed: false,
        allow_ai_agent: false,
        routed_to_human_queue: gate.routed_to_human_queue,
        immediate_reply_text: gate.auto_reply_message,
        consent_state: { ...consent },
        audit_event: this.buildAudit({
          eventId: `evt_wa_routed_human_${item.message_id}`,
          sessionId,
          eventType: `whatsapp_inbound_routed_${gate.attendance_mode}`,
          severity: 'LOW',
          status: 'sucesso',
          rawSummary: `Mensagem recebida com modo '${gate.attendance_mode}' roteada para fila '${gate.routed_to_human_queue}'. IA silenciada.`,
        }),
      };
    }

    return {
      session_id: sessionId,
      duplicate_ignored: false,
      opt_out_processed: false,
      allow_ai_agent: true,
      routed_to_human_queue: null,
      immediate_reply_text: null,
      consent_state: { ...consent },
      audit_event: this.buildAudit({
        eventId: `evt_wa_in_${item.message_id}`,
        sessionId,
        eventType: 'whatsapp_inbound_accepted_for_ai',
        severity: 'LOW',
        status: 'sucesso',
        rawSummary: `Mensagem WhatsApp ${item.message_id} recebida de ${item.from_phone} e encaminhada ao Agente IA.`,
      }),
    };
  }

  /**
   * Valida e prepara o payload de envio para a API Oficial do WhatsApp (T24, T25, T26):
   * - Bloqueia envio proativo se o contato estiver em opt-out
   * - Permite mensagem de texto livre SOMENTE se houver mensagem do cliente nas últimas 24 horas (T25)
   * - Fora da janela de 24h, exige template oficial aprovado pela Meta (T26)
   */
  prepareOutboundMessage(req: OutboundSendRequest): OutboundSendDecision {
    const nowMs = req.now_iso ? Date.parse(req.now_iso) : Date.now();
    const consent = this.consentsBySession.get(req.session_id);

    if (consent?.opt_out_requested) {
      return {
        allowed: false,
        blocked_reason: 'OPT_OUT_ACTIVE',
        within_24h_window: false,
        meta_api_payload: null,
        audit_event: this.buildAudit({
          eventId: `evt_wa_out_blk_optout_${Date.now()}`,
          sessionId: req.session_id,
          eventType: 'whatsapp_outbound_blocked_opt_out',
          severity: 'HIGH',
          status: 'bloqueado',
          rawSummary: `Bloqueado envio de mensagem para ${req.to_phone} pois o contato possui opt-out ativo.`,
        }),
      };
    }

    const lastInboundMs = this.lastInboundTimestampBySession.get(req.session_id);
    const windowMs = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
    const within24h = typeof lastInboundMs === 'number' && nowMs - lastInboundMs >= 0 && nowMs - lastInboundMs <= windowMs;

    const cleanTo = req.to_phone.replace(/\D/g, '');

    if (req.message_type === 'text') {
      if (!within24h) {
        return {
          allowed: false,
          blocked_reason: 'OUTSIDE_24H_WINDOW_REQUIRES_TEMPLATE',
          within_24h_window: false,
          meta_api_payload: null,
          audit_event: this.buildAudit({
            eventId: `evt_wa_out_blk_24h_${Date.now()}`,
            sessionId: req.session_id,
            eventType: 'whatsapp_outbound_blocked_outside_24h_window',
            severity: 'MEDIUM',
            status: 'bloqueado',
            rawSummary: `Bloqueado envio de texto livre fora da janela de 24h na sessão ${req.session_id}. Exige template aprovado.`,
          }),
        };
      }

      if (!req.text_body || req.text_body.trim().length === 0) {
        return {
          allowed: false,
          blocked_reason: 'EMPTY_MESSAGE',
          within_24h_window: true,
          meta_api_payload: null,
          audit_event: this.buildAudit({
            eventId: `evt_wa_out_empty_${Date.now()}`,
            sessionId: req.session_id,
            eventType: 'whatsapp_outbound_blocked_empty',
            severity: 'LOW',
            status: 'erro',
            rawSummary: `Tentativa de enviar mensagem vazia na sessão ${req.session_id}.`,
          }),
        };
      }

      return {
        allowed: true,
        blocked_reason: null,
        within_24h_window: true,
        meta_api_payload: {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanTo,
          type: 'text',
          text: {
            preview_url: false,
            body: req.text_body,
          },
        },
        audit_event: this.buildAudit({
          eventId: `evt_wa_out_txt_${Date.now()}`,
          sessionId: req.session_id,
          eventType: 'whatsapp_outbound_text_prepared',
          severity: 'LOW',
          status: 'sucesso',
          rawSummary: `Mensagem de resposta preparada dentro da janela de 24h para ${req.to_phone}.`,
        }),
      };
    }

    // Envio de Template (T26)
    const tplName = (req.template_name ?? '').trim();
    if (!APPROVED_TEMPLATES.has(tplName)) {
      return {
        allowed: false,
        blocked_reason: 'UNAPPROVED_TEMPLATE',
        within_24h_window: within24h,
        meta_api_payload: null,
        audit_event: this.buildAudit({
          eventId: `evt_wa_out_blk_tpl_${Date.now()}`,
          sessionId: req.session_id,
          eventType: 'whatsapp_outbound_blocked_unapproved_template',
          severity: 'HIGH',
          status: 'bloqueado',
          rawSummary: `Bloqueado envio de template não homologado '${tplName}' na sessão ${req.session_id}.`,
        }),
      };
    }

    const parameters = (req.template_params ?? []).map((text) => ({
      type: 'text',
      text,
    }));

    return {
      allowed: true,
      blocked_reason: null,
      within_24h_window: within24h,
      meta_api_payload: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo,
        type: 'template',
        template: {
          name: tplName,
          language: { code: 'pt_BR' },
          components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
        },
      },
      audit_event: this.buildAudit({
        eventId: `evt_wa_out_tpl_${Date.now()}`,
        sessionId: req.session_id,
        eventType: 'whatsapp_outbound_template_prepared',
        severity: 'LOW',
        status: 'sucesso',
        rawSummary: `Template aprovado '${tplName}' preparado para envio a ${req.to_phone}.`,
      }),
    };
  }

  private getOrCreateConsent(sessionId: string, phone: string, nowIso: string): Consent {
    const existing = this.consentsBySession.get(sessionId);
    if (existing) {
      return existing;
    }

    const phoneHash = crypto.createHash('sha256').update(phone.replace(/\D/g, ''), 'utf8').digest('hex');
    const created: Consent = {
      contact_id: `cnt_${sessionId}`,
      phone_hash: `sha256_${phoneHash.slice(0, 24)}`,
      opt_in_status: 'unknown',
      legal_basis: 'nenhuma',
      opt_out_requested: false,
      consent_source: null,
      updated_at: nowIso,
    };
    this.consentsBySession.set(sessionId, created);
    return created;
  }

  private buildAudit(params: {
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
