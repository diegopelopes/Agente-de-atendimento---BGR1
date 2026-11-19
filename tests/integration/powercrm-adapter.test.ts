import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PowerCrmAdapter } from '../../src/integrations/powercrm/adapter.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('Fase 2 — PowerCRM Adapter (Leitura Controlada, Mocks, Resiliência HTTP e Segurança)', () => {
  test('T11 (Mock): Consulta cotação existente COT-10001 retorna planos oficiais validados', async () => {
    const adapter = new PowerCrmAdapter({
      mode: 'mock',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
    });

    const res = await adapter.getQuotationByCode('COT-10001', 'sess_t11', 'corr_t11_001');
    assert.equal(res.status, 'success');
    assert.equal(res.http_code, 200);
    assert.equal(res.error_code, null);
    assert.equal(res.fallback_human_required, false);
    assert.ok(res.data);
    assert.equal(res.data.quotation_code, 'COT-10001');
    assert.equal(res.data.plans.length, 2);
    assert.equal(res.data.plans[0].monthly_fee_brl, 149.9);
    assert.equal(res.audit_event.correlation_id, 'corr_t11_001');
  });

  test('T09 (Mock & HTTP 404): Código de cotação inexistente COT-999999 retorna 404 sem retry', async () => {
    let httpCalls = 0;
    const adapter = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: 'token_secreto_teste_bgr_12345',
      maxRetriesGet: 2,
      fetchImpl: async () => {
        httpCalls += 1;
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      },
    });

    const res = await adapter.getQuotationByCode('COT-999999', 'sess_t09', 'corr_t09_001');
    assert.equal(res.status, 'error');
    assert.equal(res.error_code, 'ERR_CRM_NOT_FOUND');
    assert.equal(res.http_code, 404);
    assert.equal(res.attempts, 1, 'HTTP 404 NUNCA deve realizar retry');
    assert.equal(httpCalls, 1);
    assert.equal(res.fallback_human_required, false);
  });

  test('T12 (HTTP 401 / 403): Falha de autenticação não faz retry, aciona fallback humano e NUNCA vaza o Bearer token no log', async () => {
    let httpCalls = 0;
    const secretToken = 'segredo_super_confidencial_powercrm_999';
    const adapter = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: secretToken,
      maxRetriesGet: 2,
      fetchImpl: async () => {
        httpCalls += 1;
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      },
    });

    const res = await adapter.getQuotationByCode('COT-10001', 'sess_t12', 'corr_t12_001');
    assert.equal(res.status, 'error');
    assert.equal(res.error_code, 'ERR_CRM_AUTH');
    assert.equal(res.http_code, 401);
    assert.equal(res.attempts, 1, 'HTTP 401 NUNCA deve realizar retry');
    assert.equal(httpCalls, 1);
    assert.equal(res.fallback_human_required, true);
    assert.equal(res.audit_event.severity, 'CRITICAL');
    assert.equal(
      res.audit_event.safe_summary.includes(secretToken),
      false,
      'O token Bearer jamais pode aparecer no safe_summary do AuditEvent'
    );
  });

  test('T13 (HTTP 503 & Timeout): Executa retry controlado em GET (1 + maxRetriesGet) e aciona fallback humano', async () => {
    let serverErrorCalls = 0;
    const adapter503 = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: 'token_valido_teste_123456',
      maxRetriesGet: 2,
      fetchImpl: async () => {
        serverErrorCalls += 1;
        return new Response('Service Unavailable', { status: 503 });
      },
    });

    const res503 = await adapter503.getQuotationByCode('COT-10001', 'sess_t13_503', 'corr_t13_503');
    assert.equal(res503.status, 'error');
    assert.equal(res503.error_code, 'ERR_CRM_UNAVAILABLE');
    assert.equal(res503.attempts, 3, 'Deve tentar 1 inicial + 2 retries em GET 503');
    assert.equal(serverErrorCalls, 3);
    assert.equal(res503.fallback_human_required, true);

    let timeoutCalls = 0;
    const adapterTimeout = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: 'token_valido_teste_123456',
      timeoutMs: 50,
      maxRetriesGet: 1,
      fetchImpl: async () => {
        timeoutCalls += 1;
        const abortErr = new Error('The operation was aborted due to timeout');
        abortErr.name = 'AbortError';
        throw abortErr;
      },
    });

    const resTimeout = await adapterTimeout.getQuotationByCode('COT-10001', 'sess_t13_to', 'corr_t13_to');
    assert.equal(resTimeout.status, 'error');
    assert.equal(resTimeout.error_code, 'ERR_CRM_TIMEOUT');
    assert.equal(resTimeout.attempts, 2, 'Deve tentar 1 inicial + 1 retry configurado em Timeout GET');
    assert.equal(timeoutCalls, 2);
    assert.equal(resTimeout.fallback_human_required, true);
  });

  test('T14 (Cotação sem preço): Bloqueia apresentação sem valores válidos e exige transferência humana', async () => {
    const adapter = new PowerCrmAdapter({
      mode: 'mock',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
    });

    const res = await adapter.getQuotationByCode('COT-SEM-PRECO', 'sess_t14', 'corr_t14_001');
    assert.equal(res.status, 'error');
    assert.equal(res.error_code, 'ERR_CRM_EMPTY_PRICE');
    assert.equal(res.fallback_human_required, true);
  });

  test('HTTP 429 (Rate Limit): Trata limite de taxa e orienta fallback humano', async () => {
    const adapter = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
      bearerToken: 'token_valido_teste_123456',
      fetchImpl: async () => new Response('Too Many Requests', { status: 429 }),
    });

    const res = await adapter.getQuotationByCode('COT-10001', 'sess_429', 'corr_429');
    assert.equal(res.status, 'error');
    assert.equal(res.error_code, 'ERR_CRM_RATE_LIMIT');
    assert.equal(res.http_code, 429);
    assert.equal(res.fallback_human_required, true);
  });

  test('Consulta de Lead: Rejeita query vazia e mascara telefone nos eventos de auditoria', async () => {
    const adapter = new PowerCrmAdapter({
      mode: 'mock',
      baseUrl: 'https://api.powercrm.com.br/api/v1',
    });

    const emptyRes = await adapter.getLeadByPhoneOrDocument({ phone: '', document: '' }, 'sess_lead_01');
    assert.equal(emptyRes.status, 'error');
    assert.equal(emptyRes.error_code, 'ERR_INVALID_INPUT');

    const foundRes = await adapter.getLeadByPhoneOrDocument({ phone: '+5511999990001' }, 'sess_lead_02');
    assert.equal(foundRes.status, 'success');
    assert.equal(foundRes.data?.name, 'Carlos Eduardo Silva');
    assert.equal(
      foundRes.audit_event.safe_summary.includes('999990001'),
      false,
      'O telefone completo deve estar mascarado no AuditEvent'
    );
  });

  test('Workflow Principal n8n: Credencial Power CRM - Bearer padronizada e nós HTTP permanecem desativados', () => {
    const wfPath = path.join(PROJECT_ROOT, 'workflows', 'bgr-agente-comercial-principal.json');
    const wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));

    const crmTools = wf.nodes.filter((n: { name: string }) => n.name.includes('Power CRM'));
    assert.equal(crmTools.length, 3);

    for (const toolNode of crmTools) {
      assert.equal(
        toolNode.disabled,
        true,
        `Nó '${toolNode.name}' deve permanecer desativado até autorização do teste controlado`
      );
      assert.equal(
        toolNode.credentials?.httpHeaderAuth?.name,
        'Power CRM - Bearer',
        `Nó '${toolNode.name}' deve referenciar a credencial padronizada 'Power CRM - Bearer'`
      );
    }
  });

  test('Sincronização no Power CRM: Registra cotação e lead no funil sob a origem 19266 (BGR - DIEGO)', async () => {
    const capturedCalls: Array<{ url: string; body: any }> = [];

    const adapter = new PowerCrmAdapter({
      mode: 'http',
      baseUrl: 'https://api.powercrm.com.br/api',
      originId: '19266',
      bearerToken: 'token_teste_123',
      fetchImpl: async (url, init) => {
        const u = String(url);
        const b = JSON.parse(String(init?.body || '{}'));
        capturedCalls.push({ url: u, body: b });
        if (u.includes('/quotation/add')) {
          return new Response(JSON.stringify({ quotationCode: 'COT-TEST01', negotiationCode: 'NEG-TEST01' }), {
            status: 200,
          });
        }
        return new Response('ok', { status: 200 });
      },
    });

    assert.equal(adapter.getOriginId(), '19266');

    const syncRes = await adapter.syncLeadToPowerCrm({
      lead: {
        id: 'lead_diego_01',
        name: 'Diego Gomes',
        phone: '+5521969573517',
        email: 'diego@bgrbeneficios.com.br',
        city_uf: 'Rio de Janeiro/RJ',
        origin: 'whatsapp_oficial',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      vehicle: {
        brand: 'FIAT',
        model: 'ARGO',
        year: 2022,
        usage: 'particular',
        plate_masked: 'BRA2E19',
        fipe_code: '001509-1',
      },
      quotationCode: 'COT-OFICIAL01',
      fipeCode: '001509-1',
      fipeValueFormatted: 'R$ 68.900,00',
      modelFullName: 'ARGO DRIVE 1.0 6V FLEX',
      plans: [
        {
          plan_id: 'bgr_master',
          plan_name: 'BGR Master',
          monthly_fee_brl: 149.9,
          enrollment_fee_brl: 250,
          deductible_description: '5% FIPE',
          coverages: ['Roubo', 'Colisão'],
        },
      ],
    });

    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.status, 200);
    assert.equal(capturedCalls.length, 2);

    // Chamada 1: Ingestão direta na coluna "Cotações recebidas" do Kanban de Vendas
    assert.equal(capturedCalls[0].url, 'https://api.powercrm.com.br/api/quotation/add');
    assert.equal(capturedCalls[0].body.name.includes('Diego Gomes'), true);
    assert.equal(capturedCalls[0].body.name.includes('(21) 96957-3517'), true);
    assert.equal(capturedCalls[0].body.phone, '21969573517');
    assert.equal(capturedCalls[0].body.phoneMobile1, '(21) 96957-3517');
    assert.equal(capturedCalls[0].body.plts, 'BRA2E19');
    assert.equal(capturedCalls[0].body.origemId, 19266);

    // Chamada 2: Ingestão de metadados no RD Station / Power CRM
    assert.equal(capturedCalls[1].url, 'https://api.powercrm.com.br/rdstation/add/19266');
    assert.ok(capturedCalls[1].body.leads && capturedCalls[1].body.leads.length === 1);
    const capturedLead = capturedCalls[1].body.leads[0];
    assert.equal(capturedLead.name, 'Diego Gomes');
    assert.equal(capturedLead.email, 'diego@bgrbeneficios.com.br');
    assert.equal(capturedLead.first_conversion.content.placa, 'BRA2E19');
    assert.equal(capturedLead.first_conversion.content.codigo_fipe, '001509-1');
    assert.equal(capturedLead.first_conversion.content.codigo_cotacao, 'COT-OFICIAL01');
    assert.equal(capturedLead.custom_fields['Placa'], 'BRA2E19');
    assert.equal(capturedLead.custom_fields['FIPE'], '001509-1');
    assert.equal(capturedLead.custom_fields['Código Cotação'], 'COT-OFICIAL01');
    assert.equal(capturedLead.custom_fields['Canal'], 'Agente Comercial IA BGR (+55 21 96957-3517)');
  });
});
