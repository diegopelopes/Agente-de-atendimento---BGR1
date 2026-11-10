/**
 * BGR Benefícios — Serviço de Atendimento, Memória de Sessão, Classificação de Intenção
 * e Guardrail contra Prompt Injection / Extração de Segredos (Fase 7)
 *
 * Implementa o contrato da Seção 5 (Atendimento/Roteamento) e os testes T01 a T06, T20 e T21:
 * - Entradas: mensagem, channel_id, session_id
 * - Saídas: intent, confidence, response, next_action
 * - Saudação completa apenas na 1ª mensagem da sessão (T01 / T02)
 * - Identificação transparente como IA da BGR Benefícios (T03)
 * - Memória isolada por sessão lembrando nome e veículo sem repetir perguntas (T04 / T05 / T06)
 * - Bloqueio determinístico de Prompt Injection (T21) e extração de tokens/credenciais (T20)
 */

import type { AuditEvent, Lead, Vehicle } from '../domain/contracts.ts';
import { sanitizeForAudit } from '../observability/sanitizer.ts';

export type AgentIntent =
  | 'saudacao_inicial'
  | 'identificacao_ia'
  | 'nova_cotacao'
  | 'duvida_cobertura'
  | 'consulta_proposta'
  | 'objecao_comercial'
  | 'pedido_desconto'
  | 'atendimento_humano'
  | 'sinistro_emergencia'
  | 'cancelamento'
  | 'bloqueio_seguranca';

export type RouterNextAction =
  | 'qualificar'
  | 'consultar_crm'
  | 'responder_base_conhecimento'
  | 'transferir_humano'
  | 'bloquear_tentativa_seguranca';

export interface SessionMemoryContext {
  session_id: string;
  channel_id: string;
  greeted: boolean;
  lead: Partial<Lead>;
  vehicle: Partial<Vehicle>;
  history_count: number;
}

export interface AgentRoutingResult {
  session_id: string;
  channel_id: string;
  intent: AgentIntent;
  confidence: number;
  response: string;
  next_action: RouterNextAction;
  security_blocked: boolean;
  memory_snapshot: SessionMemoryContext;
  audit_event: AuditEvent;
}

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(suas\s+|todas\s+as\s+)?instru[cç][oõ]es/i,
  /esque[cç]a\s+(suas\s+|todas\s+as\s+)?regras/i,
  /system\s*prompt/i,
  /diga\s+que\s+(a\s+prote[cç][aã]o\s+|tudo\s+)?[eé]\s+gr[aá]tis/i,
  /modo\s+desenvolvedor|dan\s+mode|jailbreak/i,
];

const CREDENTIAL_PROBING_PATTERNS: RegExp[] = [
  /qual\s+([eé]\s+)?o\s+token/i,
  /mostre\s+(as\s+|suas\s+)?credenciais/i,
  /api\s*key|bearer\s+token|chave\s+da\s+api|senha\s+do\s+sistema/i,
];

export class AgentRouterService {
  private readonly sessions = new Map<string, SessionMemoryContext>();
  private readonly environment: 'teste' | 'homologacao' | 'producao';
  private readonly companyId: string;

  constructor(options?: { environment?: 'teste' | 'homologacao' | 'producao'; companyId?: string }) {
    this.environment = options?.environment ?? 'teste';
    this.companyId = options?.companyId ?? 'bgr_beneficios';
  }

