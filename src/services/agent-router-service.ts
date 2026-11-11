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
  | 'vehicle_plate'
  | 'vehicle_usage'
  | 'city_uf'
  | 'completed';

export interface SessionMemoryContext {
  session_id: string;
  channel_id: string;
  greeted: boolean;
  quotation_flow_started?: boolean;
  plate_asked?: boolean;
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
  // Honda (Carros)
  { brand: 'Honda', model: 'Civic', aliases: ['civic', 'new civic', 'civic touring', 'civic lxs', 'civic exl', 'civic ex', 'civic si'] },
  { brand: 'Honda', model: 'City', aliases: ['city', 'new city', 'city hatch', 'city hatchback', 'city sedan', 'city exl', 'city touring'] },
  { brand: 'Honda', model: 'Fit', aliases: ['fit', 'honda fit', 'fit ex', 'fit lx', 'fit twist'] },
  { brand: 'Honda', model: 'HR-V', aliases: ['hr-v', 'hrv', 'hr v', 'hr-v exl', 'hr-v touring'] },
  { brand: 'Honda', model: 'WR-V', aliases: ['wr-v', 'wrv', 'wr v'] },
  { brand: 'Honda', model: 'CR-V', aliases: ['cr-v', 'crv', 'cr v'] },
  { brand: 'Honda', model: 'ZR-V', aliases: ['zr-v', 'zrv', 'zr v'] },
  { brand: 'Honda', model: 'Accord', aliases: ['accord', 'honda accord'] },

  // Honda (Motos)
  { brand: 'Honda', model: 'CG 160', aliases: ['cg 160', 'cg160', 'titan 160', 'fan 160', 'start 160', 'cargo 160', 'cg titan', 'cg fan'] },
  { brand: 'Honda', model: 'CG 150', aliases: ['cg 150', 'cg150', 'titan 150', 'fan 150'] },
  { brand: 'Honda', model: 'CG 125', aliases: ['cg 125', 'cg125', 'fan 125', 'titan 125'] },
  { brand: 'Honda', model: 'Biz', aliases: ['biz', 'biz 125', 'biz 110', 'honda biz'] },
  { brand: 'Honda', model: 'Bros 160', aliases: ['bros', 'bros 160', 'nxr 160', 'bros 150', 'nxr 150'] },
  { brand: 'Honda', model: 'XRE 300', aliases: ['xre 300', 'xre300', 'xre'] },
  { brand: 'Honda', model: 'XRE 190', aliases: ['xre 190', 'xre190'] },
  { brand: 'Honda', model: 'Sahara 300', aliases: ['sahara 300', 'sahara', 'xre 300 sahara'] },
  { brand: 'Honda', model: 'PCX', aliases: ['pcx', 'pcx 160', 'pcx 150'] },
  { brand: 'Honda', model: 'ADV', aliases: ['honda adv', 'adv 150'] },
  { brand: 'Honda', model: 'Elite 125', aliases: ['elite 125', 'honda elite'] },
  { brand: 'Honda', model: 'Pop 110i', aliases: ['pop 110', 'pop 110i', 'pop 100'] },
  { brand: 'Honda', model: 'CB 300F Twister', aliases: ['cb 300', 'cb300', 'cb 300f', 'twister', 'cb twister', 'cb 250f'] },
  { brand: 'Honda', model: 'CB 500', aliases: ['cb 500', 'cb500', 'cb 500x', 'cb 500f'] },
  { brand: 'Honda', model: 'CB 600F Hornet', aliases: ['hornet', 'cb 600f', 'cb 650r', 'cb 650f'] },

  // Toyota
  { brand: 'Toyota', model: 'Corolla', aliases: ['corolla', 'corola', 'corolla xei', 'corolla gli', 'corolla altis', 'corolla gr-s'] },
  { brand: 'Toyota', model: 'Corolla Cross', aliases: ['corolla cross', 'corola cross', 'corolla cross xre', 'corolla cross xrx'] },
  { brand: 'Toyota', model: 'Hilux', aliases: ['hilux', 'hillux', 'hilux srv', 'hilux srx', 'hilux cd', 'hilux chassi'] },
  { brand: 'Toyota', model: 'SW4', aliases: ['sw4', 'hilux sw4', 'sw4 srx', 'sw4 diamond'] },
  { brand: 'Toyota', model: 'Yaris', aliases: ['yaris', 'yaris hatch', 'yaris sedan', 'yaris xl', 'yaris xs', 'yaris xls'] },
  { brand: 'Toyota', model: 'Etios', aliases: ['etios', 'etios hatch', 'etios sedan', 'etios cross'] },
  { brand: 'Toyota', model: 'RAV4', aliases: ['rav4', 'rav 4'] },
  { brand: 'Toyota', model: 'Camry', aliases: ['camry', 'prius'] },

