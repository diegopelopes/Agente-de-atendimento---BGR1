/**
 * BGR Benefícios — Serviço de Qualificação, Cotação Oficial e Contorno de Objeções (Fase 3)
 *
 * Regras garantidas:
 * - Solicita dados progressivamente (1 etapa por vez, sem repetir o que já está na sessão - T06/T08)
 * - NUNCA inventa preços, franquias ou coberturas (T10/T14)
 * - Usa chave de idempotência determinística (SHA-256) para evitar duplicidade no CRM (T32)
 * - Contorna objeções com argumentos aprovados sem conceder descontos não autorizados (T15/T16/T17/T22)
 */

import crypto from 'node:crypto';
import {
  evaluateQualification,
  type AuditEvent,
  type FunnelStage,
  type Lead,
  type QuoteRequest,
  type QuoteResult,
  type Vehicle,
} from '../domain/contracts.ts';
import type { PowerCrmAdapter } from '../integrations/powercrm/adapter.ts';
import type { PowerCrmFipeVehicleData } from '../integrations/powercrm/fipe-native-service.ts';

export type QuotationFlowNextAction =
  | 'qualificar'
  | 'apresentar_cotacao_oficial'
  | 'transferir_humano';

export interface QuotationFlowOutput {
  session_id: string;
  stage: FunnelStage;
  next_action: QuotationFlowNextAction;
  missing_fields: string[];
  idempotency_key: string | null;
  quote_result: QuoteResult | null;
  fipe_data?: PowerCrmFipeVehicleData | null;
  customer_message: string;
  invented_price: false;
  audit_events: AuditEvent[];
}

export type CommercialObjectionType =
  | 'esta_caro'
  | 'vou_pensar'
  | 'concorrente_mais_barato'
  | 'pedido_desconto';

export interface ObjectionResponse {
  objection_type: CommercialObjectionType;
  discount_granted: false;
  requires_human_transfer: boolean;
  customer_message: string;
}

const PROGRESSIVE_QUESTIONS: Record<string, string> = {
  'lead.name': 'Para começarmos seu atendimento personalizado na BGR Benefícios, qual é o seu nome?',
  'vehicle.brand': 'Qual é a marca do veículo que você deseja proteger (ex.: Honda, Toyota, Fiat, Volkswagen)?',
  'vehicle.model': 'Qual é o modelo do veículo (ex.: Civic, Corolla, Pulse, Gol)?',
  'vehicle.year': 'Qual é o ano/modelo do seu veículo (ex.: 2022)?',
  'vehicle.usage':
    'O veículo é utilizado apenas para uso particular ou você também o utiliza para aplicativo/comercial?',
  'lead.city_uf': 'Em qual cidade e estado o veículo circula principalmente?',
  'lead.phone': 'Qual é o seu telefone/WhatsApp com DDD para registrarmos sua cotação oficial?',
};

/**
 * Gera chave de idempotência determinística (SHA-256) para evitar criação duplicada de cotação na mesma sessão.
 */
export function buildQuoteIdempotencyKey(
  sessionId: string,
  lead: Partial<Lead>,
  vehicle: Partial<Vehicle>
): string {
  const cleanPhone = (lead.phone ?? '').replace(/\D/g, '');
  const brand = (vehicle.brand ?? '').trim().toLowerCase();
  const model = (vehicle.model ?? '').trim().toLowerCase();
  const year = String(vehicle.year ?? '');
  const usage = (vehicle.usage ?? '').trim().toLowerCase();

  const raw = `${sessionId}|quote|${cleanPhone}|${brand}|${model}|${year}|${usage}`;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 24);
  return `idem_qot_${hash}`;
}

/**
 * Retorna apenas a próxima pergunta necessária para completar a qualificação,
 * sem repetir o que já foi respondido e sem inventar preços enquanto faltam dados (T08 / T10).
 */
