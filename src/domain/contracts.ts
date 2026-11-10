/**
 * BGR Benefícios — Contratos Tipados e Validação de Domínio (Fase 1)
 * Compatível com TypeScript / Node.js e nós de código do n8n.
 */

export type FunnelStage =
  | 'novo_lead'
  | 'contato_iniciado'
  | 'qualificacao'
  | 'cotacao_preparada'
  | 'cotacao_enviada'
  | 'cliente_interessado'
  | 'cliente_indeciso'
  | 'aguardando_assinatura'
  | 'aguardando_pagamento'
  | 'contratacao_confirmada'
  | 'oportunidade_perdida'
  | 'atendimento_humano';

export type AttendanceMode = 'ia_ativa' | 'aguardando_humano' | 'humano_ativo';

export type VehicleUsage = 'particular' | 'aplicativo' | 'comercial' | 'taxi';

export interface Lead {
  id: string;
  external_crm_id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  document_masked?: string | null;
  city_uf?: string | null;
  origin: 'chat_teste' | 'whatsapp_ia' | 'campanha_reativacao' | 'organico';
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  brand: string;
  model: string;
  year: number;
  usage: VehicleUsage;
  plate_masked?: string | null;
  fipe_code?: string | null;
  is_auction?: boolean;
  is_modified?: boolean;
}

export interface QuoteRequest {
  idempotency_key: string;
  correlation_id: string;
  session_id: string;
  lead: Lead;
  vehicle: Vehicle;
  requested_at: string;
}

export interface QuotePlanOption {
  plan_id: string;
  plan_name: string;
  monthly_fee_brl: number;
  enrollment_fee_brl: number;
  deductible_description: string;
  coverages: string[];
}

export interface QuoteResult {
  quote_id: string;
  quotation_code: string;
  correlation_id: string;
  status: 'oficial_calculada' | 'pendente_analise_humana' | 'inelegivel' | 'nao_encontrada' | 'erro_integracao';
  source: 'powercrm_oficial' | 'mock_homologacao';
  plans: QuotePlanOption[];
  valid_until: string;
  fetched_at: string;
}

export interface Conversation {
  session_id: string;
  channel: 'chat_teste' | 'whatsapp_oficial';
  attendance_mode: AttendanceMode;
  current_stage: FunnelStage;
  started_at: string;
  last_interaction_at: string;
}

export interface Consent {
  contact_id: string;
  phone_hash: string;
  opt_in_status: 'granted' | 'revoked' | 'unknown';
  legal_basis: 'execucao_contrato' | 'consentimento_explicito' | 'legitimo_interesse' | 'nenhuma';
  opt_out_requested: boolean;
  consent_source?: string | null;
  updated_at: string;
}

export interface Opportunity {
  opportunity_id: string;
  lead_id: string;
  quote_id: string;
  stage:
    | 'cotacao_enviada'
    | 'aguardando_assinatura'
    | 'aguardando_pagamento'
    | 'aguardando_vistoria'
    | 'contratacao_confirmada'
    | 'oportunidade_perdida';
  signature_verified: boolean;
  payment_verified: boolean;
  inspection_verified: boolean;
  activation_confirmed: boolean;
  updated_at: string;
}

export interface Handoff {
  ticket_id: string;
  idempotency_key: string;
  session_id: string;
  target_queue: 'comercial' | 'suporte' | 'sinistros' | 'financeiro' | 'retencao' | 'ouvidoria';
  priority: 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
  reason: string;
  conversation_summary: string;
  acknowledgment_status: 'aguardando_confirmacao' | 'confirmado' | 'falha';
  created_at: string;
}

export interface PaymentStatus {
  payment_id: string;
  opportunity_id: string;
  status:
    | 'nao_iniciado'
    | 'aguardando_pagamento'
    | 'comprovante_enviado_nao_validado'
    | 'confirmado_oficial'
    | 'vencido'
    | 'estornado';
  verified_by_system: boolean;
  updated_at: string;
}

