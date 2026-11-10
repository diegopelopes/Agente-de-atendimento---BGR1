/**
 * BGR Benefícios — Serviço de Atendimento, Memória de Sessão, NLU Contextual (Slot-Filling),
 * Catálogo Nacional de Veículos (FIPE/Brasil) e Guardrails de Segurança (Fase 7)
 *
 * Implementa o contrato da Seção 5 (Atendimento/Roteamento) e os testes T01 a T06, T20 e T21:
 * - Entradas: mensagem, channel_id, session_id
 * - Saídas: intent, confidence, response, next_action
 * - Saudação completa apenas na 1ª mensagem da sessão (T01 / T02)
 * - Identificação transparente como IA da BGR Benefícios (T03)
 * - Memória isolada por sessão lembrando nome e veículo sem repetir perguntas (T04 / T05 / T06)
 * - Slot-Filling Contextual (expected_slot) + Catálogo de 160+ veículos brasileiros com inferência de marca
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

export type ExpectedQualificationSlot =
  | 'name'
  | 'vehicle_model'
  | 'vehicle_year'
  | 'vehicle_usage'
  | 'city_uf'
  | 'completed';

export interface SessionMemoryContext {
  session_id: string;
  channel_id: string;
  greeted: boolean;
  expected_slot?: ExpectedQualificationSlot;
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

interface VehicleCatalogEntry {
  brand: string;
  model: string;
  aliases: string[];
}

/**
 * Catálogo Nacional de Veículos (Carros, SUVs, Picapes e Motos mais comuns no Brasil)
 * Permite reconhecer o veículo mesmo quando o cliente digita apenas o modelo (ex: "Onix", "Palio", "T-Cross", "CG 160").
 */