  // Chevrolet / GM
  { brand: 'Chevrolet', model: 'Onix', aliases: ['onix', 'ônix', 'onix joy', 'onix lt', 'onix ltz', 'onix premier', 'onix turbo', 'onix rs'] },
  { brand: 'Chevrolet', model: 'Onix Plus', aliases: ['onix plus', 'ônix plus', 'novo prisma'] },
  { brand: 'Chevrolet', model: 'Prisma', aliases: ['prisma', 'prisma joy', 'prisma ltz', 'prisma lt'] },
  { brand: 'Chevrolet', model: 'Tracker', aliases: ['tracker', 'chevrolet tracker', 'tracker turbo', 'tracker premier', 'tracker ltz'] },
  { brand: 'Chevrolet', model: 'Cruze', aliases: ['cruze', 'cruze sport6', 'cruze ltz', 'cruze lt', 'cruze premier'] },
  { brand: 'Chevrolet', model: 'Spin', aliases: ['spin', 'spin activ', 'spin premier', 'spin ltz'] },
  { brand: 'Chevrolet', model: 'Montana', aliases: ['montana', 'nova montana', 'montana rs', 'montana premier'] },
  { brand: 'Chevrolet', model: 'S10', aliases: ['s10', 's-10', 's10 high country', 's10 ltz', 's10 z71', 's10 ls'] },
  { brand: 'Chevrolet', model: 'Celta', aliases: ['celta', 'celtinha', 'celta life', 'celta spirit', 'celta lt'] },
  { brand: 'Chevrolet', model: 'Classic', aliases: ['classic', 'corsa classic', 'gm classic'] },
  { brand: 'Chevrolet', model: 'Corsa', aliases: ['corsa', 'corsa wind', 'corsa sedan', 'corsa hatch', 'corsa maxx', 'corsa premium'] },
  { brand: 'Chevrolet', model: 'Cobalt', aliases: ['cobalt', 'cobalt ltz', 'cobalt elite'] },
  { brand: 'Chevrolet', model: 'Agile', aliases: ['agile', 'agile ltz'] },
  { brand: 'Chevrolet', model: 'Astra', aliases: ['astra', 'astra hatch', 'astra sedan', 'astra advantage'] },
  { brand: 'Chevrolet', model: 'Vectra', aliases: ['vectra', 'vectra gt', 'vectra elegance', 'vectra elite'] },
  { brand: 'Chevrolet', model: 'Meriva', aliases: ['meriva'] },
  { brand: 'Chevrolet', model: 'Zafira', aliases: ['zafira'] },
  { brand: 'Chevrolet', model: 'Kadett', aliases: ['kadett'] },
  { brand: 'Chevrolet', model: 'Monza', aliases: ['monza'] },
  { brand: 'Chevrolet', model: 'Opala', aliases: ['opala', 'diplomata', 'comodoro'] },
  { brand: 'Chevrolet', model: 'Equinox', aliases: ['equinox', 'equinox rs', 'equinox premier'] },
  { brand: 'Chevrolet', model: 'Trailblazer', aliases: ['trailblazer', 'trail blazer'] },
  { brand: 'Chevrolet', model: 'Captiva', aliases: ['captiva'] },
  { brand: 'Chevrolet', model: 'Camaro', aliases: ['camaro'] },

  // Fiat
  { brand: 'Fiat', model: 'Strada', aliases: ['strada', 'strada endurance', 'strada freedom', 'strada volcano', 'strada ranch', 'strada ultra', 'strada working'] },
  { brand: 'Fiat', model: 'Toro', aliases: ['toro', 'fiat toro', 'toro freedom', 'toro volcano', 'toro ranch', 'toro ultra', 'toro endurance'] },
  { brand: 'Fiat', model: 'Argo', aliases: ['argo', 'fiat argo', 'argo drive', 'argo trekking', 'argo hgt'] },
  { brand: 'Fiat', model: 'Cronos', aliases: ['cronos', 'fiat cronos', 'cronos drive', 'cronos precision'] },
  { brand: 'Fiat', model: 'Mobi', aliases: ['mobi', 'fiat mobi', 'mobi like', 'mobi trekking', 'mobi easy'] },
  { brand: 'Fiat', model: 'Pulse', aliases: ['pulse', 'fiat pulse', 'pulse drive', 'pulse audace', 'pulse impetus', 'pulse abarth'] },
  { brand: 'Fiat', model: 'Fastback', aliases: ['fastback', 'fiat fastback', 'fastback audace', 'fastback impetus', 'fastback abarth'] },
  { brand: 'Fiat', model: 'Palio', aliases: ['palio', 'pálio', 'palio fire', 'palio weekend', 'palio attractive', 'palio essence', 'palio sporting'] },
  { brand: 'Fiat', model: 'Uno', aliases: ['uno', 'uno mille', 'uno vivace', 'uno way', 'novo uno', 'uno attractive', 'uno sporting'] },
  { brand: 'Fiat', model: 'Siena', aliases: ['siena', 'siena el', 'siena fire'] },
  { brand: 'Fiat', model: 'Grand Siena', aliases: ['grand siena', 'grandsiena', 'grand siena attractive', 'grand siena essence'] },
  { brand: 'Fiat', model: 'Punto', aliases: ['fiat punto', 'punto', 'punto attractive', 'punto essence', 'punto sporting', 'punto t-jet'] },
  { brand: 'Fiat', model: 'Bravo', aliases: ['fiat bravo', 'bravo essence', 'bravo sporting', 'bravo t-jet'] },
  { brand: 'Fiat', model: 'Stilo', aliases: ['fiat stilo', 'stilo'] },
  { brand: 'Fiat', model: 'Linea', aliases: ['fiat linea', 'linea'] },
  { brand: 'Fiat', model: 'Idea', aliases: ['fiat idea', 'idea adventure', 'idea attractive'] },
  { brand: 'Fiat', model: 'Doblo', aliases: ['doblo', 'doblò', 'doblo adventure', 'doblo essence', 'doblo cargo'] },
  { brand: 'Fiat', model: 'Fiorino', aliases: ['fiorino', 'fiat fiorino', 'fiorino furgao', 'fiorino endurance'] },
  { brand: 'Fiat', model: 'Ducato', aliases: ['ducato', 'fiat ducato'] },
  { brand: 'Fiat', model: 'Titano', aliases: ['titano', 'fiat titano'] },
  { brand: 'Fiat', model: 'Marea', aliases: ['marea'] },
  { brand: 'Fiat', model: 'Tempra', aliases: ['tempra'] },

