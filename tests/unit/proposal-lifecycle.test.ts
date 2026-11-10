import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalLifecycleService } from '../../src/services/proposal-lifecycle-service.ts';
import type { QuoteResult } from '../../src/domain/contracts.ts';

const SAMPLE_QUOTE: QuoteResult = {
  quote_id: 'quo_10001',
  quotation_code: 'COT-10001',
  correlation_id: 'corr_10001',
  status: 'oficial_calculada',
  source: 'mock_homologacao',
  valid_until: '2026-11-30T23:59:59.000Z',
  fetched_at: '2026-11-10T12:00:00.000Z',
  plans: [
    {
      plan_id: 'bgr_essencial',
      plan_name: 'BGR Essencial',
      monthly_fee_brl: 149.9,
      enrollment_fee_brl: 250.0,
      deductible_description: '5% FIPE',
      coverages: ['Roubo', 'Furto', 'Colisão', 'Assistência 24h'],
    },
  ],
};

describe('Fase 4 — Ciclo de Vida de Proposta, Assinatura, Pagamento e Confirmação Oficial (T27/T28/T29)', () => {
  test('T27 (Assinatura Pendente): Alegação verbal do cliente no chat NÃO marca assinatura como verificada nem ativa proteção', () => {
    const lifecycle = new ProposalLifecycleService();

    const init = lifecycle.createOpportunityFromQuote({
      opportunityId: 'opp_t27',
      leadId: 'lead_001',
      quote: SAMPLE_QUOTE,
      selectedPlanId: 'bgr_essencial',
      sessionId: 'sess_t27',
    });

    assert.equal(init.stage, 'aguardando_assinatura');
    assert.equal(init.protection_active_declared, false);

    // Cliente diz no chat: "Já assinei a proposta!" antes do webhook oficial
    const claimRes = lifecycle.handleCustomerUnverifiedClaim({
      opportunityId: 'opp_t27',
      sessionId: 'sess_t27',
      claimType: 'alega_assinatura_concluida',
    });

    assert.equal(claimRes.opportunity.signature_verified, false);
    assert.equal(claimRes.opportunity.activation_confirmed, false);
    assert.equal(claimRes.protection_active_declared, false);
    assert.equal(claimRes.stage, 'aguardando_assinatura');
    assert.equal(
      claimRes.customer_message.includes('ainda não está ativa'),
      true,
      'Deve esclarecer que a proteção ainda não está ativa'
    );
  });

  test('T28 (Pagamento Não Confirmado / Comprovante no Chat): Assinatura isolada + comprovante enviado no chat NÃO ativam proteção', () => {
    const lifecycle = new ProposalLifecycleService();

    lifecycle.createOpportunityFromQuote({
      opportunityId: 'opp_t28',
      leadId: 'lead_001',
      quote: SAMPLE_QUOTE,
      selectedPlanId: 'bgr_essencial',
      sessionId: 'sess_t28',
    });

    // 1. Sistema confirma oficialmente a assinatura digital (proposal.signed)
    const signedRes = lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_evt_sign_001',
      event_type: 'proposal.signed',
      opportunity_id: 'opp_t28',
      session_id: 'sess_t28',
      occurred_at: '2026-11-10T13:00:00.000Z',
    });

    assert.equal(signedRes.opportunity.signature_verified, true);
    assert.equal(signedRes.stage, 'aguardando_pagamento');
    assert.equal(signedRes.protection_active_declared, false);

    // 2. Cliente envia comprovante de PIX pelo chat ("Já paguei, segue comprovante")
    const receiptRes = lifecycle.handleCustomerUnverifiedClaim({
      opportunityId: 'opp_t28',
      sessionId: 'sess_t28',
      claimType: 'enviou_comprovante_pagamento',
    });

    assert.equal(receiptRes.payment_status.status, 'comprovante_enviado_nao_validado');
    assert.equal(receiptRes.payment_status.verified_by_system, false);
    assert.equal(receiptRes.opportunity.payment_verified, false);
    assert.equal(receiptRes.opportunity.activation_confirmed, false);
    assert.equal(receiptRes.protection_active_declared, false);
    assert.equal(
      receiptRes.customer_message.includes('comprovante no chat ainda não ativa a proteção automaticamente'),
      true
    );
  });

  test('Bloqueio de Segurança: Se chegar webhook member.activated sem pagamento oficial confirmado, bloqueia ativação e aciona humano', () => {
    const lifecycle = new ProposalLifecycleService();

    lifecycle.createOpportunityFromQuote({
      opportunityId: 'opp_inconsistent',
      leadId: 'lead_001',
      quote: SAMPLE_QUOTE,
      selectedPlanId: 'bgr_essencial',
      sessionId: 'sess_inc',
    });

    // Apenas assinou, mas pagamento ainda não foi confirmado
    lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_evt_sign_inc',
      event_type: 'proposal.signed',
      opportunity_id: 'opp_inconsistent',
      session_id: 'sess_inc',
      occurred_at: '2026-11-10T13:05:00.000Z',
    });

    const blockedActivation = lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_evt_act_inc',
      event_type: 'member.activated',
      opportunity_id: 'opp_inconsistent',
      session_id: 'sess_inc',
      occurred_at: '2026-11-10T13:06:00.000Z',
    });

    assert.equal(blockedActivation.opportunity.activation_confirmed, false);
    assert.equal(blockedActivation.protection_active_declared, false);
    assert.equal(blockedActivation.proposed_next_action, 'encaminhar_contingencia_humana');
    assert.equal(blockedActivation.audit_event.status, 'bloqueado');
    assert.equal(blockedActivation.audit_event.severity, 'CRITICAL');
  });

  test('T29 (Confirmação Oficial Completa + Deduplicação de Webhook): Ativa somente após proposal.signed + payment.confirmed + inspection.approved + member.activated', () => {
    const lifecycle = new ProposalLifecycleService();

    lifecycle.createOpportunityFromQuote({
      opportunityId: 'opp_t29',
      leadId: 'lead_001',
      quote: SAMPLE_QUOTE,
      selectedPlanId: 'bgr_essencial',
      sessionId: 'sess_t29',
    });

    lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_t29_1_signed',
      event_type: 'proposal.signed',
      opportunity_id: 'opp_t29',
      session_id: 'sess_t29',
      occurred_at: '2026-11-10T13:10:00.000Z',
    });

    lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_t29_2_paid',
      event_type: 'payment.confirmed',
      opportunity_id: 'opp_t29',
      session_id: 'sess_t29',
      occurred_at: '2026-11-10T13:15:00.000Z',
    });

    lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_t29_3_inspected',
      event_type: 'inspection.approved',
      opportunity_id: 'opp_t29',
      session_id: 'sess_t29',
      occurred_at: '2026-11-10T13:20:00.000Z',
    });

    const activated = lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_t29_4_activated',
      event_type: 'member.activated',
      opportunity_id: 'opp_t29',
      session_id: 'sess_t29',
      occurred_at: '2026-11-10T13:25:00.000Z',
    });

    assert.equal(activated.stage, 'contratacao_confirmada');
    assert.equal(activated.opportunity.activation_confirmed, true);
    assert.equal(activated.protection_active_declared, true);
    assert.equal(activated.proposed_next_action, 'confirmar_protecao_ativa_pos_venda');
    assert.equal(activated.duplicate_ignored, false);
    assert.equal(activated.customer_message.includes('OFICIALMENTE ATIVA'), true);

    // Reenvio duplicado do mesmo webhook (mesmo event_id) deve ser ignorado com idempotência
    const duplicate = lifecycle.processOfficialWebhookEvent({
      event_id: 'wh_t29_4_activated',
      event_type: 'member.activated',
      opportunity_id: 'opp_t29',
      session_id: 'sess_t29',
      occurred_at: '2026-11-10T13:25:05.000Z',
    });

    assert.equal(duplicate.duplicate_ignored, true);
    assert.equal(duplicate.stage, 'contratacao_confirmada');
  });
});