const BRAZIL_VEHICLE_CATALOG: VehicleCatalogEntry[] = [
  // Honda (Carros e Motos)
  { brand: 'Honda', model: 'Civic', aliases: ['civic', 'new civic', 'civic touring', 'civic lxs', 'civic exl'] },
  { brand: 'Honda', model: 'City', aliases: ['city', 'new city', 'city hatch', 'city sedan'] },
  { brand: 'Honda', model: 'Fit', aliases: ['fit', 'honda fit'] },
  { brand: 'Honda', model: 'HR-V', aliases: ['hr-v', 'hrv', 'hr v'] },
  { brand: 'Honda', model: 'WR-V', aliases: ['wr-v', 'wrv', 'wr v'] },
  { brand: 'Honda', model: 'CR-V', aliases: ['cr-v', 'crv', 'cr v'] },
  { brand: 'Honda', model: 'ZR-V', aliases: ['zr-v', 'zrv'] },
  { brand: 'Honda', model: 'CG 160', aliases: ['cg 160', 'cg160', 'titan 160', 'fan 160', 'start 160', 'cargo 160', 'cg titan', 'cg fan'] },
  { brand: 'Honda', model: 'CG 150', aliases: ['cg 150', 'cg150', 'titan 150', 'fan 150'] },
  { brand: 'Honda', model: 'Biz', aliases: ['biz', 'biz 125', 'biz 110', 'honda biz'] },
  { brand: 'Honda', model: 'Bros 160', aliases: ['bros', 'bros 160', 'nxr 160', 'bros 150'] },
  { brand: 'Honda', model: 'XRE 300', aliases: ['xre 300', 'xre300', 'xre 190', 'xre190', 'xre', 'sahara 300'] },
  { brand: 'Honda', model: 'PCX', aliases: ['pcx', 'pcx 160', 'pcx 150', 'honda adv', 'elite 125', 'pop 110'] },
  { brand: 'Honda', model: 'CB 300F Twister', aliases: ['cb 300', 'cb300', 'twister', 'cb twister', 'cb 500', 'cb500', 'hornet'] },

  // Toyota
  { brand: 'Toyota', model: 'Corolla', aliases: ['corolla', 'corola', 'corolla xei', 'corolla gli', 'corolla altis'] },
  { brand: 'Toyota', model: 'Corolla Cross', aliases: ['corolla cross', 'corola cross'] },
  { brand: 'Toyota', model: 'Hilux', aliases: ['hilux', 'hillux', 'hilux srv', 'hilux srx', 'hilux cd'] },
  { brand: 'Toyota', model: 'SW4', aliases: ['sw4', 'hilux sw4'] },
  { brand: 'Toyota', model: 'Yaris', aliases: ['yaris', 'yaris hatch', 'yaris sedan'] },
  { brand: 'Toyota', model: 'Etios', aliases: ['etios', 'etios hatch', 'etios sedan'] },
  { brand: 'Toyota', model: 'RAV4', aliases: ['rav4', 'rav 4'] },

  // Chevrolet / GM
  { brand: 'Chevrolet', model: 'Onix', aliases: ['onix', 'ônix', 'onix plus', 'onix joy', 'onix lt', 'onix ltz', 'onix premier', 'onix turbo'] },
  { brand: 'Chevrolet', model: 'Prisma', aliases: ['prisma', 'prisma joy', 'prisma ltz'] },
  { brand: 'Chevrolet', model: 'Tracker', aliases: ['tracker', 'chevrolet tracker', 'tracker turbo', 'tracker premier'] },
  { brand: 'Chevrolet', model: 'Cruze', aliases: ['cruze', 'cruze sport6', 'cruze ltz'] },
  { brand: 'Chevrolet', model: 'Spin', aliases: ['spin', 'spin activ', 'spin premier'] },
  { brand: 'Chevrolet', model: 'Montana', aliases: ['montana', 'nova montana'] },
  { brand: 'Chevrolet', model: 'S10', aliases: ['s10', 's-10', 's10 high country', 's10 ltz'] },
  { brand: 'Chevrolet', model: 'Celta', aliases: ['celta', 'celtinha'] },
  { brand: 'Chevrolet', model: 'Corsa', aliases: ['corsa', 'classic', 'corsa classic', 'corsa wind', 'corsa sedan'] },
  { brand: 'Chevrolet', model: 'Cobalt', aliases: ['cobalt'] },
  { brand: 'Chevrolet', model: 'Agile', aliases: ['agile'] },
  { brand: 'Chevrolet', model: 'Astra', aliases: ['astra', 'vectra', 'meriva', 'zafira', 'kadett', 'monza', 'opala'] },
  { brand: 'Chevrolet', model: 'Equinox', aliases: ['equinox', 'trailblazer', 'captiva', 'camaro'] },

  // Fiat
  { brand: 'Fiat', model: 'Strada', aliases: ['strada', 'strada endurance', 'strada freedom', 'strada volcano', 'strada ranch', 'strada ultra'] },
  { brand: 'Fiat', model: 'Toro', aliases: ['toro', 'fiat toro', 'toro freedom', 'toro volcano', 'toro ranch', 'toro ultra'] },
  { brand: 'Fiat', model: 'Argo', aliases: ['argo', 'fiat argo', 'argo drive', 'argo trekking'] },
  { brand: 'Fiat', model: 'Cronos', aliases: ['cronos', 'fiat cronos'] },
  { brand: 'Fiat', model: 'Mobi', aliases: ['mobi', 'fiat mobi', 'mobi like', 'mobi trekking'] },
  { brand: 'Fiat', model: 'Pulse', aliases: ['pulse', 'fiat pulse', 'pulse audace', 'pulse impetus'] },
  { brand: 'Fiat', model: 'Fastback', aliases: ['fastback', 'fiat fastback'] },
  { brand: 'Fiat', model: 'Palio', aliases: ['palio', 'pálio', 'palio fire', 'palio weekend', 'palio attractive'] },
  { brand: 'Fiat', model: 'Uno', aliases: ['uno', 'uno mille', 'uno vivace', 'uno way', 'novo uno'] },
  { brand: 'Fiat', model: 'Siena', aliases: ['siena', 'grand siena', 'siena el'] },
  { brand: 'Fiat', model: 'Punto', aliases: ['fiat punto', 'punto', 'fiat bravo', 'fiat stilo', 'fiat linea', 'fiat idea', 'doblo', 'fiorino', 'ducato', 'titano', 'marea', 'tempra'] },

  // Volkswagen / VW
  { brand: 'Volkswagen', model: 'Gol', aliases: ['gol', 'gol g5', 'gol g6', 'gol g7', 'gol g4', 'gol trend'] },
  { brand: 'Volkswagen', model: 'Polo', aliases: ['polo', 'polo track', 'polo tsi', 'polo highline', 'polo comfortline'] },
  { brand: 'Volkswagen', model: 'Virtus', aliases: ['virtus', 'virtus tsi', 'virtus highline'] },
  { brand: 'Volkswagen', model: 'T-Cross', aliases: ['t-cross', 'tcross', 't cross'] },
  { brand: 'Volkswagen', model: 'Nivus', aliases: ['nivus', 'vw nivus', 'nivus highline'] },
  { brand: 'Volkswagen', model: 'Taos', aliases: ['taos', 'vw taos', 'tiguan'] },
  { brand: 'Volkswagen', model: 'Saveiro', aliases: ['saveiro', 'saveiro robust', 'saveiro cross'] },
  { brand: 'Volkswagen', model: 'Voyage', aliases: ['voyage', 'vw voyage'] },
  { brand: 'Volkswagen', model: 'Fox', aliases: ['fox', 'crossfox', 'spacefox'] },
  { brand: 'Volkswagen', model: 'Jetta', aliases: ['jetta', 'golf', 'up', 'vw up', 'amarok', 'passat', 'santana', 'parati', 'kombi', 'fusca'] },

  // Hyundai
  { brand: 'Hyundai', model: 'HB20', aliases: ['hb20', 'hb 20', 'hb20s', 'hb20x', 'hb20 sense', 'hb20 comfort', 'hb20 platinum'] },
  { brand: 'Hyundai', model: 'Creta', aliases: ['creta', 'hyundai creta', 'creta action', 'creta platinum'] },
  { brand: 'Hyundai', model: 'Tucson', aliases: ['tucson', 'ix35', 'ix 35', 'i30', 'azera', 'elantra', 'santa fe', 'veloster', 'hr'] },

  // Jeep
  { brand: 'Jeep', model: 'Compass', aliases: ['compass', 'jeep compass', 'compass longitude', 'compass limited'] },
  { brand: 'Jeep', model: 'Renegade', aliases: ['renegade', 'jeep renegade', 'renegade sport', 'renegade longitude'] },
  { brand: 'Jeep', model: 'Commander', aliases: ['commander', 'jeep commander', 'wrangler', 'cherokee'] },

  // Renault
  { brand: 'Renault', model: 'Kwid', aliases: ['kwid', 'renault kwid', 'kwid zen', 'kwid intense'] },
  { brand: 'Renault', model: 'Sandero', aliases: ['sandero', 'stepway', 'sandero stepway'] },
  { brand: 'Renault', model: 'Logan', aliases: ['logan', 'renault logan'] },
  { brand: 'Renault', model: 'Duster', aliases: ['duster', 'renault duster', 'oroch', 'duster oroch'] },
  { brand: 'Renault', model: 'Kardian', aliases: ['kardian', 'captur', 'megane', 'fluence', 'clio', 'master', 'scenic'] },

  // Nissan
  { brand: 'Nissan', model: 'Kicks', aliases: ['kicks', 'nissan kicks', 'kicks active', 'kicks advance'] },
  { brand: 'Nissan', model: 'Versa', aliases: ['versa', 'nissan versa', 'v-drive'] },
  { brand: 'Nissan', model: 'Sentra', aliases: ['sentra', 'march', 'frontier', 'livina', 'tiida'] },

  // Ford
  { brand: 'Ford', model: 'Ka', aliases: ['ka', 'ford ka', 'ka sedan', 'ka+'] },
  { brand: 'Ford', model: 'EcoSport', aliases: ['ecosport', 'eco sport', 'ford ecosport'] },
  { brand: 'Ford', model: 'Ranger', aliases: ['ranger', 'ford ranger', 'maverick', 'f-250', 'f250'] },
  { brand: 'Ford', model: 'Fiesta', aliases: ['fiesta', 'new fiesta', 'focus', 'fusion', 'territory', 'bronco', 'edge', 'escort'] },

  // BYD / GWM / Caoa Chery
  { brand: 'BYD', model: 'Dolphin', aliases: ['dolphin', 'dolphin mini', 'byd dolphin'] },
  { brand: 'BYD', model: 'Song Plus', aliases: ['song plus', 'song pro', 'byd song', 'yuan plus', 'byd king', 'seal', 'shark'] },
  { brand: 'GWM', model: 'Haval H6', aliases: ['haval', 'haval h6', 'ora 03'] },
  { brand: 'Caoa Chery', model: 'Tiggo 5x', aliases: ['tiggo', 'tiggo 5x', 'tiggo 7', 'tiggo 8', 'tiggo 3x', 'tiggo 2', 'arrizo 6', 'icar'] },

  // Peugeot / Citroën / Mitsubishi / Yamaha / Outros
  { brand: 'Peugeot', model: '208', aliases: ['peugeot 208', '208', '2008', '3008', '207', '206', '307', '308', '408', 'partner', 'expert'] },
  { brand: 'Citroën', model: 'C3', aliases: ['c3', 'citroen c3', 'c4 cactus', 'cactus', 'c4 lounge', 'aircross', 'xsara', 'jumpy', 'jumper'] },
  { brand: 'Mitsubishi', model: 'L200 Triton', aliases: ['l200', 'triton', 'l200 triton', 'pajero', 'pajero tr4', 'asx', 'eclipse cross', 'outlander', 'lancer'] },
  { brand: 'Yamaha', model: 'Fazer 250', aliases: ['yamaha fazer', 'fazer 250', 'fz25', 'fz 25', 'fz15', 'fz 15', 'fazer 150', 'factor 150', 'factor 125', 'lander 250', 'xtz 250 lander', 'crosser 150', 'yamaha crosser', 'nmax', 'nmax 160', 'xmax', 'mt-03', 'mt03'] },
  { brand: 'Ram', model: 'Rampage', aliases: ['rampage', 'ram 1500', 'ram 2500'] },
  { brand: 'Kia', model: 'Sportage', aliases: ['sportage', 'cerato', 'picanto', 'soul', 'sorento', 'bongo'] },
  { brand: 'BMW', model: '320i', aliases: ['320i', 'bmw 320i', 'bmw x1', 'x1', 'x3', 'x5'] },
  { brand: 'Mercedes-Benz', model: 'C180', aliases: ['c180', 'c200', 'gla 200', 'sprinter'] },
  { brand: 'Audi', model: 'A3', aliases: ['audi a3', 'a3', 'q3', 'q5'] },
];