export function getNextQualificationPrompt(
  missingFields: string[],
  lead?: Partial<Lead>,
  vehicle?: Partial<Vehicle>
): string {
  const firstMissing = missingFields[0];
  const baseQuestion =
    PROGRESSIVE_QUESTIONS[firstMissing] ??
    'Poderia confirmar os dados restantes do seu veículo para consultarmos o valor oficial no sistema?';

  const greetingPrefix =
    lead?.name && firstMissing !== 'lead.name' ? `Perfeito, ${lead.name.split(' ')[0]}! ` : '';

  const vehicleContext =
    vehicle?.model && firstMissing !== 'vehicle.model'
      ? `Para consultar a cotação exata do seu ${vehicle.brand ? `${vehicle.brand} ` : ''}${vehicle.model} no sistema oficial da BGR, não posso estimar valores sem concluir os dados. `
      : '';

  return `${greetingPrefix}${vehicleContext}${baseQuestion}`;
}

/**
 * Formata a apresentação comercial usando EXCLUSIVAMENTE os dados oficiais retornados pelo Power CRM
 * e a Ficha Técnica da API FIPE Nativa do Power CRM (código FIPE, versão homologada e valor 100% FIPE em R$).
 */
export function formatOfficialQuotationPresentation(
  lead: Lead,
  vehicle: Vehicle,
  quote: QuoteResult,
  fipeData?: PowerCrmFipeVehicleData | null
): string {
  const formatBrl = (val: number) =>
    val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const plateLine = fipeData?.plate_info
    ? `• Placa Consultada (Base Oficial): *${fipeData.plate_info.plate}* — ${fipeData.plate_info.detran_brand_model} (${fipeData.plate_info.year_label}${fipeData.plate_info.color ? ` • Cor: ${fipeData.plate_info.color}` : ''})\n`
    : vehicle.plate_masked
      ? `• Placa Informada: *${vehicle.plate_masked}*\n`
      : '';

  const fipeSection = fipeData
    ? `📊 *Ficha Técnica Tabela FIPE (Power CRM)*\n` +
      `${plateLine}` +
      `• Versão FIPE Homologada: *${fipeData.model_full_name}* (${fipeData.year_label})\n` +
      `• Código FIPE Oficial: *${fipeData.fipe_code}*\n` +
      `• Valor 100% Tabela FIPE Protegido: *${fipeData.fipe_value_formatted}*\n\n`
    : '';

  const plansText = quote.plans
    .map(
      (plan, idx) =>
        `*${idx + 1}. ${plan.plan_name}*\n` +
        `• Mensalidade: R$ ${formatBrl(plan.monthly_fee_brl)}/mês\n` +
        `• Taxa de adesão/vistoria: R$ ${formatBrl(plan.enrollment_fee_brl)}\n` +
        `• Franquia / Cota de participação: ${plan.deductible_description}\n` +
        `• Coberturas incluídas: ${plan.coverages.join(', ')}`
    )
    .join('\n\n');

  const validDate = quote.valid_until.slice(0, 10).split('-').reverse().join('/');
  const rawFirstName = lead.name.trim().split(/\s+/)[0] || 'Cliente';
  const safeFirstName = /^(particular|passeio|aplicativo|uber|comercial|sem|placa|nao|não|cliente)$/i.test(rawFirstName)
    ? lead.name.trim()
    : rawFirstName;

  return (
    `Olá, ${safeFirstName}! Aqui está a sua cotação oficial da *BGR Benefícios* (Código: *${quote.quotation_code}*) para o veículo *${vehicle.brand} ${vehicle.model} (${vehicle.year} - ${vehicle.usage})*:\n\n` +
    `${fipeSection}` +
    `${plansText}\n\n` +
    `📅 *Validade desta cotação*: até ${validDate}.\n` +
    `⚠️ *Importante*: O recebimento desta cotação não ativa a proteção automaticamente. A cobertura passa a vigorar somente após escolha do plano, vistoria aprovada, assinatura digital da proposta e confirmação oficial do pagamento.\n\n` +
    `Qual das opções faz mais sentido para você hoje, ou gostaria de cotar outro veículo?`
  );
}

