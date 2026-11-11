import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PowerCrmAdapter } from '../../src/integrations/powercrm/adapter.ts';
import { QuotationService } from '../../src/services/quotation-service.ts';

describe('Fase 3 — Serviço de Qualificação, Cotação Oficial e Objeções Comerciais', () => {
  test('T08 & T10: Cotação com dados incompletos solicita apenas o próximo campo e NUNCA inventa preço (ex: Corolla 2023)', async () => {
    const adapter = new PowerCrmAdapter({ mode: 'mock', baseUrl: 'https://api.powercrm.com.br/api/v1' });
    const service = new QuotationService(adapter);

    // Cliente pergunta: "Quanto custa a proteção para um Corolla 2023?" sem ter informado nome/cidade/uso/telefone
    const res = await service.processQuotationRequest({
      sessionId: 'sess_t10',
      lead: {},
      vehicle: { brand: 'Toyota', model: 'Corolla', year: 2023 },
    });

    assert.equal(res.next_action, 'qualificar');
    assert.equal(res.stage, 'qualificacao');
    assert.equal(res.invented_price, false);
    assert.equal(res.quote_result, null);
    assert.equal(
      /R\$\s*\d+/i.test(res.customer_message),
      false,
      'A mensagem NUNCA deve conter valores em R$ antes do retorno oficial do CRM'
    );
    assert.ok(res.missing_fields.includes('lead.name'));
  });

  test('T07: Cotação com dados completos retorna planos oficiais do CRM, validade e aviso de não-ativação imediata', async () => {
    const adapter = new PowerCrmAdapter({ mode: 'mock', baseUrl: 'https://api.powercrm.com.br/api/v1' });
    const service = new QuotationService(adapter);

    const res = await service.processQuotationRequest({
      sessionId: 'sess_t07',
      lead: {
        name: 'Carlos Eduardo Silva',
        phone: '+5511999990001',
        city_uf: 'Belo Horizonte/MG',
      },
      vehicle: {
        brand: 'Honda',
        model: 'Civic',
        year: 2022,
        usage: 'particular',
      },
    });

    assert.equal(res.next_action, 'apresentar_cotacao_oficial');
    assert.equal(res.stage, 'cotacao_enviada');
    assert.equal(res.invented_price, false);
    assert.ok(res.quote_result);
    assert.ok(res.fipe_data);
    assert.equal(res.fipe_data.fipe_code, '014091-0');
    assert.equal(res.quote_result.plans.length, 2);
    assert.equal(res.customer_message.includes('Ficha Técnica Tabela FIPE (Power CRM)'), true);
    assert.equal(res.customer_message.includes('014091-0'), true);
    assert.equal(res.customer_message.includes('BGR Essencial'), true);
    assert.equal(res.customer_message.includes('149,90'), true);
    assert.equal(
      res.customer_message.includes('não ativa a proteção automaticamente'),
      true,
      'Deve conter o aviso obrigatório de que cotação não significa proteção ativa'
    );
  });

  test('T32 (Idempotência na Cotação): Duas requisições idênticas na mesma sessão retornam a mesma cotação sem duplicar no CRM', async () => {
    let postCalls = 0;
    const adapter = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: 'token_valido_teste_bgr_123456',
      fetchImpl: async () => {
        postCalls += 1;
        return new Response(
          JSON.stringify({
            quote_id: 'quo_oficial_777',
            quotation_code: 'COT-777',
            valid_until: '2026-11-30T23:59:59.000Z',
            plans: [
              {
                plan_id: 'essencial',
                plan_name: 'BGR Essencial',
                monthly_fee_brl: 159.9,
                enrollment_fee_brl: 200,
                deductible_description: '5% FIPE',
                coverages: ['Roubo', 'Furto', 'Colisão'],
              },
            ],
          }),
          { status: 201 }
        );
      },
    });

    const service = new QuotationService(adapter);
    const payload = {
      sessionId: 'sess_idem_001',
      lead: {
        name: 'Maria Fernanda Santos',
        phone: '+5511999990002',
        city_uf: 'São Paulo/SP',
      },
      vehicle: {
        brand: 'Toyota',
        model: 'Corolla',
        year: 2023,
        usage: 'particular' as const,
      },
    };

    const first = await service.processQuotationRequest(payload);
    const second = await service.processQuotationRequest(payload);

    assert.equal(first.idempotency_key, second.idempotency_key);
    assert.equal(first.quote_result?.quotation_code, 'COT-777');
    assert.equal(second.quote_result?.quotation_code, 'COT-777');
    assert.equal(postCalls, 1, 'O CRM deve ser chamado apenas 1 vez graças à idempotency_key');
  });

  test('Veículo de Leilão / Especial: Não inventa preço e encaminha para análise humana', async () => {
    const adapter = new PowerCrmAdapter({ mode: 'mock', baseUrl: 'https://api.powercrm.com.br/api/v1' });
    const service = new QuotationService(adapter);

    const res = await service.processQuotationRequest({
      sessionId: 'sess_leilao',
      lead: {
        name: 'João Pedro Oliveira',
        phone: '+5511999990003',
        city_uf: 'Curitiba/PR',
      },
      vehicle: {
        brand: 'Fiat',
        model: 'Pulse',
        year: 2024,
        usage: 'aplicativo',
        is_auction: true,
      },
    });

    assert.equal(res.next_action, 'transferir_humano');
    assert.equal(res.stage, 'atendimento_humano');
    assert.equal(res.quote_result, null);
    assert.equal(/R\$\s*\d+/i.test(res.customer_message), false);
  });

  test('T15, T16, T17 e T22: Contorno de objeções comerciais e bloqueio estrito de desconto não autorizado', () => {
    const adapter = new PowerCrmAdapter({ mode: 'mock', baseUrl: 'https://api.powercrm.com.br/api/v1' });
    const service = new QuotationService(adapter);

    const t15 = service.handleCommercialObjection('esta_caro');
    assert.equal(t15.discount_granted, false);
    assert.equal(t15.requires_human_transfer, false);
    assert.equal(t15.customer_message.includes('assistência 24h'), true);

    const t16 = service.handleCommercialObjection('vou_pensar');
    assert.equal(t16.discount_granted, false);
    assert.equal(t16.requires_human_transfer, false);

    const t17 = service.handleCommercialObjection('concorrente_mais_barato');
    assert.equal(t17.discount_granted, false);
    assert.equal(t17.requires_human_transfer, false);

    const t22 = service.handleCommercialObjection('pedido_desconto');
    assert.equal(t22.discount_granted, false);
    assert.equal(t22.requires_human_transfer, true, 'Pedido de desconto deve oferecer transferência para humano');
    assert.equal(t22.customer_message.includes('não tenho autonomia para aplicar descontos'), true);
  });
});