  // Volkswagen / VW (Cada modelo individualizado sem jamais misturar Golf com Jetta ou Taos com Tiguan)
  { brand: 'Volkswagen', model: 'Gol', aliases: ['gol', 'gol g5', 'gol g6', 'gol g7', 'gol g8', 'gol g4', 'gol g3', 'gol trend', 'gol msi', 'gol power', 'gol city'] },
  { brand: 'Volkswagen', model: 'Golf', aliases: ['golf', 'vw golf', 'golf gti', 'golf highline', 'golf comfortline', 'golf sportline', 'golf tsi', 'golf gte', 'golf variant', 'golf flash'] },
  { brand: 'Volkswagen', model: 'Jetta', aliases: ['jetta', 'vw jetta', 'jetta gli', 'jetta tsi', 'jetta comfortline', 'jetta highline', 'jetta r-line', 'jetta variant'] },
  { brand: 'Volkswagen', model: 'Polo', aliases: ['polo', 'polo track', 'polo tsi', 'polo highline', 'polo comfortline', 'polo gts', 'polo mpi', 'polo sedan'] },
  { brand: 'Volkswagen', model: 'Virtus', aliases: ['virtus', 'virtus tsi', 'virtus highline', 'virtus comfortline', 'virtus exclusive', 'virtus gts'] },
  { brand: 'Volkswagen', model: 'T-Cross', aliases: ['t-cross', 'tcross', 't cross', 't-cross highline', 't-cross comfortline', 't-cross sense'] },
  { brand: 'Volkswagen', model: 'Nivus', aliases: ['nivus', 'vw nivus', 'nivus highline', 'nivus comfortline'] },
  { brand: 'Volkswagen', model: 'Taos', aliases: ['taos', 'vw taos', 'taos highline', 'taos comfortline'] },
  { brand: 'Volkswagen', model: 'Tiguan', aliases: ['tiguan', 'vw tiguan', 'tiguan allspace', 'tiguan r-line'] },
  { brand: 'Volkswagen', model: 'Saveiro', aliases: ['saveiro', 'saveiro robust', 'saveiro cross', 'saveiro trendline', 'saveiro surf', 'saveiro trooper'] },
  { brand: 'Volkswagen', model: 'Voyage', aliases: ['voyage', 'vw voyage', 'voyage msi', 'voyage trend'] },
  { brand: 'Volkswagen', model: 'Fox', aliases: ['fox', 'vw fox', 'fox connect', 'fox xtreme', 'fox trend', 'fox prime', 'fox rock in rio'] },
  { brand: 'Volkswagen', model: 'CrossFox', aliases: ['crossfox', 'cross fox'] },
  { brand: 'Volkswagen', model: 'SpaceFox', aliases: ['spacefox', 'space fox', 'spacecross'] },
  { brand: 'Volkswagen', model: 'Up', aliases: ['vw up', 'up tsi', 'move up', 'take up', 'high up', 'cross up', 'up!'] },
  { brand: 'Volkswagen', model: 'Amarok', aliases: ['amarok', 'vw amarok', 'amarok v6', 'amarok highline', 'amarok extreme'] },
  { brand: 'Volkswagen', model: 'Passat', aliases: ['passat', 'vw passat'] },
  { brand: 'Volkswagen', model: 'Santana', aliases: ['santana', 'vw santana'] },
  { brand: 'Volkswagen', model: 'Parati', aliases: ['parati', 'vw parati'] },
  { brand: 'Volkswagen', model: 'Kombi', aliases: ['kombi', 'vw kombi'] },
  { brand: 'Volkswagen', model: 'Fusca', aliases: ['fusca', 'vw fusca', 'new beetle'] },
  { brand: 'Volkswagen', model: 'Bora', aliases: ['bora', 'vw bora'] },

  // Hyundai
  { brand: 'Hyundai', model: 'HB20', aliases: ['hb20', 'hb 20', 'hb20 sense', 'hb20 comfort', 'hb20 platinum', 'hb20 vision', 'hb20 evolution'] },
  { brand: 'Hyundai', model: 'HB20S', aliases: ['hb20s', 'hb 20s', 'hb20 sedan'] },
  { brand: 'Hyundai', model: 'HB20X', aliases: ['hb20x', 'hb 20x'] },
  { brand: 'Hyundai', model: 'Creta', aliases: ['creta', 'hyundai creta', 'creta action', 'creta platinum', 'creta limited', 'creta prestige', 'creta pulse'] },
  { brand: 'Hyundai', model: 'Tucson', aliases: ['tucson', 'new tucson', 'hyundai tucson'] },
  { brand: 'Hyundai', model: 'ix35', aliases: ['ix35', 'ix 35', 'hyundai ix35'] },
  { brand: 'Hyundai', model: 'i30', aliases: ['i30', 'hyundai i30'] },
  { brand: 'Hyundai', model: 'Azera', aliases: ['azera', 'hyundai azera'] },
  { brand: 'Hyundai', model: 'Elantra', aliases: ['elantra', 'hyundai elantra'] },
  { brand: 'Hyundai', model: 'Santa Fe', aliases: ['santa fe', 'santafe', 'hyundai santa fe'] },
  { brand: 'Hyundai', model: 'Veloster', aliases: ['veloster'] },
  { brand: 'Hyundai', model: 'HR', aliases: ['hyundai hr', 'caminhao hr'] },