export class QuotationService {
  private readonly crmAdapter: PowerCrmAdapter;

  constructor(crmAdapter: PowerCrmAdapter) {
    this.crmAdapter = crmAdapter;
  }

  /**
   * Processa um pedido de cotação:
   * - Se faltarem campos obrigatórios, pede apenas o próximo campo (sem inventar preço - T08/T10).
   * - Se o veículo exigir revisão humana (leilão/modificado), encaminha para humano.
   * - Se completo, consulta/cria cotação no PowerCRM Adapter com idempotency_key e apresenta os valores oficiais (T07).
   */
  async processQuotationRequest(params: {
    sessionId: string;
    lead: Partial<Lead>;
    vehicle: Partial<Vehicle>;
    correlationId?: string;
  }): Promise<QuotationFlowOutput> {
    const { sessionId, lead, vehicle } = params;
    const correlationId = params.correlationId ?? `corr_${Date.now()}_qflow`;

    const check = evaluateQualification(lead, vehicle);

    if (!check.ready_for_quote) {
      return {
        session_id: sessionId,
        stage: 'qualificacao',
        next_action: 'qualificar',
        missing_fields: check.missing_fields,
        idempotency_key: null,
        quote_result: null,
        customer_message: getNextQualificationPrompt(check.missing_fields, lead, vehicle),
        invented_price: false,
        audit_events: [],
      };
    }

    if (check.requires_human_review) {
      return {
        session_id: sessionId,
        stage: 'atendimento_humano',
        next_action: 'transferir_humano',
        missing_fields: [],
        idempotency_key: null,
        quote_result: null,
        customer_message:
          `${check.human_review_reason} ` +
          `Não posso informar valores automáticos para este caso sem a avaliação da nossa equipe técnica. Vou encaminhar seu atendimento agora para um consultor especialista da BGR!`,
        invented_price: false,
        audit_events: [],
      };
    }

    const nowIso = new Date().toISOString();
    const validatedLead: Lead = {
      id: lead.id ?? `lead_${sessionId}`,
      external_crm_id: lead.external_crm_id ?? null,
      name: lead.name!.trim(),
      phone: lead.phone!.replace(/\D/g, '').startsWith('55')
        ? `+${lead.phone!.replace(/\D/g, '')}`
        : `+55${lead.phone!.replace(/\D/g, '')}`,
      email: lead.email ?? null,
      document_masked: lead.document_masked ?? null,
      city_uf: lead.city_uf!.trim(),
      origin: lead.origin ?? 'chat_teste',
      created_at: lead.created_at ?? nowIso,
      updated_at: nowIso,
    };

    const validatedVehicle: Vehicle = {
      brand: vehicle.brand!.trim(),
      model: vehicle.model!.trim(),
      year: Number(vehicle.year),
      usage: vehicle.usage!,
      plate_masked: vehicle.plate_masked ?? null,
      fipe_code: vehicle.fipe_code ?? null,
      is_auction: Boolean(vehicle.is_auction),
      is_modified: Boolean(vehicle.is_modified),
    };

    const idempotencyKey = buildQuoteIdempotencyKey(sessionId, validatedLead, validatedVehicle);

    const fipeData = await this.crmAdapter.getFipeService().lookupFipeAndPlans({
      brand: validatedVehicle.brand,
      model: validatedVehicle.model,
      year: validatedVehicle.year,
      usage: validatedVehicle.usage,
      cityUf: validatedLead.city_uf ?? 'Belo Horizonte/MG',
      plate: validatedVehicle.plate_masked,
      allowLiveHttp: this.crmAdapter.isHttpMode(),
    });

    if (fipeData.plate_info) {
      if (/^(consulta\s+placa|ve[ií]culo)$/i.test(validatedVehicle.brand)) {
        validatedVehicle.brand = fipeData.brand_name;
      }
      if (/^placa\s+/i.test(validatedVehicle.model)) {
        validatedVehicle.model = fipeData.plate_info.detran_model;
        validatedVehicle.year = fipeData.plate_info.model_year;
      }
    }

    if (!validatedVehicle.fipe_code) {
      validatedVehicle.fipe_code = fipeData.fipe_code;
    }

    const quoteRequest: QuoteRequest = {
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      session_id: sessionId,
      lead: validatedLead,
      vehicle: validatedVehicle,
      requested_at: nowIso,
    };

    const crmResponse = await this.crmAdapter.createQuotation(quoteRequest);

    if (crmResponse.status === 'error' || !crmResponse.data) {
      return {
        session_id: sessionId,
        stage: 'atendimento_humano',
        next_action: 'transferir_humano',
        missing_fields: [],
        idempotency_key: idempotencyKey,
        quote_result: null,
        fipe_data: fipeData,
        customer_message: crmResponse.user_safe_message,
        invented_price: false,
        audit_events: [crmResponse.audit_event],
      };
    }

    return {
      session_id: sessionId,
      stage: 'cotacao_enviada',
      next_action: 'apresentar_cotacao_oficial',
      missing_fields: [],
      idempotency_key: idempotencyKey,
      quote_result: crmResponse.data,
      fipe_data: fipeData,
      customer_message: formatOfficialQuotationPresentation(
        validatedLead,
        validatedVehicle,
        crmResponse.data,
        fipeData
      ),
      invented_price: false,
      audit_events: [crmResponse.audit_event],
    };
  }