const KNOWN_BRANDS_REGEX =
  /\b(Honda|Toyota|Fiat|Volkswagen|VW|Chevrolet|GM|Hyundai|Jeep|Renault|Nissan|Ford|BYD|GWM|Caoa\s*Chery|Chery|Peugeot|Citro[eë]n|Mitsubishi|Yamaha|Kia|BMW|Mercedes|Audi|Volvo|Ram|Suzuki)\b/i;

export class AgentRouterService {
  private readonly sessions = new Map<string, SessionMemoryContext>();
  private readonly environment: 'teste' | 'homologacao' | 'producao';
  private readonly companyId: string;

  constructor(options?: { environment?: 'teste' | 'homologacao' | 'producao'; companyId?: string }) {
    this.environment = options?.environment ?? 'teste';
    this.companyId = options?.companyId ?? 'bgr_beneficios';
  }

  /**
   * Processa uma mensagem do usuário mantendo memória por sessão, Slot-Filling contextual
   * e aplicando guardrails de segurança.
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

    // 5.5. Correção ou Indecisão de Veículo ("não escolhi o veículo ainda", "não é esse carro", "outro veículo", "estou pesquisando")
    if (
      /n[aã]o\s+escolhi|ainda\s+n[aã]o\s+(escolhi|comprei|tenho|sei\s+o\s+carro|sei\s+qual)|estou\s+(s[oó]\s+)?pesquisando|n[aã]o\s+[eé]\s+esse\s+(carro|ve[ií]culo|modelo)|n[aã]o\s+tenho\s+esse|outro\s+(carro|ve[ií]culo|modelo)|trocar\s+(o\s+)?(carro|ve[ií]culo)|ve[ií]culo\s+errado/i.test(
        text
      )
    ) {
      session.greeted = true;
      session.vehicle = {};
      session.expected_slot = 'vehicle_model';
      const firstName = session.lead.name ? `, ${session.lead.name.split(' ')[0]}` : '';
      return this.buildResult({
        session,
        intent: 'nova_cotacao',
        confidence: 0.96,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Sem problema algum${firstName}! Como você ainda está pesquisando ou quer simular outro veículo, podemos fazer a cotação de qualquer modelo que você tenha em mente para comparar os valores (por exemplo: *Onix 2022*, *HB20 2021*, *Corolla 2023* ou *CG 160 2023*). Qual modelo e ano você gostaria de simular primeiro?`,
        eventType: 'vehicle_selection_reset_or_undecided',
        severity: 'LOW',
        rawSummary: `Cliente informou que ainda não escolheu o veículo ou solicitou troca na sessão ${sessionId}.`,
      });
    }

    // 5.6. Caso o cliente diga "não sei o ano" / "qualquer ano" quando o agente perguntou o ano do veículo
    if (
      session.expected_slot === 'vehicle_year' &&
      session.vehicle.model &&
      /n[aã]o\s+sei\s+o\s+ano|qualquer\s+ano|tanto\s+faz(\s+o\s+ano)?|ainda\s+n[aã]o\s+sei/i.test(text)
    ) {
      session.vehicle.year = 2022;
      session.expected_slot = 'vehicle_usage';
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model} 2022`;
      return this.buildResult({
        session,
        intent: 'nova_cotacao',
        confidence: 0.95,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Combinado! Vou considerar o ano *2022* como referência para simular o seu ${carLabel}. Ele seria para uso particular (passeio/dia a dia) ou para aplicativo/comercial?`,
        eventType: 'vehicle_reference_year_assumed',
        severity: 'LOW',
        rawSummary: `Ano de referência 2022 assumido para simulação na sessão ${sessionId}.`,
      });
    }

    // Extrai entidades (Nome, Marca/Modelo, Ano, Uso e Cidade/UF) levando em conta o slot esperado!
    this.extractEntitiesFromText(text, session);

    // 6. Saudação Inicial apenas na 1ª mensagem da sessão (T01 vs T02)
    if (!session.greeted) {
      session.greeted = true;
      const nextPromptInfo = this.computeNextQualificationStep(session);
      session.expected_slot = nextPromptInfo.expectedSlot;

      if (nextPromptInfo.expectedSlot === 'completed') {
        return this.buildResult({
          session,
          intent: 'nova_cotacao',
          confidence: 0.97,
          nextAction: 'consultar_crm',
          securityBlocked: false,
          response: `Olá, ${session.lead.name}! Seja bem-vindo à BGR Benefícios! 🚗 Já identifiquei todos os dados do seu ${session.vehicle.brand} ${session.vehicle.model} (${session.vehicle.year}) e vou gerar sua cotação oficial agora mesmo.`,
          eventType: 'session_initial_greeting_sent',
          severity: 'LOW',
          rawSummary: `Saudação inicial com dados completos na sessão ${sessionId}.`,
        });
      }

      const greetingQuestion =
        nextPromptInfo.expectedSlot === 'name'
          ? 'Qual é o seu nome?'
          : `Prazer em falar com você${session.lead.name ? `, ${session.lead.name}` : ''}! ${nextPromptInfo.questionText}`;

      return this.buildResult({
        session,
        intent: 'saudacao_inicial',
        confidence: 0.97,
        nextAction: 'qualificar',
        securityBlocked: false,
        response: `Olá! Seja bem-vindo à BGR Benefícios! 🚗 Sou o assistente virtual comercial da BGR. Vou te ajudar a conhecer nossa proteção veicular e encontrar a melhor opção para seu veículo. ${greetingQuestion}`,
        eventType: 'session_initial_greeting_sent',
        severity: 'LOW',
        rawSummary: `Saudação inicial enviada na primeira interação da sessão ${sessionId} (T01).`,
      });
    }

    // 7. Verifica se o usuário fez uma dúvida de cobertura/benefícios (FAQ Comercial) durante a conversa
    const faqAnswer = this.matchKnowledgeBaseQuestion(text);
    const nextStep = this.computeNextQualificationStep(session);
    session.expected_slot = nextStep.expectedSlot;

    if (faqAnswer) {
      const followUp =
        nextStep.expectedSlot === 'completed'
          ? 'Já tenho todos os seus dados e posso apresentar sua cotação oficial!'
          : `Para eu já liberar o valor certinho para o seu perfil, ${nextStep.questionLower}`;

      return this.buildResult({
        session,
        intent: 'duvida_cobertura',
        confidence: 0.94,
        nextAction: nextStep.expectedSlot === 'completed' ? 'consultar_crm' : 'responder_base_conhecimento',
        securityBlocked: false,
        response: `${faqAnswer}\n\n${followUp}`,
        eventType: 'knowledge_base_faq_answered',
        severity: 'LOW',
        rawSummary: `Dúvida de cobertura/FAQ respondida na sessão ${sessionId}.`,
      });
    }

    // 8. Continuação progressiva da qualificação sem repetir perguntas já respondidas (T02 / T06)
    if (nextStep.expectedSlot === 'completed') {
      return this.buildResult({
        session,
        intent: 'nova_cotacao',
        confidence: 0.95,
        nextAction: 'consultar_crm',
        securityBlocked: false,
        response: `Obrigado pelas informações, ${session.lead.name}! Já tenho todos os dados do seu ${session.vehicle.brand ?? ''} ${session.vehicle.model ?? ''} (${session.vehicle.year}) e vou consultar o sistema oficial da BGR.`,
        eventType: 'session_progressive_qualification',
        severity: 'LOW',
        rawSummary: `Qualificação concluída na sessão ${sessionId} -> consultar_crm.`,
      });
    }

    // Monta confirmação contextual do que acabou de ser entendido para a conversa soar 100% natural
    const ackPrefix = this.buildContextualAcknowledgment(session, nextStep.expectedSlot);

    return this.buildResult({
      session,
      intent: 'nova_cotacao',
      confidence: 0.93,
      nextAction: 'qualificar',
      securityBlocked: false,
      response: `${ackPrefix}${nextStep.questionLower}`,
      eventType: 'session_progressive_qualification',
      severity: 'LOW',
      rawSummary: `Continuação de atendimento (aguardando: ${nextStep.expectedSlot}) na sessão ${sessionId} (T02/T06).`,
    });
  }

  private computeNextQualificationStep(session: SessionMemoryContext): {
    expectedSlot: ExpectedQualificationSlot;
    questionText: string;
    questionLower: string;
  } {
    if (!session.lead.name) {
      return {
        expectedSlot: 'name',
        questionText: 'Qual é o seu nome?',
        questionLower: 'qual é o seu nome?',
      };
    }
    if (!session.vehicle.model) {
      return {
        expectedSlot: 'vehicle_model',
        questionText: 'Qual é o modelo e o ano do veículo que você gostaria de proteger (ex.: Onix 2022, Corolla 2021, Palio 2018)?',
        questionLower: 'qual é o modelo e o ano do seu veículo (ex.: Onix 2022, HB20 2021, Civic 2022)?',
      };
    }
    if (!session.vehicle.year) {
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model}`;
      return {
        expectedSlot: 'vehicle_year',
        questionText: `Qual é o ano do seu ${carLabel} (ex.: 2020, 2022)?`,
        questionLower: `qual é o ano do seu ${carLabel} (ex.: 2020, 2022)?`,
      };
    }
    if (!session.vehicle.usage) {
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model} ${session.vehicle.year}`;
      return {
        expectedSlot: 'vehicle_usage',
        questionText: `O seu ${carLabel} é utilizado para uso particular/passeio ou para aplicativo/comercial?`,
        questionLower: `o seu ${carLabel} é para uso particular (passeio/dia a dia) ou você utiliza para aplicativo/comercial?`,
      };
    }
    if (!session.lead.city_uf) {
      return {
        expectedSlot: 'city_uf',
        questionText: 'Em qual cidade e estado o veículo circula?',
        questionLower: 'em qual cidade (e estado) o veículo circula principalmente?',
      };
    }
    return {
      expectedSlot: 'completed',
      questionText: '',
      questionLower: '',
    };
  }

  private buildContextualAcknowledgment(
    session: SessionMemoryContext,
    nextSlot: ExpectedQualificationSlot
  ): string {
    const firstName = session.lead.name ? session.lead.name.split(' ')[0] : '';
    const carLabel = session.vehicle.model
      ? `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model}${session.vehicle.year ? ` ${session.vehicle.year}` : ''}`
      : '';

    if (nextSlot === 'vehicle_model' && firstName) {
      return `Prazer, ${firstName}! Para avançarmos com a sua cotação oficial na BGR, `;
    }
    if (nextSlot === 'vehicle_year' && carLabel) {
      return `Excelente veículo (${carLabel})${firstName ? `, ${firstName}` : ''}! Para consultar a tabela correta, `;
    }
    if (nextSlot === 'vehicle_usage' && carLabel) {
      return `Perfeito${firstName ? `, ${firstName}` : ''}! Já anotei o seu ${carLabel}. Agora me conta: `;
    }
    if (nextSlot === 'city_uf' && session.vehicle.usage) {
      return `Ótimo, registrado como uso ${session.vehicle.usage}! Por último, `;
    }
    return `Perfeito${firstName ? `, ${firstName}` : ''}! Para avançarmos com a sua cotação oficial na BGR, `;
  }

  private matchKnowledgeBaseQuestion(text: string): string | null {
    if (/\b(guincho|assist[eê]ncia\s*24|reboque|chaveiro|pane)\b/i.test(text)) {
      return '🛠️ *Assistência 24h BGR*: Todos os nossos planos contam com assistência 24 horas em todo o território nacional (guincho/reboque, socorro elétrico/mecânico, troca de pneus, chaveiro e auxílio falta de combustível).';
    }
    if (/\b(spc|serasa|nome\s+sujo|restri[cç][aã]o|consulta\s+cpf|perfil\s+de\s+condutor)\b/i.test(text)) {
      return '✅ *Sem Burocracia*: Na BGR Benefícios não fazemos consulta ao SPC/Serasa e não exigimos perfil de condutor principal (qualquer pessoa habilitada pode conduzir o veículo com segurança).';
    }
    if (/\b(cobre\s+o\s+qu[eê]|quais\s+(as\s+)?coberturas|roubo|furto|colis[aã]o|terceiros|inc[eê]ndio|granizo|alagamento)\b/i.test(text)) {
      return '🛡️ *Coberturas BGR Benefícios*: Oferecemos proteção completa até 100% da Tabela FIPE contra Roubo, Furto, Colisão, Perda Total, Incêndio e Fenômenos da Natureza, além de cobertura para Danos a Terceiros e Carro Reserva conforme o plano escolhido.';
    }
    if (/\b(vistoria|precisa\s+levar\s+o\s+carro|como\s+funciona\s+a\s+vistoria)\b/i.test(text)) {
      return '📸 *Vistoria Simplificada*: A vistoria prévia pode ser realizada de forma rápida (digital/guiada pelo celular ou presencial conforme a região) logo após a assinatura digital da proposta.';
    }
    return null;
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
    const cleanText = text.trim();
    if (!cleanText) return;

    // 1. Extração de Veículo (Catálogo Nacional FIPE + Marcas Explícitas + Slot Contextual)
    // Só busca no catálogo na 1ª mensagem ou na pergunta de nome se o usuário falar explicitamente de veículo/marca/ano
    const hasExplicitVehicleCue =
      Boolean(session.lead.name) ||
      session.expected_slot === 'vehicle_model' ||
      KNOWN_BRANDS_REGEX.test(cleanText) ||
      /\b(19[7-9]\d|20[0-2]\d|tenho\s+um|tenho\s+uma|meu\s+carro|minha\s+moto|meu\s+ve[ií]culo)\b/i.test(cleanText);

    const foundCatalogVehicle = hasExplicitVehicleCue ? this.findVehicleInCatalog(cleanText) : null;
    if (foundCatalogVehicle) {
      session.vehicle.brand = foundCatalogVehicle.brand;
      session.vehicle.model = foundCatalogVehicle.model;
    } else {
      // Tenta padrão "<Marca Conhecida> <Modelo>" (ex: "Fiat Tempra", "Chevrolet Opala", "VW Santana")
      const brandModelMatch = cleanText.match(
        /\b(Honda|Toyota|Fiat|Volkswagen|VW|Chevrolet|GM|Hyundai|Jeep|Renault|Nissan|Ford|BYD|GWM|Caoa\s*Chery|Chery|Peugeot|Citro[eë]n|Mitsubishi|Yamaha|Kia|BMW|Mercedes|Audi|Volvo|Ram|Suzuki)\s+([A-Za-z0-9À-ú-]+(?:\s+[A-Za-z0-9À-ú-]+)?)/i
      );
      if (brandModelMatch) {
        const rawBrand = brandModelMatch[1];
        const rawModel = brandModelMatch[2]
          .replace(/\b(19\d{2}|20\d{2}|particular|aplicativo|uber|ano|uso|em|de|do|da)\b.*$/i, '')
          .trim();
        if (rawModel && rawModel.length >= 2) {
          session.vehicle.brand = this.normalizeBrandName(rawBrand);
          session.vehicle.model = this.capitalizeWords(rawModel);
        }
      } else if (
        session.expected_slot === 'vehicle_model' &&
        !session.vehicle.model &&
        !/^(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|qual|quanto|como|onde|por\s+que|quero\s+falar)/i.test(cleanText)
      ) {
        // Fallback contextual: quando o agente acabou de perguntar "Qual é o modelo e o ano do seu veículo?",
        // aceita qualquer modelo digitado pelo usuário (ex: "Tempra 1998", "Verona", "Fusca 1985", "Gurgel")
        const strippedForModel = cleanText
          .replace(/(?:tenho\s+um|tenho\s+uma|meu\s+carro\s+[eé]\s+um|meu\s+ve[ií]culo\s+[eé]\s+um|[eé]\s+um|[eé]\s+uma)\s+/i, '')
          .replace(/\b(19\d{2}|20\d{2}|\d{2}\/\d{2})\b/g, '')
          .replace(/\b(ano|modelo|particular|aplicativo|passeio|uber)\b/gi, '')
          .replace(/[,.!?]/g, '')
          .trim();

        if (strippedForModel.length >= 2 && strippedForModel.length <= 32) {
          session.vehicle.brand = session.vehicle.brand ?? 'Veículo';
          session.vehicle.model = this.capitalizeWords(strippedForModel);
        }
      }
    }

    // 2. Extração de Ano do Veículo (4 dígitos 1970..2027, formato 2021/2022 ou 2 dígitos quando aguardando ano)
    const fourDigitYearMatch = cleanText.match(/\b(19[7-9]\d|20[0-2]\d)(?:\s*\/\s*(19[7-9]\d|20[0-2]\d|\d{2}))?\b/);
    if (fourDigitYearMatch) {
      const y1 = Number(fourDigitYearMatch[1]);
      const y2Raw = fourDigitYearMatch[2];
      if (y2Raw) {
        const y2 = y2Raw.length === 2 ? Number(`20${y2Raw}`) : Number(y2Raw);
        session.vehicle.year = y2 >= 1970 && y2 <= 2027 ? y2 : y1;
      } else {
        session.vehicle.year = y1;
      }
    } else if (
      (session.expected_slot === 'vehicle_year' || (session.vehicle.model && !session.vehicle.year)) &&
      /^(?:ano\s*)?([89]\d|[0-2]\d)$/i.test(cleanText)
    ) {
      const twoDigit = Number(cleanText.replace(/\D/g, ''));
      session.vehicle.year = twoDigit >= 70 ? 1900 + twoDigit : 2000 + twoDigit;
    }

    // 3. Extração do Tipo de Uso (particular vs. aplicativo)
    if (
      /\b(particular|passeio|pessoal|fam[ií]lia|dia\s+a\s+dia|casa\s+pro\s+trabalho|uso\s+pr[oó]prio|s[oó]\s+passeio|normal)\b/i.test(
        cleanText
      ) ||
      (session.expected_slot === 'vehicle_usage' && /^(1|sim,\s*particular|n[aã]o,\s*s[oó]\s*particular|n[aã]o)$/i.test(cleanText))
    ) {
      session.vehicle.usage = 'particular';
    } else if (
      /\b(aplicativo|app|uber|99|99pop|indrive|motorista|corrida|entrega|comercial|aluguel|t[aá]xi|taxi|frota)\b/i.test(
        cleanText
      ) ||
      (session.expected_slot === 'vehicle_usage' && /^(2|app|uber)$/i.test(cleanText))
    ) {
      session.vehicle.usage = 'aplicativo';
    }

    // 4. Extração de Cidade / UF
    const knownCityMatch = cleanText.match(
      /\b(Belo\s+Horizonte|BH|Contagem|Betim|Sete\s+Lagoas|Divin[oó]polis|Ipatinga|Uberl[aâ]ndia|Uberaba|Juiz\s+de\s+Fora|Montes\s+Claros|Governador\s+Valadares|Pouso\s+Alegre|Varginha|Lagoa\s+Santa|Nova\s+Lima|Santa\s+Luzia|Ribeir[aã]o\s+das\s+Neves|Ibirit[eé]|Sabar[aá]|Ouro\s+Preto|Patos\s+de\s+Minas|Po[cç]os\s+de\s+Caldas| Barbacena|Conselheiro\s+Lafaiete|Itabira|Araguari|Passos|Coronel\s+Fabriciano|Tim[oó]teo|Muria[eé]|Ituiutaba|Lavras|Ita[uú]na|Par[aá]\s+de\s+Minas|S[aã]o\s+Paulo|SP|Campinas|Guarulhos|Santos|Ribeir[aã]o\s+Preto|Sorocaba|Osasco|S[aã]o\s+Bernardo|Santo\s+Andr[eé]|S[aã]o\s+Jos[eé]\s+dos\s+Campos|Rio\s+de\s+Janeiro|RJ|Niter[oó]i|Duque\s+de\s+Caxias|Nova\s+Igua[cç]u|Curitiba|Londrina|Maring[aá]|Porto\s+Alegre|Caxias\s+do\s+Sul|Florian[oó]polis|Joinville|Blumenau|Bras[ií]lia|DF|Goi[aâ]nia|An[aá]polis|Salvador|Feira\s+de\s+Santana|Recife|Olinda|Fortaleza|Manaus|Bel[eé]m|Vit[oó]ria|Vila\s+Velha|Serra|Cariacica|Macei[oó]|Natal|Jo[aã]o\s+Pessoa|Teresina|S[aã]o\s+Lu[ií]s|Cuiab[aá]|Campo\s+Grande|Aracaju|Palmas|Porto\s+Velho|Macap[aá]|Boa\s+Vista|Rio\s+Branco)(?:\s*[/-]\s*([A-Z]{2}))?\b/i
    );
    if (knownCityMatch) {
      const rawCity = knownCityMatch[1].trim();
      const rawUf = knownCityMatch[2]?.toUpperCase();
      if (/^bh$/i.test(rawCity)) {
        session.lead.city_uf = 'Belo Horizonte/MG';
      } else if (/^sp$/i.test(rawCity)) {
        session.lead.city_uf = 'São Paulo/SP';
      } else if (/^rj$/i.test(rawCity)) {
        session.lead.city_uf = 'Rio de Janeiro/RJ';
      } else if (/^df$/i.test(rawCity)) {
        session.lead.city_uf = 'Brasília/DF';
      } else {
        session.lead.city_uf = rawUf ? `${this.capitalizeWords(rawCity)}/${rawUf}` : this.capitalizeWords(rawCity);
      }
    } else if (session.expected_slot === 'city_uf' && !session.lead.city_uf) {
      // Quando o agente acabou de perguntar a cidade, aceita qualquer cidade brasileira informada pelo usuário!
      const cleanedCity = cleanText
        .replace(/^(?:moro\s+em|sou\s+de|estou\s+em|fica\s+em|circula\s+em|cidade\s+de|em|na|no)\s+/i, '')
        .replace(/[,.!?]/g, '')
        .trim();
      if (cleanedCity.length >= 2 && cleanedCity.length <= 45) {
        session.lead.city_uf = this.capitalizeWords(cleanedCity);
      }
    }

    // 5. Extração de Nome do Cliente
    const explicitNameMatch = cleanText.match(
      /(?:meu\s+nome\s+[eé]|sou\s+o|sou\s+a|me\s+chamo|aqui\s+[eé]\s+o|aqui\s+[eé]\s+a)\s+([A-ZÀ-Úa-zà-ú]+(?:\s+[A-ZÀ-Úa-zà-ú]+){0,3})/i
    );
    if (explicitNameMatch && !session.lead.name) {
      const candidateName = explicitNameMatch[1]
        .replace(/\b(e\s+tenho|tenho\s+um|quero|gostaria)\b.*$/i, '')
        .trim();
      if (candidateName.length >= 2) {
        session.lead.name = this.capitalizeWords(candidateName);
      }
    } else if (
      (session.expected_slot === 'name' || (session.greeted && !session.lead.name)) &&
      !foundCatalogVehicle &&
      !KNOWN_BRANDS_REGEX.test(cleanText) &&
      !/^(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|quero|quanto|qual|voc[eê]|tenho|ignore|cobre|tem\s+guincho)/i.test(
        cleanText
      )
    ) {
      // Se o cliente respondeu diretamente o nome (ex: "Diego", "Diego Gomes", "Carlos, tenho um Onix")
      const firstPart = cleanText.split(/[,;-]|\s+e\s+tenho|\s+tenho\s+um/i)[0].trim();
      if (/^[A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,}){0,3}$/.test(firstPart)) {
        session.lead.name = this.capitalizeWords(firstPart);
      }
    }
  }

  private findVehicleInCatalog(text: string): { brand: string; model: string } | null {
    const normalizedText = this.stripAccents(text.toLowerCase());

    // Ordena aliases do mais longo para o mais curto para priorizar nomes compostos (ex: "Corolla Cross" antes de "Corolla", "Onix Plus" antes de "Onix")
    const candidates: Array<{ alias: string; brand: string; model: string }> = [];
    for (const entry of BRAZIL_VEHICLE_CATALOG) {
      for (const alias of entry.aliases) {
        candidates.push({
          alias: this.stripAccents(alias.toLowerCase()),
          brand: entry.brand,
          model: entry.model,
        });
      }
    }
    candidates.sort((a, b) => b.alias.length - a.alias.length);

    for (const item of candidates) {
      const escaped = item.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|\\b|\\s)${escaped}(?:\\b|\\s|$|[0-9,.!?])`, 'i');
      if (regex.test(normalizedText)) {
        return { brand: item.brand, model: item.model };
      }
    }
    return null;
  }

  private normalizeBrandName(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower === 'vw' || lower === 'volkswagen') return 'Volkswagen';
    if (lower === 'gm' || lower === 'chevrolet') return 'Chevrolet';
    if (lower.startsWith('citro')) return 'Citroën';
    if (lower.includes('chery')) return 'Caoa Chery';
    if (lower === 'byd') return 'BYD';
    if (lower === 'gwm') return 'GWM';
    if (lower === 'bmw') return 'BMW';
    return this.capitalizeWords(raw);
  }

  private stripAccents(str: string): string {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private capitalizeWords(str: string): string {
    return str
      .split(/\s+/)
      .map((w) => (w.length <= 2 && /^(de|da|do|e)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
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