  // Jeep
  { brand: 'Jeep', model: 'Compass', aliases: ['compass', 'jeep compass', 'compass longitude', 'compass limited', 'compass sport', 'compass serie s', 'compass trailhawk'] },
  { brand: 'Jeep', model: 'Renegade', aliases: ['renegade', 'jeep renegade', 'renegade sport', 'renegade longitude', 'renegade moab', 'renegade trailhawk'] },
  { brand: 'Jeep', model: 'Commander', aliases: ['commander', 'jeep commander', 'commander limited', 'commander overland'] },
  { brand: 'Jeep', model: 'Wrangler', aliases: ['wrangler', 'jeep wrangler'] },
  { brand: 'Jeep', model: 'Grand Cherokee', aliases: ['cherokee', 'grand cherokee'] },

  // Renault
  { brand: 'Renault', model: 'Kwid', aliases: ['kwid', 'renault kwid', 'kwid zen', 'kwid intense', 'kwid outsider'] },
  { brand: 'Renault', model: 'Sandero', aliases: ['sandero', 'renault sandero', 'sandero stepway', 'stepway', 'sandero expression', 'sandero autentic'] },
  { brand: 'Renault', model: 'Logan', aliases: ['logan', 'renault logan'] },
  { brand: 'Renault', model: 'Duster', aliases: ['duster', 'renault duster', 'duster iconic', 'duster intense', 'duster dynamique'] },
  { brand: 'Renault', model: 'Oroch', aliases: ['oroch', 'duster oroch', 'renault oroch'] },
  { brand: 'Renault', model: 'Kardian', aliases: ['kardian', 'renault kardian'] },
  { brand: 'Renault', model: 'Captur', aliases: ['captur', 'renault captur'] },
  { brand: 'Renault', model: 'Fluence', aliases: ['fluence', 'renault fluence'] },
  { brand: 'Renault', model: 'Megane', aliases: ['megane', 'mégane'] },
  { brand: 'Renault', model: 'Clio', aliases: ['clio', 'renault clio'] },
  { brand: 'Renault', model: 'Scenic', aliases: ['scenic', 'scénic'] },
  { brand: 'Renault', model: 'Master', aliases: ['renault master', 'master furgao'] },

  // Nissan
  { brand: 'Nissan', model: 'Kicks', aliases: ['kicks', 'nissan kicks', 'kicks active', 'kicks advance', 'kicks exclusive', 'kicks sense', 'kicks sv', 'kicks sl'] },
  { brand: 'Nissan', model: 'Versa', aliases: ['versa', 'nissan versa', 'v-drive'] },
  { brand: 'Nissan', model: 'Sentra', aliases: ['sentra', 'nissan sentra'] },
  { brand: 'Nissan', model: 'March', aliases: ['march', 'nissan march'] },
  { brand: 'Nissan', model: 'Frontier', aliases: ['frontier', 'nissan frontier', 'frontier attack', 'frontier xe', 'frontier le'] },
  { brand: 'Nissan', model: 'Livina', aliases: ['livina', 'grand livina'] },
  { brand: 'Nissan', model: 'Tiida', aliases: ['tiida', 'nissan tiida'] },

  // Ford
  { brand: 'Ford', model: 'Ka', aliases: ['ka', 'ford ka', 'ka sedan', 'ka+', 'ka se', 'ka sel', 'ka freestyle'] },
  { brand: 'Ford', model: 'EcoSport', aliases: ['ecosport', 'eco sport', 'ford ecosport', 'ecosport freestyle', 'ecosport titanium', 'ecosport se'] },
  { brand: 'Ford', model: 'Ranger', aliases: ['ranger', 'ford ranger', 'ranger xlt', 'ranger limited', 'ranger xls'] },
  { brand: 'Ford', model: 'Maverick', aliases: ['maverick', 'ford maverick'] },
  { brand: 'Ford', model: 'F-250', aliases: ['f-250', 'f250', 'f-150', 'f150'] },
  { brand: 'Ford', model: 'Fiesta', aliases: ['fiesta', 'new fiesta', 'fiesta rocam', 'fiesta sedan', 'fiesta hatch'] },
  { brand: 'Ford', model: 'Focus', aliases: ['focus', 'ford focus', 'focus hatch', 'focus sedan', 'focus titanium'] },
  { brand: 'Ford', model: 'Fusion', aliases: ['fusion', 'ford fusion', 'fusion titanium'] },
  { brand: 'Ford', model: 'Territory', aliases: ['territory', 'ford territory'] },
  { brand: 'Ford', model: 'Bronco Sport', aliases: ['bronco', 'bronco sport', 'ford bronco'] },
  { brand: 'Ford', model: 'Edge', aliases: ['ford edge', 'edge'] },
  { brand: 'Ford', model: 'Escort', aliases: ['escort'] },