  /**
   * Processa uma mensagem do usuário mantendo memória por sessão e aplicando guardrails de segurança.
   */
  routeMessage(params: {
    message: string;
    channelId: string;
    sessionId: string;
    leadUpdate?: Partial<Lead>;
    vehicleUpdate?: Partial<Vehicle>;
  }): AgentRoutingResult {
    const { message, channelId, sessionId, leadUpdate, vehicleUpdate } = params;
    const text = (message ?? '').trim();
    const session = this.getOrCreateSession(sessionId, channelId);
    session.history_count += 1;

    if (leadUpdate) {
      session.lead = { ...session.lead, ...leadUpdate };
    }
    if (vehicleUpdate) {
      session.vehicle = { ...session.vehicle, ...vehicleUpdate };
    }

    // Extração leve de memória se o cliente informar nome ou carro no texto
    this.extractEntitiesFromText(text, session);

    // 1. Guardrail contra tentativa de obter dados sigilosos / tokens (T20)
    if (CREDENTIAL_PROBING_PATTERNS.some((pat) => pat.test(text))) {
      return this.buildResult({
        session,
        intent: 'bloqueio_seguranca',
        confidence: 0.99,
        nextAction: 'bloquear_tentativa_seguranca',
        securityBlocked: true,
        response:
          'Por motivos de segurança e governança da BGR Benefícios, não tenho acesso nem permissão para exibir chaves, tokens ou credenciais internas do sistema. Como posso ajudar você com a proteção do seu veículo?',
        eventType: 'security_credential_probing_blocked',
        severity: 'HIGH',
        rawSummary: `Tentativa de extração de credenciais bloqueada na sessão ${sessionId} (T20).`,
      });
    }

    // 2. Guardrail contra Prompt Injection (T21)
    if (PROMPT_INJECTION_PATTERNS.some((pat) => pat.test(text))) {
      return this.buildResult({
        session,
        intent: 'bloqueio_seguranca',
        confidence: 0.99,
        nextAction: 'bloquear_tentativa_seguranca',
        securityBlocked: true,
        response:
          'Sou o assistente virtual comercial da BGR Benefícios e sigo estritamente as regras e tabelas oficiais da associação. Não posso alterar minhas diretrizes de atendimento. Deseja realizar uma cotação oficial para o seu veículo?',
        eventType: 'security_prompt_injection_blocked',
        severity: 'CRITICAL',
        rawSummary: `Tentativa de Prompt Injection bloqueada na sessão ${sessionId} (T21).`,
      });
    }

    // 3. Identificação transparente como IA quando perguntado (T03)
    if (/pessoa\s+real|voc[eê]\s+[eé]\s+(um\s+)?(rob[oô]|humano|ia|intelig[eê]ncia\s+artificial)/i.test(text)) {
      session.greeted = true;
      return this.buildResult({
        session,
        intent: 'identificacao_ia',
        confidence: 0.98,
        nextAction: 'responder_base_conhecimento',
        securityBlocked: false,
        response:
          'Sou o assistente virtual com inteligência artificial da BGR Benefícios! Estou aqui 24h para agilizar sua cotação oficial e tirar dúvidas sobre nossa proteção veicular. Se preferir falar com um consultor humano a qualquer momento, basta me avisar!',
        eventType: 'agent_identity_disclosed',
        severity: 'LOW',
        rawSummary: `Agente identificou-se como IA na sessão ${sessionId} (T03).`,
      });
    }

    // 4. Perguntas sobre memória da conversa (T04: "Qual meu nome?" / T05: "Qual carro eu falei?")
    if (/qual\s+([eé]\s+)?(o\s+)?meu\s+nome/i.test(text) && session.lead.name) {
      return this.buildResult({
        session,
        intent: 'nova_cotacao',
        confidence: 0.96,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Seu nome é ${session.lead.name}! Continuo com seu atendimento registrado aqui na sessão.`,
        eventType: 'session_memory_recalled_name',
        severity: 'LOW',
        rawSummary: `Memória de sessão recuperou nome do cliente na sessão ${sessionId} (T04).`,
      });
    }

    if (/qual\s+(carro|ve[ií]culo)\s+eu\s+(falei|informei|disse)/i.test(text) && session.vehicle.model) {
      const carDesc = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model}${session.vehicle.year ? ` ${session.vehicle.year}` : ''}`;
      return this.buildResult({
        session,
        intent: 'nova_cotacao',
        confidence: 0.96,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Você informou o veículo ${carDesc}! Não precisamos repetir esses dados.`,
        eventType: 'session_memory_recalled_vehicle',
        severity: 'LOW',
        rawSummary: `Memória de sessão recuperou veículo (${carDesc}) na sessão ${sessionId} (T05).`,
      });
    }

    // 5. Pedido explícito de atendente humano ou dúvida jurídica complexa (T18 / T19)
    if (
      /falar\s+com\s+(uma\s+pessoa|atendente|humano|consultor|especialista)|cl[aá]usula\s+jur[ií]dica|processo\s+judicial/i.test(
        text
      )
    ) {
      session.greeted = true;
      return this.buildResult({
        session,
        intent: 'atendimento_humano',
        confidence: 0.95,
        nextAction: 'transferir_humano',
        securityBlocked: false,
        response:
          'Compreendo perfeitamente! Estou encaminhando seu atendimento e o resumo da nossa conversa para um especialista humano da BGR Benefícios. Assim que o consultor confirmar o recebimento na fila, ele assumirá esta conversa.',
        eventType: 'router_handoff_requested',
        severity: 'MEDIUM',
        rawSummary: `Roteamento para especialista humano acionado na sessão ${sessionId} (T18/T19).`,
      });
    }

    // 6. Saudação Inicial apenas na 1ª mensagem da sessão (T01 vs T02)
    if (!session.greeted) {
      session.greeted = true;
      const askName = session.lead.name
        ? `Prazer em falar com você, ${session.lead.name}! Qual é o modelo e ano do veículo que você gostaria de proteger?`
        : 'Qual é o seu nome?';

      return this.buildResult({
        session,
        intent: 'saudacao_inicial',
        confidence: 0.97,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Olá! Seja bem-vindo à BGR Benefícios! 🚗 Sou o assistente virtual comercial da BGR. Vou te ajudar a conhecer nossa proteção veicular e encontrar a melhor opção para seu veículo. ${askName}`,
        eventType: 'session_initial_greeting_sent',
        severity: 'LOW',
        rawSummary: `Saudação inicial enviada na primeira interação da sessão ${sessionId} (T01).`,
      });
    }

    // 7. Mensagens subsequentes na mesma sessão: NÃO repete saudação inicial e NÃO repete perguntas já respondidas (T02 / T06)
    const missingPrompts: string[] = [];
    if (!session.lead.name) {
      missingPrompts.push('qual é o seu nome?');
    } else if (!session.vehicle.model) {
      missingPrompts.push('qual é a marca, modelo e ano do seu veículo?');
    } else if (!session.vehicle.usage) {
      missingPrompts.push(
        `o seu ${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model} é para uso particular ou aplicativo?`
      );
    } else if (!session.lead.city_uf) {
      missingPrompts.push('em qual cidade e estado o veículo circula?');
    }

    const followUpText =
      missingPrompts.length > 0
        ? `Perfeito${session.lead.name ? `, ${session.lead.name}` : ''}! Para avançarmos com a sua cotação oficial na BGR, ${missingPrompts[0]}`
        : `Obrigado pelas informações, ${session.lead.name}! Já tenho os dados do seu ${session.vehicle.brand ?? ''} ${session.vehicle.model ?? ''} e vou consultar o sistema oficial da BGR.`;

    return this.buildResult({
      session,
      intent: 'nova_cotacao',
      confidence: 0.92,
      nextAction: missingPrompts.length > 0 ? 'qualificar' : 'consultar_crm',
      securityBlocked: false,
      response: followUpText,
      eventType: 'session_progressive_qualification',
      severity: 'LOW',
      rawSummary: `Continuação de atendimento sem repetir saudação na sessão ${sessionId} (T02/T06).`,
    });
  }

  private getOrCreateSession(sessionId: string, channelId: string): SessionMemoryContext {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: SessionMemoryContext = {
      session_id: sessionId,
      channel_id: channelId,
      greeted: false,
      lead: {},
      vehicle: {},
      history_count: 0,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private extractEntitiesFromText(text: string, session: SessionMemoryContext): void {
    const nameMatch = text.match(/(?:meu\s+nome\s+[eé]|sou\s+o|sou\s+a|me\s+chamo)\s+([A-ZÀ-Úa-zà-ú]+(?:\s+[A-ZÀ-Úa-zà-ú]+)*)/i);
    if (nameMatch && !session.lead.name) {
      session.lead.name = nameMatch[1].trim();
    } else if (
      session.greeted &&
      !session.lead.name &&
      !/^(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|quero|quanto|qual|voc[eê]|tenho|ignore)/i.test(text) &&
      /^[A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,}){0,3}$/.test(text.trim())
    ) {
      session.lead.name = text.trim();
    }

    const carMatch = text.match(
      /\b(Honda|Toyota|Fiat|Volkswagen|VW|Chevrolet|Hyundai|Jeep|Renault|Nissan|Ford|BYD|Caoa|Peugeot|Citroen)\s+([A-Za-z0-9À-ú]+)\s+(19\d{2}|20\d{2})\b/i
    );
    if (carMatch) {
      session.vehicle.brand = carMatch[1];
      session.vehicle.model = carMatch[2];
      session.vehicle.year = Number(carMatch[3]);
    } else {
      const modelOnlyMatch = text.match(
        /\b(Civic|Corolla|Onix|HB20|Gol|Polo|Toro|Strada|Compass|Renegade|Creta|Tracker|Kicks|Hilux|HR-V|Fastback|Pulse|Argo|Cronos|Mobi|Kwid|Sandero|Duster|EcoSport|Ranger|S10)\s+(19\d{2}|20\d{2})\b/i
      );
      if (modelOnlyMatch) {
        session.vehicle.brand = session.vehicle.brand ?? 'Veículo';
        session.vehicle.model = modelOnlyMatch[1];
        session.vehicle.year = Number(modelOnlyMatch[2]);
      }
    }

    if (/\b(particular|passeio|pessoal|fam[ií]lia)\b/i.test(text)) {
      session.vehicle.usage = 'particular';
    } else if (/\b(aplicativo|uber|99|motorista\s+de\s+app|aluguel|comercial|trabalho)\b/i.test(text)) {
      session.vehicle.usage = 'aplicativo';
    }

    const cityMatch = text.match(
      /\b(Belo\s+Horizonte|BH|Contagem|Betim|Uberl[aâ]ndia|Juiz\s+de\s+Fora|S[aã]o\s+Paulo|SP|Rio\s+de\s+Janeiro|RJ|Curitiba|Bras[ií]lia|Goi[aâ]nia|Salvador|Recife|Fortaleza|Campinas|Vit[oó]ria)(?:\s*[/-]\s*([A-Z]{2}))?\b/i
    );
    if (cityMatch) {
      session.lead.city_uf = cityMatch[2] ? `${cityMatch[1]}/${cityMatch[2].toUpperCase()}` : cityMatch[1];
    }
  }

  private buildResult(params: {
    session: SessionMemoryContext;
    intent: AgentIntent;
    confidence: number;
    nextAction: RouterNextAction;
    securityBlocked: boolean;
    response: string;
    eventType: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    rawSummary: string;
  }): AgentRoutingResult {
    const sanitized = sanitizeForAudit(params.rawSummary);
    const eventId = `evt_rt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const auditEvent: AuditEvent = {
      event_id: eventId,
      idempotency_key: `idem_${eventId}`,
      correlation_id: `corr_${eventId}`,
      timestamp: new Date().toISOString(),
      environment: this.environment,
      company_id: this.companyId,
      session_id: params.session.session_id,
      event_type: params.eventType,
      severity: params.severity,
      status: params.securityBlocked ? 'bloqueado' : 'sucesso',
      http_code: params.securityBlocked ? 403 : 200,
      safe_summary: sanitized.sanitized_text,
    };

    return {
      session_id: params.session.session_id,
      channel_id: params.session.channel_id,
      intent: params.intent,
      confidence: params.confidence,
      response: params.response,
      next_action: params.nextAction,
      security_blocked: params.securityBlocked,
      memory_snapshot: {
        ...params.session,
        lead: { ...params.session.lead },
        vehicle: { ...params.session.vehicle },
      },
      audit_event: auditEvent,
    };
  }
}