  /**
   * Trata objeções comerciais (T15, T16, T17) e pedidos de desconto não autorizado (T22)
   * usando apenas argumentos aprovados da Base de Conhecimento BGR.
   */
  handleCommercialObjection(type: CommercialObjectionType): ObjectionResponse {
    switch (type) {
      case 'esta_caro':
        return {
          objection_type: type,
          discount_granted: false,
          requires_human_transfer: false,
          customer_message:
            'Entendo perfeitamente sua análise de custo! Na BGR Benefícios, o valor mensal reflete a segurança de contar com cobertura contra roubo, furto e colisão, assistência 24h em todo o Brasil e oficinas credenciadas de confiança. Se preferir, também podemos comparar o plano Essencial com o plano Completo para ajustar ao seu orçamento atual.',
        };

      case 'vou_pensar':
        return {
          objection_type: type,
          discount_granted: false,
          requires_human_transfer: false,
          customer_message:
            'Claro, fique totalmente à vontade para avaliar com calma! Sua cotação permanece salva e válida conforme o prazo informado. Se surgir qualquer dúvida sobre as coberturas ou a cota de participação, estou à disposição por aqui.',
        };

      case 'concorrente_mais_barato':
        return {
          objection_type: type,
          discount_granted: false,
          requires_human_transfer: false,
          customer_message:
            'É muito importante comparar! Recomendamos sempre verificar não apenas a mensalidade, mas também o limite de quilometragem de guincho 24h, a cota de participação em caso de acionamento e a solidez no atendimento a sinistros. Na BGR Benefícios prezamos pela transparência total no regulamento e agilidade quando você mais precisa.',
        };

      case 'pedido_desconto':
        return {
          objection_type: type,
          discount_granted: false,
          requires_human_transfer: true,
          customer_message:
            'Como assistente virtual, trabalho exclusivamente com a tabela oficial calculada pelo sistema da BGR e não tenho autonomia para aplicar descontos. Porém, posso transferir seu atendimento agora mesmo para um consultor comercial verificar se há alguma condição vigente para o seu perfil. Deseja que eu encaminhe?',
        };
    }
  }
}