  // BYD / GWM / Caoa Chery
  { brand: 'BYD', model: 'Dolphin Mini', aliases: ['dolphin mini', 'byd dolphin mini'] },
  { brand: 'BYD', model: 'Dolphin', aliases: ['dolphin', 'byd dolphin', 'dolphin plus'] },
  { brand: 'BYD', model: 'Song Plus', aliases: ['song plus', 'song pro', 'byd song', 'song plus dm-i'] },
  { brand: 'BYD', model: 'Yuan Plus', aliases: ['yuan plus', 'yuan pro', 'byd yuan'] },
  { brand: 'BYD', model: 'King', aliases: ['byd king', 'king dm-i'] },
  { brand: 'BYD', model: 'Seal', aliases: ['byd seal'] },
  { brand: 'BYD', model: 'Shark', aliases: ['byd shark'] },
  { brand: 'GWM', model: 'Haval H6', aliases: ['haval', 'haval h6', 'h6 hev', 'h6 phev', 'h6 gt'] },
  { brand: 'GWM', model: 'Ora 03', aliases: ['ora 03', 'gwm ora'] },
  { brand: 'Caoa Chery', model: 'Tiggo 5x', aliases: ['tiggo 5x', 'tiggo 5x pro', 'tiggo 5x sport'] },
  { brand: 'Caoa Chery', model: 'Tiggo 7', aliases: ['tiggo 7', 'tiggo 7 pro', 'tiggo 7 sport'] },
  { brand: 'Caoa Chery', model: 'Tiggo 8', aliases: ['tiggo 8', 'tiggo 8 pro'] },
  { brand: 'Caoa Chery', model: 'Tiggo 3x', aliases: ['tiggo 3x', 'tiggo 2', 'tiggo'] },
  { brand: 'Caoa Chery', model: 'Arrizo 6', aliases: ['arrizo 6', 'arrizo 5', 'icar'] },

  // Peugeot (Sem números de 4 dígitos isolados como '2008' ou '3008' para NUNCA confundir o ano 2008 de um Uno/Gol/Palio com Peugeot 2008!)
  { brand: 'Peugeot', model: '208', aliases: ['peugeot 208', 'novo 208', '208 active', '208 allure', '208 griffe', '208 style', '208 like'] },
  { brand: 'Peugeot', model: '2008', aliases: ['peugeot 2008', 'novo 2008', '2008 allure', '2008 griffe', '2008 thp'] },
  { brand: 'Peugeot', model: '3008', aliases: ['peugeot 3008', 'novo 3008', '3008 griffe'] },
  { brand: 'Peugeot', model: '207', aliases: ['peugeot 207', '207 passion', '207 quiksilver'] },
  { brand: 'Peugeot', model: '206', aliases: ['peugeot 206'] },
  { brand: 'Peugeot', model: '308', aliases: ['peugeot 308', 'peugeot 307', 'peugeot 408'] },
  { brand: 'Peugeot', model: 'Partner', aliases: ['peugeot partner', 'partner', 'peugeot expert', 'expert'] },
  { brand: 'Fiat', model: 'Tempra', aliases: ['tempra', 'fiat tempra'] },
  { brand: 'Ford', model: 'Verona', aliases: ['verona', 'ford verona'] },
  { brand: 'Chevrolet', model: 'Monza', aliases: ['monza', 'kadett', 'opala', 'chevette'] },

  // Citroën
  { brand: 'Citroën', model: 'C3', aliases: ['c3', 'citroen c3', 'novo c3', 'c3 live', 'c3 feel'] },
  { brand: 'Citroën', model: 'C4 Cactus', aliases: ['c4 cactus', 'cactus', 'citroen cactus'] },
  { brand: 'Citroën', model: 'C4 Lounge', aliases: ['c4 lounge', 'c4 pallas', 'c4 hatch'] },
  { brand: 'Citroën', model: 'Aircross', aliases: ['aircross', 'c3 aircross', 'xsara picasso'] },
  { brand: 'Citroën', model: 'Jumpy', aliases: ['citroen jumpy', 'jumpy', 'citroen jumper', 'jumper'] },

  // Mitsubishi
  { brand: 'Mitsubishi', model: 'L200 Triton', aliases: ['l200', 'triton', 'l200 triton', 'l200 outdoor', 'l200 savana'] },
  { brand: 'Mitsubishi', model: 'Pajero', aliases: ['pajero', 'pajero sport', 'pajero full', 'pajero dakar', 'pajero tr4', 'tr4'] },
  { brand: 'Mitsubishi', model: 'ASX', aliases: ['asx', 'mitsubishi asx'] },
  { brand: 'Mitsubishi', model: 'Eclipse Cross', aliases: ['eclipse cross', 'mitsubishi eclipse'] },
  { brand: 'Mitsubishi', model: 'Outlander', aliases: ['outlander', 'mitsubishi outlander'] },
  { brand: 'Mitsubishi', model: 'Lancer', aliases: ['lancer', 'mitsubishi lancer'] },

