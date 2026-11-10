import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateQualification,
  validateOpportunityTransition,
  isEligibleForCampaign,
  type Opportunity,
  type PaymentStatus,
  type Consent,
} from '../../src/domain/contracts.ts';
import { sanitizeForAudit } from '../../src/observability/sanitizer.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('Fase 1 — Contratos Tipados, Qualificação, Estados e Sanitização (Node.js + TypeScript)', () => {
  test('1. Valida existência dos 10 contratos canônicos em contracts.schema.json', () => {
    const schemaPath = path.join(PROJECT_ROOT, 'src', 'domain', 'contracts.schema.json');
    assert.equal(fs.existsSync(schemaPath), true);
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const requiredDefs = [
      'Lead',
      'Vehicle',
      'QuoteRequest',
      'QuoteResult',
      'Conversation',
      'Consent',
      'Opportunity',
      'Handoff',
      'PaymentStatus',
      'AuditEvent',
    ];
    for (const defName of requiredDefs) {
      assert.ok(schema.$defs[defName], `Definição ${defName} deve existir no JSON Schema`);
    }
  });

  test('2. Qualificação Comercial: bloqueia dados incompletos (T08) e aprova dados completos (T07)', () => {
    const incomplete = evaluateQualification({ name: 'Carlos' }, { model: 'Civic' });
    assert.equal(incomplete.ready_for_quote, false);
    assert.equal(incomplete.missing_fields.length, 5);

    const complete = evaluateQualification(
      { name: 'Carlos Eduardo Silva', phone: '+5511999990001', city_uf: 'Belo Horizonte/MG' },
      { brand: 'Honda', model: 'Civic', year: 2022, usage: 'particular', is_auction: false }
    );
    assert.equal(complete.ready_for_quote, true);
    assert.equal(complete.missing_fields.length, 0);
    assert.equal(complete.requires_human_review, false);
  });

  test('3. Máquina de Estados: bloqueia ativação prematura sem pagamento oficial confirmado (T27/T28/T29)', () => {
    const prematureOpp: Opportunity = {
      opportunity_id: 'opp-001',
      lead_id: 'lead-001',
      quote_id: 'quo-001',
      stage: 'contratacao_confirmada',
      signature_verified: true,
      payment_verified: false,
      inspection_verified: true,
      activation_confirmed: true,
      updated_at: new Date().toISOString(),
    };
    const unverifiedPayment: PaymentStatus = {
      payment_id: 'pay-001',
      opportunity_id: 'opp-001',
      status: 'comprovante_enviado_nao_validado',
      verified_by_system: false,
      updated_at: new Date().toISOString(),
    };

    const blockedResult = validateOpportunityTransition(prematureOpp, unverifiedPayment);
    assert.equal(blockedResult.valid, false);
    assert.ok(blockedResult.errors.length >= 2);

    const officialOpp: Opportunity = {
      ...prematureOpp,
      payment_verified: true,
    };
    const officialPayment: PaymentStatus = {
      ...unverifiedPayment,
      status: 'confirmado_oficial',
      verified_by_system: true,
    };
    const validResult = validateOpportunityTransition(officialOpp, officialPayment);
    assert.equal(validResult.valid, true);
    assert.equal(validResult.errors.length, 0);
  });

  test('4. Sanitizador LGPD e Anti-Leak: remove Bearer/OpenAI tokens e mascara CPF, placa e telefone (T20)', () => {
    const raw =
      'Cliente CPF 123.456.789-00 placa ABC1D23 tel +5511999990001 header Authorization: Bearer tokenSecreto987654 e sk-1234567890abcdefghij';
    const result = sanitizeForAudit(raw);

    assert.equal(result.redacted_secrets_count >= 2, true);
    assert.equal(result.masked_pii_count, 3);
    assert.equal(result.sanitized_text.includes('tokenSecreto987654'), false);
    assert.equal(result.sanitized_text.includes('123.456.789-00'), false);
    assert.equal(result.sanitized_text.includes('ABC1D23'), false);
    assert.equal(result.sanitized_text.includes('999990001'), false);
  });

  test('5. Elegibilidade de Campanha: bloqueia opt-out (T31) e permite opt-in válido (T30)', () => {
    const optOutConsent: Consent = {
      contact_id: 'cnt-001',
      phone_hash: 'sha256_1234567890abcdef',
      opt_in_status: 'granted',
      legal_basis: 'consentimento_explicito',
      opt_out_requested: true,
      updated_at: new Date().toISOString(),
    };
    assert.equal(isEligibleForCampaign(optOutConsent).eligible, false);

    const validConsent: Consent = {
      ...optOutConsent,
      opt_out_requested: false,
    };
    assert.equal(isEligibleForCampaign(validConsent).eligible, true);
  });
});