export interface AuditEvent {
  event_id: string;
  idempotency_key: string;
  correlation_id: string;
  timestamp: string;
  environment: 'teste' | 'homologacao' | 'producao';
  company_id: string;
  session_id: string;
  event_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'sucesso' | 'pendente' | 'erro' | 'bloqueado';
  http_code?: number | null;
  safe_summary: string;
}

export interface QualificationCheckResult {
  ready_for_quote: boolean;
  missing_fields: string[];
  requires_human_review: boolean;
  human_review_reason?: string;
}

/**
 * Verifica quais campos obrigatórios ainda faltam antes de consultar ou criar cotação no Power CRM.
 */
export function evaluateQualification(
  lead?: Partial<Lead>,
  vehicle?: Partial<Vehicle>
): QualificationCheckResult {
  const missing: string[] = [];

  if (!lead?.name || lead.name.trim().length < 2) missing.push('lead.name');
  if (!lead?.phone || !/^\+?[0-9]{10,15}$/.test(lead.phone.replace(/\D/g, ''))) missing.push('lead.phone');
  if (!lead?.city_uf || lead.city_uf.trim().length < 2) missing.push('lead.city_uf');

  if (!vehicle?.brand || vehicle.brand.trim().length < 2) missing.push('vehicle.brand');
  if (!vehicle?.model || vehicle.model.trim().length < 1) missing.push('vehicle.model');
  if (!vehicle?.year || vehicle.year < 1980 || vehicle.year > 2028) missing.push('vehicle.year');
  if (!vehicle?.usage) missing.push('vehicle.usage');

  const requiresHuman = Boolean(vehicle?.is_auction || vehicle?.is_modified);
  const reason = vehicle?.is_auction
    ? 'Veículo oriundo de leilão exige análise de elegibilidade pela equipe comercial/vistoria.'
    : vehicle?.is_modified
      ? 'Veículo modificado exige avaliação especial de vistoria.'
      : undefined;

  return {
    ready_for_quote: missing.length === 0,
    missing_fields: missing,
    requires_human_review: requiresHuman,
    human_review_reason: reason,
  };
}

/**
 * Invariante Crítica da Máquina de Estados (Seção 3 e 4 do Documento Operacional):
 * A IA NUNCA pode inferir ativação a partir de intenção, assinatura isolada ou comprovante não validado.
 */
export function validateOpportunityTransition(opp: Opportunity, payment?: PaymentStatus): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (opp.stage === 'contratacao_confirmada' || opp.activation_confirmed) {
    if (!opp.signature_verified) {
      errors.push('BLOQUEIO: Contratação não pode ser confirmada sem assinatura digital verificada.');
    }
    if (!opp.payment_verified) {
      errors.push('BLOQUEIO: Contratação não pode ser confirmada sem pagamento confirmado oficialmente.');
    }
    if (payment && (payment.status !== 'confirmado_oficial' || !payment.verified_by_system)) {
      errors.push(
        `BLOQUEIO: Status de pagamento '${payment.status}' não permite ativar a proteção (comprovante isolado não ativa).`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Valida elegibilidade de contato para campanha ativa ou follow-up (LGPD + WhatsApp Opt-out).
 */
export function isEligibleForCampaign(consent: Consent): {
  eligible: boolean;
  reason: string;
} {
  if (consent.opt_out_requested) {
    return { eligible: false, reason: 'Contato solicitou descadastro (opt-out ativo).' };
  }
  if (consent.opt_in_status !== 'granted') {
    return { eligible: false, reason: `Status de consentimento '${consent.opt_in_status}' não permite disparo.` };
  }
  if (consent.legal_basis === 'nenhuma') {
    return { eligible: false, reason: 'Ausência de base legal LGPD registrada.' };
  }
  return { eligible: true, reason: 'Elegível com consentimento e sem opt-out.' };
}