  // Yamaha (Motos)
  { brand: 'Yamaha', model: 'Fazer 250', aliases: ['yamaha fazer', 'fazer 250', 'fz25', 'fz 25'] },
  { brand: 'Yamaha', model: 'Fazer 150', aliases: ['fazer 150', 'fz15', 'fz 15'] },
  { brand: 'Yamaha', model: 'Factor 150', aliases: ['factor 150', 'factor 125', 'ybr factor', 'factor'] },
  { brand: 'Yamaha', model: 'Lander 250', aliases: ['lander 250', 'xtz 250 lander', 'lander'] },
  { brand: 'Yamaha', model: 'Crosser 150', aliases: ['crosser 150', 'yamaha crosser', 'crosser'] },
  { brand: 'Yamaha', model: 'NMax 160', aliases: ['nmax', 'nmax 160', 'xmax'] },
  { brand: 'Yamaha', model: 'MT-03', aliases: ['mt-03', 'mt03', 'mt-07', 'mt07'] },

  // Outras Marcas (Ram, Kia, BMW, Mercedes-Benz, Audi, Volvo, Suzuki, Land Rover, Iveco)
  { brand: 'Ram', model: 'Rampage', aliases: ['rampage', 'ram rampage'] },
  { brand: 'Ram', model: '2500', aliases: ['ram 2500', 'ram 1500', 'ram 3500'] },
  { brand: 'Kia', model: 'Sportage', aliases: ['sportage', 'kia sportage'] },
  { brand: 'Kia', model: 'Cerato', aliases: ['cerato', 'kia cerato'] },
  { brand: 'Kia', model: 'Picanto', aliases: ['picanto', 'kia picanto'] },
  { brand: 'Kia', model: 'Soul', aliases: ['kia soul', 'sorento'] },
  { brand: 'Kia', model: 'Bongo', aliases: ['kia bongo', 'bongo k2500'] },
  { brand: 'BMW', model: '320i', aliases: ['320i', 'bmw 320i', '328i'] },
  { brand: 'BMW', model: 'X1', aliases: ['bmw x1', 'x1', 'bmw x3', 'x3', 'bmw x5', 'x5'] },
  { brand: 'Mercedes-Benz', model: 'C 180', aliases: ['c180', 'c 180', 'c200', 'c 200', 'gla 200'] },
  { brand: 'Mercedes-Benz', model: 'Sprinter', aliases: ['sprinter', 'mercedes sprinter'] },
  { brand: 'Audi', model: 'A3', aliases: ['audi a3', 'a3', 'audi a4'] },
  { brand: 'Audi', model: 'Q3', aliases: ['audi q3', 'q3', 'audi q5', 'q5'] },
  { brand: 'Volvo', model: 'XC60', aliases: ['xc60', 'volvo xc60', 'xc40', 'xc90'] },
  { brand: 'Suzuki', model: 'Jimny', aliases: ['jimny', 'jimny sierra', 'vitara'] },
  { brand: 'Land Rover', model: 'Evoque', aliases: ['evoque', 'range rover evoque', 'discovery', 'defender'] },
  { brand: 'Iveco', model: 'Daily', aliases: ['iveco daily', 'daily'] },
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

    // Se o cliente pediu cotação explicitamente, marca o início do fluxo de cotação pelo veículo
    if (
      /\b(cota[cç][aã]o|cotar|or[cç]amento|simular|simula[cç][aã]o|quanto\s+fica|quanto\s+custa|proteger\s+meu|seguro)\b/i.test(
        text
      )
    ) {
      session.quotation_flow_started = true;
    }

