import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CampaignFollowUpService } from '../../src/services/campaign-followup-service.ts';
import type { Consent } from '../../src/domain/contracts.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

const VALID_CONSENT: Consent = {
  contact_id: 'cnt_roberto_004',
  phone_hash: 'sha256_5511999990004abcdef',
  opt_in_status: 'granted',
  legal_basis: 'consentimento_explicito',
  opt_out_requested: false,
  consent_source: 'termo_adesao_anterior',
  updated_at: '2026-11-01T12:00:00.000Z',
};

describe('Fase 6 — Campanhas de Reativação e Follow-up Comercial (Elegibilidade, Cadência e Opt-Out)', () => {
  test('T30: Aprova campanha de reativação para ex-associado com consentimento explícito em horário comercial BRT', () => {
    const service = new CampaignFollowUpService();

    // Terça-feira 2026-11-10 às 14:00 UTC = 11:00 BRT (dentro de 09:00-18:00 BRT)
    const res = service.evaluateCandidate(
      {
        contact_id: 'cnt_roberto_004',
        phone: '+5511999990004',
        name: 'Roberto Almeida',
        consent_state: VALID_CONSENT,
        stage: 'oportunidade_perdida',
        followup_count: 0,
        campaign_id: 'campanha_reativacao_nov2026',
        now_iso: '2026-11-10T14:00:00.000Z',
      },
      'campanha_reativacao'
    );

    assert.equal(res.eligibility, true);
    assert.equal(res.template_id, 'bgr_reativacao');
    assert.equal(res.delivery_status, 'queued_for_delivery');
  });

  test('T31: Bloqueia imediatamente contato na lista de supressão (opt-out) mesmo com consentimento anterior', () => {
    const service = new CampaignFollowUpService();
    service.registerOptOutSuppression('+55 (11) 99999-0004');

    const res = service.evaluateCandidate(
      {
        contact_id: 'cnt_roberto_004',
        phone: '+5511999990004',
        name: 'Roberto Almeida',
        consent_state: VALID_CONSENT,
        stage: 'cotacao_enviada',
        followup_count: 0,
        now_iso: '2026-11-10T14:00:00.000Z',
      },
      'campanha_reativacao'
    );

    assert.equal(res.eligibility, false);
    assert.equal(res.delivery_status, 'suppressed_opt_out');
    assert.equal(res.template_id, null);
  });

  test('Horário Comercial BRT: Retém disparos fora das 09:00-18:00 BRT ou em finais de semana', () => {
    const service = new CampaignFollowUpService();

    // Terça-feira às 22:30 UTC = 19:30 BRT (após as 18h BRT)
    const nightRes = service.evaluateCandidate({
      contact_id: 'cnt_001',
      phone: '+5511999990001',
      name: 'Carlos Eduardo',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 0,
      now_iso: '2026-11-10T22:30:00.000Z',
    });
    assert.equal(nightRes.eligibility, false);
    assert.equal(nightRes.delivery_status, 'blocked_outside_business_hours');

    // Domingo 2026-11-08 às 14:00 UTC = 11:00 BRT (fim de semana)
    const sundayRes = service.evaluateCandidate({
      contact_id: 'cnt_001',
      phone: '+5511999990001',
      name: 'Carlos Eduardo',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 0,
      now_iso: '2026-11-08T14:00:00.000Z',
    });
    assert.equal(sundayRes.eligibility, false);
    assert.equal(sundayRes.delivery_status, 'blocked_outside_business_hours');
  });

  test('T32 (Cadência [1, 3, 7] dias, Limite de 3 Tentativas e Deduplicação): Respeita intervalos e impede duplicatas', () => {
    const service = new CampaignFollowUpService();

    // 1ª tentativa (followup_count = 0) -> aprovada
    const first = service.evaluateCandidate({
      contact_id: 'cnt_cad_001',
      phone: '+5511999990001',
      name: 'Carlos',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 0,
      now_iso: '2026-11-10T14:00:00.000Z',
    });
    assert.equal(first.eligibility, true);
    assert.equal(first.template_id, 'followup_cotacao_enviada');

    // Tentativa duplicada exatamente com o mesmo estado -> bloqueada por idempotência (T32)
    const duplicate = service.evaluateCandidate({
      contact_id: 'cnt_cad_001',
      phone: '+5511999990001',
      name: 'Carlos',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 0,
      now_iso: '2026-11-10T14:05:00.000Z',
    });
    assert.equal(duplicate.eligibility, false);
    assert.equal(duplicate.delivery_status, 'blocked_duplicate_dispatch');

    // 2ª tentativa (followup_count = 1 -> exige intervalo de 3 dias = intervalDays[1]):
    // Tentando após apenas 1 dia (2026-11-11) -> bloqueada!
    const tooEarly = service.evaluateCandidate({
      contact_id: 'cnt_cad_001',
      phone: '+5511999990001',
      name: 'Carlos',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 1,
      last_followup_at_iso: '2026-11-10T14:00:00.000Z',
      now_iso: '2026-11-11T14:00:00.000Z',
    });
    assert.equal(tooEarly.eligibility, false);
    assert.equal(tooEarly.delivery_status, 'blocked_cadence_limit');

    // Tentando após 3 dias (2026-11-13, sexta-feira 14:00 UTC) -> aprovada!
    const onTimeSecond = service.evaluateCandidate({
      contact_id: 'cnt_cad_001',
      phone: '+5511999990001',
      name: 'Carlos',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 1,
      last_followup_at_iso: '2026-11-10T14:00:00.000Z',
      now_iso: '2026-11-13T14:00:00.000Z',
    });
    assert.equal(onTimeSecond.eligibility, true);

    // Quando já atingiu 3 tentativas (followup_count = 3) -> bloqueada!
    const maxedOut = service.evaluateCandidate({
      contact_id: 'cnt_cad_001',
      phone: '+5511999990001',
      name: 'Carlos',
      consent_state: VALID_CONSENT,
      stage: 'cotacao_enviada',
      followup_count: 3,
      last_followup_at_iso: '2026-11-01T14:00:00.000Z',
      now_iso: '2026-11-13T15:00:00.000Z',
    });
    assert.equal(maxedOut.eligibility, false);
    assert.equal(maxedOut.delivery_status, 'blocked_cadence_limit');

    // Estágio contratacao_confirmada ou atendimento_humano nunca recebe follow-up comercial
    const humanStage = service.evaluateCandidate({
      contact_id: 'cnt_cad_002',
      phone: '+5511999990002',
      name: 'Maria',
      consent_state: VALID_CONSENT,
      stage: 'atendimento_humano',
      followup_count: 0,
      now_iso: '2026-11-10T14:00:00.000Z',
    });
    assert.equal(humanStage.eligibility, false);
    assert.equal(humanStage.delivery_status, 'blocked_stage_not_eligible');
  });

  test('Workflow Campanha de Reativação n8n: Nó Verificar Descadastro possui filtro real de opt_out e LGPD', () => {
    const wfPath = path.join(PROJECT_ROOT, 'workflows', 'bgr-campanha-reativacao.json');
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));

    const optOutNode = wf.nodes.find((n: { name: string }) => n.name === 'Verificar Descadastro');
    assert.ok(optOutNode);
    assert.equal(
      optOutNode.parameters.conditions.conditions.length,
      5,
      'Deve conter as 5 condições reais de telefone, opt_out (!= sim/true), data_autorizacao e origem_autorizacao'
    );
  });
});