    // Extrai entidades (Marca/Modelo, Ano, Placa, Uso, Cidade/UF e Nome) levando em conta o slot esperado!
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
    // Se o cliente apenas deu "Olá"/"Oi" sem pedir cotação e sem informar veículo ainda, pergunta o nome primeiro (T01).
    // Se o cliente pediu cotação ("quero fazer uma cotação") ou já informou o nome/veículo, segue a ordem exata:
    // 1. Marca e modelo com ano -> 2. Placa do veículo -> 3. Fluxo de cotar na FIPE (Uso -> Cidade/UF -> Nome se faltar -> Cotação FIPE)
    if (!session.lead.name && !session.quotation_flow_started && !session.vehicle.model) {
      return {
        expectedSlot: 'name',
        questionText: 'Qual é o seu nome?',
        questionLower: 'qual é o seu nome?',
      };
    }
    if (!session.vehicle.model) {
      return {
        expectedSlot: 'vehicle_model',
        questionText:
          'Para iniciarmos sua cotação na Tabela FIPE, qual é a *marca, o modelo e o ano* do seu veículo (ex.: Fiat Uno 2008, VW Golf 2018, Chevrolet Onix 2022)?',
        questionLower:
          'qual é a *marca, o modelo e o ano* do seu veículo (ex.: Fiat Uno 2008, VW Golf 2018, Chevrolet Onix 2022)?',
      };
    }
    if (!session.vehicle.year) {
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model}`;
      return {
        expectedSlot: 'vehicle_year',
        questionText: `Qual é o ano do seu ${carLabel} (ex.: 2008, 2018, 2022)?`,
        questionLower: `qual é o ano do seu ${carLabel} (ex.: 2008, 2018, 2022)?`,
      };
    }
    if (!session.plate_asked && !session.vehicle.plate_masked) {
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model} ${session.vehicle.year}`;
      return {
        expectedSlot: 'vehicle_plate',
        questionText: `Qual é a *placa* do seu ${carLabel} (ex.: ABC-1234 ou ABC1D23) para buscarmos a versão exata na Tabela FIPE? (Se não tiver a placa agora, pode responder *sem placa*).`,
        questionLower: `qual é a *placa* do seu ${carLabel} (ex.: ABC-1234 ou ABC1D23) para buscarmos a versão exata na Tabela FIPE? (Se não tiver a placa agora, pode responder *sem placa*).`,
      };
    }
    if (!session.vehicle.usage) {
      const carLabel = `${session.vehicle.brand ? `${session.vehicle.brand} ` : ''}${session.vehicle.model} ${session.vehicle.year}`;
      const plateNote = session.vehicle.plate_masked ? ` (Placa *${session.vehicle.plate_masked}*)` : '';
      return {
        expectedSlot: 'vehicle_usage',
        questionText: `O seu ${carLabel}${plateNote} é utilizado para uso particular/passeio ou para aplicativo/comercial?`,
        questionLower: `o seu ${carLabel}${plateNote} é para uso particular (passeio/dia a dia) ou você utiliza para aplicativo/comercial?`,
      };
    }
    if (!session.lead.city_uf) {
      return {
        expectedSlot: 'city_uf',
        questionText: 'Em qual cidade e estado o veículo circula?',
        questionLower: 'em qual cidade (e estado) o veículo circula principalmente?',
      };
    }
    if (!session.lead.name) {
      return {
        expectedSlot: 'name',
        questionText: 'Para emitirmos sua cotação oficial da Tabela FIPE, qual é o seu nome?',
        questionLower: 'qual é o seu nome para emitirmos sua cotação oficial da Tabela FIPE?',
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
    if (nextSlot === 'vehicle_plate' && carLabel) {
      return `Perfeito${firstName ? `, ${firstName}` : ''}! Já identifiquei o seu *${carLabel}*. Agora, `;
    }
    if (nextSlot === 'vehicle_usage' && carLabel) {
      const plateAck = session.vehicle.plate_masked
        ? `Placa *${session.vehicle.plate_masked}* registrada para o seu ${carLabel}`
        : `Tudo certo com o seu ${carLabel}`;
      return `Perfeito${firstName ? `, ${firstName}` : ''}! ${plateAck}. Agora me conta sobre a cotação na FIPE: `;
    }
    if (nextSlot === 'city_uf' && session.vehicle.usage) {
      return `Ótimo, registrado como uso ${session.vehicle.usage}! `;
    }
    if (nextSlot === 'name' && session.lead.city_uf) {
      return `Perfeito, ${session.lead.city_uf} registrado! Por último, `;
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

  getSessionMemory(sessionId: string): SessionMemoryContext | undefined {
    return this.sessions.get(sessionId);
  }

  syncSessionMemory(
    sessionId: string,
    channelId: string,
    lead: Partial<Lead>,
    vehicle: Partial<Vehicle>
  ): SessionMemoryContext {
    const session = this.getOrCreateSession(sessionId, channelId);
    session.greeted = true;
    session.lead = { ...lead };
    session.vehicle = { ...vehicle };
    if (vehicle.plate_masked) {
      session.plate_asked = true;
    }
    session.expected_slot = this.computeNextQualificationStep(session).expectedSlot;
    return session;
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
          .replace(/\b(19\d{2}|20\d{2}|particular|aplicativo|uber|ano|uso|em|de|do|da|placa)\b.*$/i, '')
          .trim();
        if (rawModel && rawModel.length >= 2) {
          session.vehicle.brand = this.normalizeBrandName(rawBrand);
          session.vehicle.model = this.capitalizeWords(rawModel);
        }
      } else if (
        session.expected_slot === 'vehicle_model' &&
        !session.vehicle.model &&
        /\b(19[7-9]\d|20[0-2]\d|tenho\s+um|tenho\s+uma|meu\s+carro|meu\s+ve[ií]culo|minha\s+moto)\b/i.test(cleanText) &&
        !/^(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|qual|quanto|como|onde|por\s+que|quero\s+falar)/i.test(cleanText)
      ) {
        // Fallback contextual: quando o cliente informa um modelo fora do catálogo acompanhado do ano (ex: "Gurgel 1992")
        const strippedForModel = cleanText
          .replace(/(?:tenho\s+um|tenho\s+uma|meu\s+carro\s+[eé]\s+um|meu\s+ve[ií]culo\s+[eé]\s+um|[eé]\s+um|[eé]\s+uma)\s+/i, '')
          .replace(/\b(19\d{2}|20\d{2}|\d{2}\/\d{2})\b/g, '')
          .replace(/\b(ano|modelo|particular|aplicativo|passeio|uber|placa)\b/gi, '')
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

    // 2.5. Extração Segura de Placa do Veículo (Padrão Antigo ABC-1234 ou Mercosul ABC1D23)
    // NUNCA confunde "<modelo de 3 letras> <ano de 4 dígitos>" (ex: "uno 2008", "gol 2018", "fox 2015") com placa!
    if (
      session.expected_slot === 'vehicle_plate' &&
      /\b(sem\s+placa|n[aã]o\s+sei(\s+a\s+placa)?|n[aã]o\s+tenho(\s+a\s+placa)?|n[aã]o\s+lembro|pular|^n[aã]o$)\b/i.test(
        cleanText
      )
    ) {
      session.plate_asked = true;
    } else {
      const hasPlateKeywordOrSlot = session.expected_slot === 'vehicle_plate' || /\bplaca\b/i.test(cleanText);
      const plateRegex = hasPlateKeywordOrSlot
        ? /\b([A-Za-z]{3})[-\s]?([0-9][A-Za-z0-9][0-9]{2})\b/
        : /\b([A-Za-z]{3})-?([0-9][A-Za-z0-9][0-9]{2})\b/;
      const plateMatch = cleanText.match(plateRegex);
      if (plateMatch) {
        const prefix3 = plateMatch[1].toUpperCase();
        const suffix4 = plateMatch[2].toUpperCase();
        const isYearSuffix = /^(19[7-9]\d|20[0-2]\d)$/.test(suffix4);
        const isCarModelOrCommonPrefix =
          /^(UNO|GOL|FOX|FIT|HRV|WRV|CRV|ZRV|MOB|TOR|ARG|CRO|PUL|FAS|PAL|SIE|PUN|DOB|FIO|CEL|COR|AST|VEC|COB|SPI|CRU|TRA|EQU|S10|BIZ|PCX|XRE|BRO|FAN|POP|FAZ|MT0|NMA|XMA|NEO|KIA|BMW|RAM|BYD|GWM|JAC|ANO|USO|MEU|SEU|POR|COM|QUE|NAO|SIM)$/.test(
            prefix3
          );

        if (!(isYearSuffix && isCarModelOrCommonPrefix)) {
          session.vehicle.plate_masked = `${prefix3}${suffix4}`;
          session.plate_asked = true;
        }
      }
    }

    // 3. Extração do Tipo de Uso (particular vs. aplicativo)
    if (
      /\b(particular|passeio|pessoal|fam[ií]lia|dia\s+a\s+dia|casa\s+pro\s+trabalho|uso\s+pr[oó]prio|s[oó]\s+passeio|normal)\b/i.test(
        cleanText
      ) ||
      (session.expected_slot === 'vehicle_usage' && /^(1|sim,\s*particular|n[aã]o,\s*s[oó]\s*particular|n[aã]o)$/i.test(cleanText))
    ) {
      session.vehicle.usage = 'particular';
      if (session.expected_slot === 'vehicle_plate') session.plate_asked = true;
    } else if (
      /\b(aplicativo|app|uber|99|99pop|indrive|motorista|corrida|entrega|comercial|aluguel|t[aá]xi|taxi|frota)\b/i.test(
        cleanText
      ) ||
      (session.expected_slot === 'vehicle_usage' && /^(2|app|uber)$/i.test(cleanText))
    ) {
      session.vehicle.usage = 'aplicativo';
      if (session.expected_slot === 'vehicle_plate') session.plate_asked = true;
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
    // IMPORTANTE: Nunca confundir respostas de outros slots ("particular", "aplicativo", "sem placa", cidades) com o nome do cliente!
    const NON_NAME_WORDS_REGEX =
      /^(ol[aá]|oi|bom\s+dia|boa\s+tarde|boa\s+noite|quero|quanto|qual|voc[eê]|tenho|ignore|cobre|tem\s+guincho|particular|passeio|pessoal|fam[ií]lia|normal|aplicativo|app|uber|comercial|aluguel|frota|t[aá]xi|taxi|sem\s+placa|n[aã]o\s+sei|n[aã]o\s+tenho|n[aã]o\s+lembro|pular|sim|n[aã]o|bh|sp|rj|df|mg|pr|sc|rs|ba|pe|ce|go|es|pa|am|ma|mt|ms|pb|rn|al|se|pi|to|ro|ac|ap|rr)$/i;

    const explicitNameMatch = cleanText.match(
      /(?:meu\s+nome\s+[eé]|sou\s+o|sou\s+a|me\s+chamo|aqui\s+[eé]\s+o|aqui\s+[eé]\s+a)\s+([A-ZÀ-Úa-zà-ú]+(?:\s+[A-ZÀ-Úa-zà-ú]+){0,3})/i
    );
    if (explicitNameMatch && !session.lead.name) {
      const candidateName = explicitNameMatch[1]
        .replace(/\b(e\s+tenho|tenho\s+um|quero|gostaria|particular|aplicativo)\b.*$/i, '')
        .trim();
      if (candidateName.length >= 2 && !NON_NAME_WORDS_REGEX.test(candidateName)) {
        session.lead.name = this.capitalizeWords(candidateName);
      }
    } else if (
      (session.expected_slot === 'name' ||
        (session.expected_slot === 'vehicle_model' && !session.lead.name)) &&
      !foundCatalogVehicle &&
      !KNOWN_BRANDS_REGEX.test(cleanText) &&
      !knownCityMatch &&
      !NON_NAME_WORDS_REGEX.test(cleanText) &&
      !/\b(particular|passeio|aplicativo|uber|comercial|sem\s+placa|n[aã]o\s+sei|cotar|cota[cç][aã]o|placa)\b/i.test(
        cleanText
      )
    ) {
      // Se o cliente respondeu diretamente o nome quando esperado (ex: "Diego", "Diego Gomes", "Carlos, tenho um Onix")
      const firstPart = cleanText.split(/[,;-]|\s+e\s+tenho|\s+tenho\s+um/i)[0].trim();
      if (
        /^[A-ZÀ-Úa-zà-ú]{2,}(?:\s+[A-ZÀ-Úa-zà-ú]{2,}){0,3}$/.test(firstPart) &&
        !NON_NAME_WORDS_REGEX.test(firstPart)
      ) {
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
