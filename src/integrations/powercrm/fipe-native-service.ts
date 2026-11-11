/**
 * BGR Benefícios — Serviço de Consulta Ampla à API FIPE Nativa e Cálculo de Planos do Power CRM
 *
 * Conecta diretamente nas rotas nativas do Power CRM (https://api.powercrm.com.br/api):
 * 1. GET /api/quotation/cb?type={1|2|3}        -> Busca ID da Marca FIPE (1=Carro/108 marcas, 2=Moto/104 marcas, 3=Caminhão/29 marcas)
 * 2. GET /api/quotation/cmby?cb={id}&cy={year} -> Busca Versões FIPE do Modelo no Ano + Código FIPE (back) + Valor FIPE (value)
 * 3. GET /api/quotation/cm?cb={id}             -> Busca Catálogo Completo de Modelos da Marca (todos os anos da história FIPE)
 * 4. GET /api/quotation/cmy?cm={modelId}       -> Busca ID do Ano/Combustível (carModelYearId)
 * 5. GET /api/quotation/stt & /ct?st={stateId} -> Busca ID da Cidade/UF no Power CRM
 * 6. POST /api/plans/                          -> Calcula os Planos Oficiais da BGR para o veículo FIPE e cidade
 *
 * Garantias de Precisão FIPE:
 * - Matching por fronteira estrita de palavra (\b): "Gol" NUNCA casa com "Golf", "Golf" NUNCA casa com "Jetta",
 *   "Corolla" não confunde com "Corolla Cross", "Onix" não confunde com "Onix Plus".
 * - Caso o cliente informe um ano em que o modelo já havia saído de linha (ex: Golf 2022 ou Vectra 2015),
 *   consulta automaticamente GET /quotation/cm?cb={brandId} e GET /quotation/cmy?cm={modelId} para localizar
 *   o ano FIPE real mais próximo daquele modelo exato sem trocar o carro do cliente.
 */

import type { QuotePlanOption } from '../../domain/contracts.ts';

export interface PowerCrmPlateDetails {
  plate: string;
  detran_brand_model: string;
  detran_model: string;
  brand_id: number;
  fab_year: number;
  model_year: number;
  year_label: string;
  cod_fipe: string | null;
  color: string | null;
  fuel: string | null;
  chassi_masked: string | null;
  city: string | null;
  uf: string | null;
  vehicle_type: string | null;
}

export interface PowerCrmFipeVehicleData {
  source: 'powercrm_fipe_live' | 'powercrm_fipe_fallback';
  vehicle_type_id: 1 | 2 | 3; // 1 = Carro/Utilitário, 2 = Moto, 3 = Caminhão
  brand_id: number;
  brand_name: string;
  model_id: number;
  model_full_name: string;
  model_year_id: number;
  year_label: string;
  fipe_code: string;
  fipe_value_brl: number;
  fipe_value_formatted: string;
  city_id: number;
  city_name: string;
  state_uf: string;
  work_vehicle: boolean;
  plate_info?: PowerCrmPlateDetails | null;
  calculated_plans: QuotePlanOption[];
}

interface CrmItemIdString {
  id: number;
  text: string;
  back: string | null;
  value: number | null;
}

interface CrmRawPlan {
  planId: number;
  name: string;
  tppId?: number;
  price?: string;
  priceValue?: number;
  accessPrice?: string;
  trackerIncluded?: boolean;
  franchisePrice?: string;
}

const MOTORCYCLE_MODELS_REGEX =
  /\b(cg\s*160|cg\s*150|cg\s*125|titan|fan\s*160|fan\s*150|start\s*160|biz|bros|xre|sahara|pcx|adv\s*150|elite\s*125|pop\s*110|cb\s*300|twister|cb\s*500|cb\s*600|cb\s*650|hornet|fazer|fz25|fz15|factor|lander|tenere|crosser|mt-03|mt03|mt-07|mt07|nmax|xmax|neo\s*125|harley|royal\s*enfield)\b/i;

const BRAND_SYNONYMS: Record<string, string[]> = {
  volkswagen: ['vw - volkswagen', 'volkswagen', 'vw'],
  vw: ['vw - volkswagen', 'volkswagen', 'vw'],
  chevrolet: ['gm - chevrolet', 'chevrolet', 'gm'],
  gm: ['gm - chevrolet', 'chevrolet', 'gm'],
  fiat: ['fiat'],
  toyota: ['toyota'],
  honda: ['honda'],
  hyundai: ['hyundai'],
  jeep: ['jeep'],
  renault: ['renault'],
  nissan: ['nissan'],
  ford: ['ford'],
  byd: ['byd'],
  gwm: ['gwm', 'great wall'],
  'caoa chery': ['caoa chery', 'caoa chery/chery', 'chery'],
  chery: ['caoa chery', 'caoa chery/chery', 'chery'],
  peugeot: ['peugeot'],
  citroen: ['citroen', 'citroën'],
  mitsubishi: ['mitsubishi'],
  yamaha: ['yamaha'],
  ram: ['ram', 'dodge'],
  kia: ['kia motors', 'kia'],
  bmw: ['bmw'],
  'mercedes-benz': ['mercedes-benz', 'mercedes'],
  mercedes: ['mercedes-benz', 'mercedes'],
  audi: ['audi'],
  volvo: ['volvo'],
  suzuki: ['suzuki'],
  'land rover': ['land rover'],
  iveco: ['iveco'],
  porsche: ['porsche'],
  jac: ['jac'],
  subaru: ['subaru'],
  mini: ['mini'],
  troller: ['troller'],
};

const FALLBACK_FIPE_CATALOG: Record<
  string,
  { fipe_code: string; base_value_2022_brl: number; full_label: string }
> = {
  // Honda
  civic: { fipe_code: '014091-0', base_value_2022_brl: 119800, full_label: 'Civic Sedan EX 2.0 Flex 16V Aut. 4p' },
  city: { fipe_code: '014108-9', base_value_2022_brl: 93861, full_label: 'CITY Hatchback EXL 1.5 Flex 16V Aut.' },
  'hr-v': { fipe_code: '014087-2', base_value_2022_brl: 127400, full_label: 'HR-V EXL 1.8 Flexone 16V 5p Aut.' },
  'wr-v': { fipe_code: '014094-5', base_value_2022_brl: 91500, full_label: 'WR-V EXL 1.5 Flexone 16V 5p Aut.' },
  'cr-v': { fipe_code: '014089-9', base_value_2022_brl: 184900, full_label: 'CR-V Touring 1.5 16V TB AWD Aut.' },
  'zr-v': { fipe_code: '014115-1', base_value_2022_brl: 172000, full_label: 'ZR-V Touring 2.0 16V 5p Aut.' },
  fit: { fipe_code: '014081-3', base_value_2022_brl: 82900, full_label: 'Fit EX 1.5 Flexone 16V 5p Aut.' },
  'cg 160': { fipe_code: '811138-3', base_value_2022_brl: 16890, full_label: 'CG 160 Titan Flexone' },
  'cg 150': { fipe_code: '811092-1', base_value_2022_brl: 12900, full_label: 'CG 150 Titan ESD Mix/Flex' },
  biz: { fipe_code: '811140-5', base_value_2022_brl: 14500, full_label: 'Biz 125 Flexone' },
  'bros 160': { fipe_code: '811139-1', base_value_2022_brl: 19200, full_label: 'NXR 160 Bros ESDD Flexone' },
  bros: { fipe_code: '811139-1', base_value_2022_brl: 19200, full_label: 'NXR 160 Bros ESDD Flexone' },
  'xre 300': { fipe_code: '811101-4', base_value_2022_brl: 25900, full_label: 'XRE 300 ABS Flex' },
  'xre 190': { fipe_code: '811143-0', base_value_2022_brl: 20400, full_label: 'XRE 190 ABS Flex' },
  'sahara 300': { fipe_code: '811168-5', base_value_2022_brl: 29800, full_label: 'XRE 300 Sahara ABS Flex' },
  pcx: { fipe_code: '811126-0', base_value_2022_brl: 17900, full_label: 'PCX 150 / 160 ABS' },
  'cb 300f twister': { fipe_code: '811162-6', base_value_2022_brl: 22900, full_label: 'CB 300F Twister ABS Flex' },

  // Volkswagen (Golf e Jetta 100% separados!)
  gol: { fipe_code: '005490-9', base_value_2022_brl: 58900, full_label: 'Gol 1.0 Flex 12V 5p' },
  golf: { fipe_code: '005495-0', base_value_2022_brl: 108944, full_label: 'Golf Highline 250 TSI 1.4 Flex 16V Aut.' },
  jetta: { fipe_code: '005506-9', base_value_2022_brl: 134900, full_label: 'JETTA Comfortline 250 TSI 1.4 Flex 16V Aut.' },
  polo: { fipe_code: '005479-8', base_value_2022_brl: 83500, full_label: 'Polo Comfortline 200 TSI 1.0 Flex 12V Aut.' },
  virtus: { fipe_code: '005485-2', base_value_2022_brl: 92400, full_label: 'Virtus Comfortline 200 TSI 1.0 Flex 12V Aut.' },
  't-cross': { fipe_code: '005510-7', base_value_2022_brl: 112900, full_label: 'T-Cross 200 TSI 1.0 Flex 12V 5p Aut.' },
  nivus: { fipe_code: '005525-5', base_value_2022_brl: 109800, full_label: 'Nivus Comfortline 1.0 200 TSI Flex Aut.' },
  taos: { fipe_code: '005528-0', base_value_2022_brl: 154900, full_label: 'Taos Comfortline 1.4 250 TSI Flex Aut.' },
  tiguan: { fipe_code: '005488-7', base_value_2022_brl: 168900, full_label: 'Tiguan Allspace 250 TSI 1.4 Flex' },
  saveiro: { fipe_code: '005458-5', base_value_2022_brl: 74800, full_label: 'Saveiro Robust 1.6 Total Flex 8V' },
  voyage: { fipe_code: '005492-5', base_value_2022_brl: 62500, full_label: 'Voyage 1.6 MSI Flex 8V 4p' },
  fox: { fipe_code: '005474-7', base_value_2022_brl: 61800, full_label: 'Fox Connect 1.6 Flex 8V 5p' },
  crossfox: { fipe_code: '005428-3', base_value_2022_brl: 58400, full_label: 'CrossFox 1.6 MSI Total Flex 16V 5p' },
  spacefox: { fipe_code: '005440-2', base_value_2022_brl: 56900, full_label: 'SpaceFox Trendline 1.6 Total Flex 8V 5p' },
  up: { fipe_code: '005442-9', base_value_2022_brl: 59800, full_label: 'up! move 1.0 TSI Total Flex 12V 5p' },
  amarok: { fipe_code: '005483-6', base_value_2022_brl: 198500, full_label: 'Amarok Highline CD 3.0 4x4 TB Dies. Aut.' },
  passat: { fipe_code: '005462-3', base_value_2022_brl: 129000, full_label: 'Passat Highline 2.0 TSI 220cv Aut.' },
  fusca: { fipe_code: '005344-9', base_value_2022_brl: 89000, full_label: 'Fusca 2.0 TSI 16V 200cv Aut.' },

  // Toyota
  corolla: { fipe_code: '002111-3', base_value_2022_brl: 128900, full_label: 'Corolla XEi 2.0 Flex 16V Direct Shift' },
  'corolla cross': { fipe_code: '002201-2', base_value_2022_brl: 142500, full_label: 'Corolla Cross XRE 2.0 16V Flex Aut.' },
  hilux: { fipe_code: '002114-8', base_value_2022_brl: 219500, full_label: 'Hilux CD SRV 4x4 2.8 TDI Diesel Aut.' },
  sw4: { fipe_code: '002148-2', base_value_2022_brl: 289000, full_label: 'Hilux SW4 SRX 4x4 2.8 TDI 16V Diesel Aut.' },
  yaris: { fipe_code: '002174-1', base_value_2022_brl: 86400, full_label: 'Yaris XL Live 1.3 Flex 16V 5p Aut.' },
  etios: { fipe_code: '002158-0', base_value_2022_brl: 67500, full_label: 'Etios X Plus 1.5 Flex 16V 5p Aut.' },
  rav4: { fipe_code: '002182-2', base_value_2022_brl: 215000, full_label: 'RAV4 SX Connect 2.5 16V AWD Híbrido Aut.' },

  // Chevrolet
  onix: { fipe_code: '004497-0', base_value_2022_brl: 78500, full_label: 'ONIX HATCH LT 1.0 12V TB Flex 5p Aut.' },
  'onix plus': { fipe_code: '004503-9', base_value_2022_brl: 83900, full_label: 'ONIX SEDAN Plus LTZ 1.0 12V TB Flex Aut.' },
  prisma: { fipe_code: '004434-2', base_value_2022_brl: 64900, full_label: 'PRISMA Sedan LT 1.4 8V FlexPower 4p' },
  tracker: { fipe_code: '004522-5', base_value_2022_brl: 108900, full_label: 'Tracker LT 1.0 Turbo 12V Flex Aut.' },
  cruze: { fipe_code: '004469-5', base_value_2022_brl: 114900, full_label: 'Cruze LT 1.4 16V Turbo Flex 4p Aut.' },
  spin: { fipe_code: '004416-4', base_value_2022_brl: 86900, full_label: 'SPIN LTZ 1.8 8V Econo.Flex 5p Aut.' },
  montana: { fipe_code: '004540-3', base_value_2022_brl: 118500, full_label: 'Montana LTZ 1.2 Turbo Flex 12V 4p Aut.' },
  s10: { fipe_code: '004393-1', base_value_2022_brl: 198000, full_label: 'S10 Pick-Up LTZ 2.8 TDI 4x4 CD Diesel Aut.' },
  celta: { fipe_code: '004318-4', base_value_2022_brl: 32900, full_label: 'Celta Spirit/LT 1.0 MPFI 8V FlexPower 5p' },
  classic: { fipe_code: '004274-9', base_value_2022_brl: 31500, full_label: 'Classic Life/LS 1.0 VHC FlexPower 4p' },
  corsa: { fipe_code: '004224-2', base_value_2022_brl: 33900, full_label: 'Corsa Hat. Maxx 1.4 8V ECONOFLEX 5p' },
  cobalt: { fipe_code: '004386-9', base_value_2022_brl: 62900, full_label: 'COBALT LTZ 1.8 8V Econo.Flex 4p Aut.' },
  astra: { fipe_code: '004203-0', base_value_2022_brl: 38900, full_label: 'Astra Advantage 2.0 MPFI 8V FlexPower 5p' },
  vectra: { fipe_code: '004329-0', base_value_2022_brl: 42500, full_label: 'Vectra Elegance 2.0 MPFI 8V FlexPower Mec.' },
  equinox: { fipe_code: '004484-9', base_value_2022_brl: 158000, full_label: 'Equinox Premier 1.5 Turbo 172cv Aut.' },
  trailblazer: { fipe_code: '004425-3', base_value_2022_brl: 245000, full_label: 'Trailblazer Premier 2.8 TB Diesel Aut.' },

  // Fiat
  strada: { fipe_code: '001529-6', base_value_2022_brl: 96400, full_label: 'Strada Freedom 1.3 Flex 8V CD' },
  toro: { fipe_code: '001463-0', base_value_2022_brl: 118700, full_label: 'Toro Freedom 1.3 T270 4x2 Flex Aut.' },
  argo: { fipe_code: '001491-5', base_value_2022_brl: 68900, full_label: 'Argo Drive 1.0 6V Flex' },
  cronos: { fipe_code: '001505-9', base_value_2022_brl: 76500, full_label: 'Cronos Drive 1.3 8V Flex' },
  mobi: { fipe_code: '001461-3', base_value_2022_brl: 54900, full_label: 'Mobi Like 1.0 Fire Flex 5p.' },
  pulse: { fipe_code: '001543-1', base_value_2022_brl: 94200, full_label: 'Pulse Drive 1.3 Flex 8V Aut.' },
  fastback: { fipe_code: '001557-1', base_value_2022_brl: 126900, full_label: 'Fastback Audace 1.0 200 T. Flex Aut.' },
  palio: { fipe_code: '001266-1', base_value_2022_brl: 42500, full_label: 'Palio Attractive 1.0 EVO Fire Flex 8v 5p' },
  uno: { fipe_code: '001343-9', base_value_2022_brl: 46800, full_label: 'Uno Attractive 1.0 Fire Flex 8V 5p' },
  siena: { fipe_code: '001297-1', base_value_2022_brl: 41200, full_label: 'Siena EL 1.0 mpi Fire Flex 8V 4p' },
  'grand siena': { fipe_code: '001378-1', base_value_2022_brl: 52900, full_label: 'Grand Siena Attractive 1.4 EVO F.Flex 8V' },
  punto: { fipe_code: '001307-2', base_value_2022_brl: 48500, full_label: 'Punto Attractive 1.4 Fire Flex 8V 5p' },
  fiorino: { fipe_code: '001412-5', base_value_2022_brl: 84900, full_label: 'Fiorino Endurance EVO 1.4 Flex 8V 2p' },
  doblo: { fipe_code: '001353-6', base_value_2022_brl: 74900, full_label: 'Doblo Essence 1.8 Flex 16V 5p' },

  // Hyundai / Jeep / Renault / Nissan / Ford / BYD / Outros
  hb20: { fipe_code: '015188-2', base_value_2022_brl: 74900, full_label: 'HB20 Vision 1.0 Flex 12V Mec.' },
  hb20s: { fipe_code: '015192-0', base_value_2022_brl: 81900, full_label: 'HB20S Vision 1.0 Flex 12V Mec.' },
  creta: { fipe_code: '015145-9', base_value_2022_brl: 114500, full_label: 'Creta Action 1.6 16V Flex Aut.' },
  tucson: { fipe_code: '015140-8', base_value_2022_brl: 109000, full_label: 'Tucson GLS 1.6 Turbo 16V Aut.' },
  ix35: { fipe_code: '015144-0', base_value_2022_brl: 98500, full_label: 'ix35 GL 2.0 16V 2WD Flex Aut.' },
  i30: { fipe_code: '015095-9', base_value_2022_brl: 68900, full_label: 'i30 1.8 16V Aut. 5p' },
  compass: { fipe_code: '017076-3', base_value_2022_brl: 144900, full_label: 'Compass Longitude T270 1.3 TB 4x2 Flex Aut.' },
  renegade: { fipe_code: '017085-2', base_value_2022_brl: 112400, full_label: 'Renegade Sport T270 1.3 TB 4x2 Flex Aut.' },
  commander: { fipe_code: '017081-0', base_value_2022_brl: 208900, full_label: 'Commander Limited T270 1.3 TB Flex Aut.' },
  kicks: { fipe_code: '023146-0', base_value_2022_brl: 98900, full_label: 'Kicks Sense 1.6 16V Flex Aut.' },
  versa: { fipe_code: '023175-4', base_value_2022_brl: 89900, full_label: 'Versa Advance 1.6 16V Flex Aut.' },
  sentra: { fipe_code: '023185-1', base_value_2022_brl: 138900, full_label: 'Sentra Advance 2.0 16V Aut.' },
  frontier: { fipe_code: '023161-4', base_value_2022_brl: 192000, full_label: 'Frontier Attack CD 4x4 2.3 Bi-TB Diesel Aut.' },
  kwid: { fipe_code: '025266-2', base_value_2022_brl: 53400, full_label: 'KWID Zen 1.0 Flex 12V 5p Mec.' },
  sandero: { fipe_code: '025285-9', base_value_2022_brl: 64900, full_label: 'Sandero Zen 1.0 12V 5p Mec.' },
  logan: { fipe_code: '025288-3', base_value_2022_brl: 66800, full_label: 'Logan Zen 1.0 12V 4p Mec.' },
  duster: { fipe_code: '025293-0', base_value_2022_brl: 96800, full_label: 'Duster Iconic 1.6 16V Flex Aut.' },
  oroch: { fipe_code: '025313-8', base_value_2022_brl: 98500, full_label: 'Duster Oroch Pro 1.6 Flex 16V Mec.' },
  captur: { fipe_code: '025306-5', base_value_2022_brl: 104900, full_label: 'Captur Zen 1.3 TB 16V Flex 5p Aut.' },
  ka: { fipe_code: '003408-8', base_value_2022_brl: 55900, full_label: 'Ka SE 1.0 TiVCT Flex 5p' },
  ecosport: { fipe_code: '003436-3', base_value_2022_brl: 78900, full_label: 'EcoSport SE 1.5 12V Flex 5p Aut.' },
  ranger: { fipe_code: '003425-8', base_value_2022_brl: 189900, full_label: 'Ranger XLS 2.2 4x4 CD Diesel Aut.' },
  fiesta: { fipe_code: '003418-5', base_value_2022_brl: 58900, full_label: 'Fiesta SE 1.6 16V Flex 5p' },
  focus: { fipe_code: '003399-5', base_value_2022_brl: 72900, full_label: 'Focus SE Plus 2.0 16V Flex 5p Aut.' },
  fusion: { fipe_code: '003406-1', base_value_2022_brl: 109000, full_label: 'Fusion Titanium 2.0 GTDI EcoBo. FWD Aut.' },
  dolphin: { fipe_code: '095007-6', base_value_2022_brl: 139800, full_label: 'Dolphin EV (Elétrico)' },
  'song plus': { fipe_code: '095005-0', base_value_2022_brl: 199800, full_label: 'Song Plus DM-i 1.5 16V Aut. (Híbrido)' },
  'haval h6': { fipe_code: '096001-2', base_value_2022_brl: 196000, full_label: 'Haval H6 Premium HEV (Híbrido)' },
  'tiggo 5x': { fipe_code: '073023-8', base_value_2022_brl: 108900, full_label: 'Tiggo 5X PRO 1.5 Turbo Flex Aut.' },
  'tiggo 7': { fipe_code: '073032-7', base_value_2022_brl: 146900, full_label: 'Tiggo 7 PRO Max Drive 1.6 Turbo 16V Aut.' },
  'tiggo 8': { fipe_code: '073029-7', base_value_2022_brl: 164900, full_label: 'Tiggo 8 TXS 1.6 16V TGDi Aut.' },
  '208': { fipe_code: '024249-7', base_value_2022_brl: 76900, full_label: '208 Like 1.0 Flex 6V 5p Mec.' },
  '2008': { fipe_code: '024212-8', base_value_2022_brl: 88900, full_label: '2008 Allure Pack 1.6 Flex 16V 5p Aut.' },
  c3: { fipe_code: '011223-2', base_value_2022_brl: 67900, full_label: 'C3 Live 1.0 Flex 6V 5p Mec.' },
  'c4 cactus': { fipe_code: '011193-7', base_value_2022_brl: 89900, full_label: 'C4 CACTUS Feel Pack 1.6 16V Flex Aut.' },
  'l200 triton': { fipe_code: '022168-6', base_value_2022_brl: 198900, full_label: 'L200 Triton Outdoor GLS 2.4 CD Dies. Aut.' },
  pajero: { fipe_code: '022181-3', base_value_2022_brl: 268000, full_label: 'Pajero Sport HPE 2.4 4x4 Diesel Aut.' },
  asx: { fipe_code: '022164-3', base_value_2022_brl: 104900, full_label: 'ASX GLS 2.0 16V 4x2 Flex Aut.' },
  'eclipse cross': { fipe_code: '022170-8', base_value_2022_brl: 139900, full_label: 'Eclipse Cross HPE-S 1.5 16V 165cv Aut.' },
};

export class PowerCrmNativeFipeService {
  private baseUrl: string;
  private bearerToken: string;
  private brandsCache = new Map<number, CrmItemIdString[]>();
  private allModelsByBrandCache = new Map<number, CrmItemIdString[]>();
  private statesCache: CrmItemIdString[] | null = null;

  constructor(config?: { baseUrl?: string; bearerToken?: string }) {
    this.baseUrl = (config?.baseUrl || process.env.POWERCRM_BASE_URL || 'https://api.powercrm.com.br/api').replace(
      /\/+$/,
      ''
    );
    this.bearerToken = (config?.bearerToken || process.env.POWERCRM_BEARER_TOKEN || '').trim();
  }

  configure(config: { baseUrl?: string; bearerToken?: string }): void {
    if (config.baseUrl) this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (typeof config.bearerToken === 'string') this.bearerToken = config.bearerToken.trim();
  }

  isLiveConfigured(): boolean {
    return this.bearerToken.length >= 20;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private parseMoneyString(raw?: string, numericFallback?: number): number {
    if (typeof numericFallback === 'number' && numericFallback > 0) {
      return Number(numericFallback.toFixed(2));
    }
    if (!raw) return 0;
    const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
  }

  /**
   * Executa o fluxo completo na API FIPE Nativa do Power CRM:
   * Placa Opcional (/quotation/plates/{plate}) -> Marca (cb) -> Modelo e Valor FIPE no Ano (cmby + cm) -> Ano/Combustível (cmy) -> Cidade/UF (stt/ct) -> Planos Reais (POST /api/plans/)
   */
  async lookupFipeAndPlans(params: {
    brand: string;
    model: string;
    year: number;
    usage: 'particular' | 'aplicativo' | 'comercial' | 'frota';
    cityUf: string;
    plate?: string | null;
    allowLiveHttp?: boolean;
  }): Promise<PowerCrmFipeVehicleData> {
    const vehicleTypeId: 1 | 2 | 3 = MOTORCYCLE_MODELS_REGEX.test(params.model) ? 2 : 1;
    const workVehicle = params.usage !== 'particular';

    if (params.allowLiveHttp !== false && this.isLiveConfigured()) {
      try {
        const liveResult = await this.executeLiveCrmFipeFlow({
          vehicleTypeId,
          brand: params.brand,
          model: params.model,
          year: params.year,
          workVehicle,
          cityUf: params.cityUf,
          plate: params.plate,
        });
        if (liveResult) {
          return liveResult;
        }
      } catch {
        // Fallback seguro para tabela local se houver oscilação de rede
      }
    }

    return this.buildFallbackFipeData({
      vehicleTypeId,
      brand: params.brand,
      model: params.model,
      year: params.year,
      workVehicle,
      cityUf: params.cityUf,
    });
  }

  /**
   * Consulta a rota oficial de Placa do Power CRM: GET /api/quotation/plates/{plate}
   * Retorna os dados reais da base nacional (Marca/Modelo DETRAN, brandId Power CRM, codFipe, Ano Fab/Mod, Cor, Combustível).
   */
  async lookupPlateInPowerCrm(
    plateRaw: string,
    headers?: Record<string, string>
  ): Promise<PowerCrmPlateDetails | null> {
    const cleanPlate = plateRaw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleanPlate.length !== 7) return null;

    try {
      const reqHeaders = headers ?? this.getHeaders();
      const res = await fetch(`${this.baseUrl}/quotation/plates/${cleanPlate}`, { headers: reqHeaders });
      if (!res.ok) return null;

      const data = (await res.json()) as {
        mensagem?: string;
        city?: string | null;
        uf?: string | null;
        chassi?: string | null;
        brand?: string | null;
        brandId?: number | null;
        year?: string | null;
        fuel?: string | null;
        color?: string | null;
        vehicleType?: string | null;
        codFipe?: string | null;
        error?: unknown;
      };

      if (data.error || !data.brand || !data.brandId) {
        return null;
      }

      // Remove repetição comum do DETRAN (ex: "VW/SAVEIRO 1.6 CE CROSS VW SAVEIRO 1.6 CE CROSS")
      const rawBrand = data.brand.trim();
      const afterSlash = rawBrand.includes('/') ? rawBrand.split('/').slice(1).join('/').trim() : rawBrand;
      const words = afterSlash.split(/\s+/);
      let detranModel = afterSlash;
      // Se a string tiver a segunda metade repetida (ex: "HR-V EX CVT HONDA HR-V EX CVT"), corta antes da marca repetida
      const brandPrefix = rawBrand.split('/')[0]?.trim().toUpperCase();
      if (brandPrefix && words.length >= 4) {
        const repeatIdx = words.findIndex((w, idx) => idx >= 1 && w.toUpperCase() === brandPrefix);
        if (repeatIdx > 0) {
          detranModel = words.slice(0, repeatIdx).join(' ');
        }
      }

      const yearParts = String(data.year || '2022/2022')
        .split('/')
        .map((p) => Number.parseInt(p.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1970 && n <= 2030);
      const fabYear = yearParts[0] || 2022;
      const modelYear = yearParts[1] || fabYear;

      const chassiMasked = data.chassi
        ? `${data.chassi.slice(0, 4)}*********${data.chassi.slice(-4)}`
        : null;

      return {
        plate: cleanPlate,
        detran_brand_model: `${brandPrefix}/${detranModel}`,
        detran_model: detranModel,
        brand_id: Number(data.brandId),
        fab_year: fabYear,
        model_year: modelYear,
        year_label: `${fabYear}/${modelYear}`,
        cod_fipe: data.codFipe || null,
        color: data.color || null,
        fuel: data.fuel || null,
        chassi_masked: chassiMasked,
        city: data.city || null,
        uf: data.uf || null,
        vehicle_type: data.vehicleType || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Pontua um item FIPE do Power CRM para garantir que:
   * - "Gol" NUNCA dê match com "Golf"
   * - "Golf" NUNCA dê match com "Jetta"
   * - "Corolla" prefira "Corolla Sedan" e não "Corolla Cross" (a menos que o usuário peça Cross)
   * - "Onix" prefira "Onix Hatch" e não "Onix Plus" (a menos que o usuário peça Plus)
   */
  private findBestModelInList(models: CrmItemIdString[], targetModel: string): CrmItemIdString | undefined {
    const normTarget = this.normalizeSearch(targetModel);
    if (!normTarget) return undefined;

    const targetTokens = normTarget.split(' ').filter(Boolean);
    const primaryWord = targetTokens[0];
    const escapedPrimary = primaryWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedFull = normTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Fronteira estrita de palavra (\b): impede que "gol" case com "golf"
    const startsWithFullRegex = new RegExp(`^${escapedFull}(?:\\b|\\s|$)`, 'i');
    const startsWithPrimaryRegex = new RegExp(`^${escapedPrimary}(?:\\b|\\s|$)`, 'i');
    const containsWordFullRegex = new RegExp(`(?:^|\\b|\\s)${escapedFull}(?:\\b|\\s|$)`, 'i');
    const containsWordPrimaryRegex = new RegExp(`(?:^|\\b|\\s)${escapedPrimary}(?:\\b|\\s|$)`, 'i');

    let bestItem: CrmItemIdString | undefined;
    let bestScore = -1;

    for (const item of models) {
      const normItem = this.normalizeSearch(item.text);
      let score = -1;

      if (startsWithFullRegex.test(normItem)) {
        score = 100;
      } else if (containsWordFullRegex.test(normItem)) {
        score = 85;
      } else if (startsWithPrimaryRegex.test(normItem)) {
        score = 70;
      } else if (containsWordPrimaryRegex.test(normItem)) {
        score = 50;
      }

      if (score < 0) continue;

      // Evita confundir variantes compostas quando o cliente pediu o modelo base
      if (primaryWord === 'corolla' && !normTarget.includes('cross') && normItem.includes('cross')) {
        score -= 40;
      }
      if (primaryWord === 'onix' && !normTarget.includes('plus') && normItem.includes('plus')) {
        score -= 30;
      }
      if (primaryWord === 'duster' && !normTarget.includes('oroch') && normItem.includes('oroch')) {
        score -= 30;
      }
      if (primaryWord === 'siena' && !normTarget.includes('grand') && normItem.includes('grand')) {
        score -= 30;
      }
      if (primaryWord === 'fox' && (normItem.includes('crossfox') || normItem.includes('spacefox'))) {
        score -= 45;
      }

      // Bônus por cada token adicional do modelo (ex: "Golf GTI", "Jetta GLI", "Tiggo 7", "Tiggo 8", "CG 160")
      let allExtraTokensMatched = true;
      for (let i = 1; i < targetTokens.length; i++) {
        const tok = targetTokens[i];
        const tokRegex = new RegExp(`(?:^|\\b|\\s)${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|\\s|$)`, 'i');
        if (tokRegex.test(normItem)) {
          score += 20;
        } else {
          allExtraTokensMatched = false;
          score -= 25;
        }
      }

      // Se o modelo tem número identificador (ex: "Tiggo 7" vs "Tiggo 5x", "CG 160" vs "CG 150", "XRE 300" vs "XRE 190"), exige que o número bata
      if (targetTokens.length >= 2 && /^\d+/.test(targetTokens[1]) && !allExtraTokensMatched) {
        continue;
      }

      // Preferência leve por versões Flex/Automáticas intermediárias quando o cliente informou só o nome do modelo
      if (targetTokens.length === 1) {
        if (/\b(comfortline|highline|exl|xei|ltz|longitude|freedom|drive|vision|sense)\b/i.test(normItem)) {
          score += 5;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    return bestScore >= 40 ? bestItem : undefined;
  }

  private async resolveCandidateBrands(
    vehicleTypeId: 1 | 2 | 3,
    brandInput: string,
    headers: Record<string, string>
  ): Promise<CrmItemIdString[]> {
    let brands = this.brandsCache.get(vehicleTypeId);
    if (!brands) {
      const cbRes = await fetch(`${this.baseUrl}/quotation/cb?type=${vehicleTypeId}`, { headers });
      if (!cbRes.ok) return [];
      brands = (await cbRes.json()) as CrmItemIdString[];
      this.brandsCache.set(vehicleTypeId, brands);
    }

    const cleanBrand = this.normalizeSearch(brandInput);
    const synonyms = BRAND_SYNONYMS[cleanBrand] || [cleanBrand];

    const matched: CrmItemIdString[] = [];
    for (const syn of synonyms) {
      const normSyn = this.normalizeSearch(syn);
      for (const b of brands) {
        const normB = this.normalizeSearch(b.text);
        if (normB === normSyn || normB.includes(normSyn) || normSyn.includes(normB)) {
          if (!matched.some((m) => m.id === b.id)) {
            matched.push(b);
          }
        }
      }
    }

    if (matched.length > 0) {
      return matched;
    }

    // Se a marca não foi reconhecida (ex: "Veículo"), busca nas 14 maiores marcas do Brasil no Power CRM
    const topBrandIds = vehicleTypeId === 2 ? [155, 202, 195, 128, 165, 190] : [88, 33, 27, 85, 37, 38, 43, 72, 64, 29, 217, 225, 16, 65, 18, 62];
    return topBrandIds.map((id) => brands!.find((b) => b.id === id)).filter((b): b is CrmItemIdString => Boolean(b));
  }

  private async executeLiveCrmFipeFlow(params: {
    vehicleTypeId: 1 | 2 | 3;
    brand: string;
    model: string;
    year: number;
    workVehicle: boolean;
    cityUf: string;
    plate?: string | null;
  }): Promise<PowerCrmFipeVehicleData | null> {
    const headers = this.getHeaders();

    let matchedBrand: CrmItemIdString | undefined;
    let matchedModel: CrmItemIdString | undefined;
    let effectiveYear = params.year;
    let effectiveVehicleTypeId = params.vehicleTypeId;

    // 0ª Fase (Prioridade Máxima): Consulta Direta por Placa na API Nativa do Power CRM (GET /quotation/plates/{plate})
    const plateDetails = params.plate ? await this.lookupPlateInPowerCrm(params.plate, headers) : null;
    if (plateDetails) {
      const detranPrimaryWord = this.normalizeSearch(plateDetails.detran_model).split(' ')[0];
      const userPrimaryWord = this.normalizeSearch(params.model).split(' ')[0];
      const isPlateOnlyRequest = /^placa\s+/i.test(params.model.trim()) || !userPrimaryWord;
      const plateMatchesUserModel =
        isPlateOnlyRequest ||
        detranPrimaryWord === userPrimaryWord ||
        this.normalizeSearch(plateDetails.detran_brand_model).includes(userPrimaryWord);

      if (plateMatchesUserModel) {
        if (plateDetails.vehicle_type === 'MOTOCICLETA' || plateDetails.brand_id === 155) {
          effectiveVehicleTypeId = 2;
        }
        const plateYears = Array.from(new Set([plateDetails.model_year, plateDetails.fab_year, plateDetails.model_year - 1]));
        for (const py of plateYears) {
          const cmbyRes = await fetch(
            `${this.baseUrl}/quotation/cmby?cb=${plateDetails.brand_id}&cy=${py}`,
            { headers }
          );
          if (!cmbyRes.ok) continue;
          const modelsInYear = (await cmbyRes.json()) as CrmItemIdString[];
          if (!Array.isArray(modelsInYear) || modelsInYear.length === 0) continue;

          const codFipeMatch = plateDetails.cod_fipe
            ? modelsInYear.find((m) => m.back === plateDetails.cod_fipe)
            : undefined;
          const textMatch = this.findBestModelInList(modelsInYear, plateDetails.detran_model);

          // Usa o codFipe exato do DETRAN se pertencer à mesma família de modelo, ou o match exato da descrição DETRAN
          const codFipeFirstWord = codFipeMatch ? this.normalizeSearch(codFipeMatch.text).split(' ')[0] : '';
          const bestPlateModel =
            codFipeMatch && codFipeFirstWord === detranPrimaryWord
              ? codFipeMatch
              : textMatch || codFipeMatch;

          if (bestPlateModel) {
            matchedBrand = {
              id: plateDetails.brand_id,
              text: plateDetails.detran_brand_model.split('/')[0] || params.brand,
              back: null,
              value: null,
            };
            matchedModel = bestPlateModel;
            effectiveYear = py;
            break;
          }
        }
      }
    }

    const candidateBrands = matchedBrand
      ? [matchedBrand]
      : await this.resolveCandidateBrands(effectiveVehicleTypeId, params.brand, headers);
    if (candidateBrands.length === 0) return null;

    // 1ª Fase: Busca direta no ano solicitado e anos adjacentes imediatos (GET /quotation/cmby?cb={brandId}&cy={year})
    const immediateYears = Array.from(new Set([params.year, params.year - 1, params.year + 1]));

    if (!matchedModel) {
      for (const brandObj of candidateBrands) {
        for (const candidateYear of immediateYears) {
          const cmbyRes = await fetch(
            `${this.baseUrl}/quotation/cmby?cb=${brandObj.id}&cy=${candidateYear}`,
            { headers }
          );
          if (!cmbyRes.ok) continue;
          const modelsInYear = (await cmbyRes.json()) as CrmItemIdString[];
          if (!Array.isArray(modelsInYear) || modelsInYear.length === 0) continue;

          const found = this.findBestModelInList(modelsInYear, params.model);
          if (found) {
            matchedBrand = brandObj;
            matchedModel = found;
            effectiveYear = candidateYear;
            break;
          }
        }
        if (matchedModel) break;
      }
    }

    // 2ª Fase (Ampla): Se o modelo não existia naquele ano exato (ex: Golf 2022 quando o Golf saiu de linha em 2020,
    // ou Vectra 2015 quando saiu de linha em 2011), varre a janela de anos ordenada pela proximidade do ano pedido
    // após confirmar no catálogo completo da marca (GET /quotation/cm?cb={brandId}) que o modelo pertence àquela marca!
    if (!matchedModel) {
      for (const brandObj of candidateBrands) {
        let allBrandModels = this.allModelsByBrandCache.get(brandObj.id);
        if (!allBrandModels) {
          const cmRes = await fetch(`${this.baseUrl}/quotation/cm?cb=${brandObj.id}`, { headers });
          if (cmRes.ok) {
            allBrandModels = (await cmRes.json()) as CrmItemIdString[];
            this.allModelsByBrandCache.set(brandObj.id, allBrandModels);
          }
        }
        if (!allBrandModels || allBrandModels.length === 0) continue;

        const catalogMatch = this.findBestModelInList(allBrandModels, params.model);
        if (!catalogMatch) continue;

        const allHistoricalYears = [
          2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009, 2008,
          2007, 2006, 2005,
        ]
          .filter((y) => !immediateYears.includes(y))
          .sort((a, b) => Math.abs(a - params.year) - Math.abs(b - params.year));

        for (const cy of allHistoricalYears.slice(0, 8)) {
          const cmbyRes = await fetch(`${this.baseUrl}/quotation/cmby?cb=${brandObj.id}&cy=${cy}`, { headers });
          if (!cmbyRes.ok) continue;
          const modelsInYear = (await cmbyRes.json()) as CrmItemIdString[];
          const found = this.findBestModelInList(modelsInYear, params.model);
          if (found) {
            matchedBrand = brandObj;
            matchedModel = found;
            effectiveYear = cy;
            break;
          }
        }

        if (matchedModel) break;
      }
    }

    if (!matchedBrand || !matchedModel) return null;

    // 3. Busca carModelYearId (GET /quotation/cmy?cm={modelId})
    const cmyRes = await fetch(`${this.baseUrl}/quotation/cmy?cm=${matchedModel.id}`, { headers });
    if (!cmyRes.ok) return null;
    const yearsForModel = (await cmyRes.json()) as CrmItemIdString[];
    const matchedYearObj =
      yearsForModel.find((y) => String(y.text).includes(String(effectiveYear))) ||
      yearsForModel.find((y) => String(y.text).includes(String(params.year))) ||
      yearsForModel[0];

    if (!matchedYearObj) return null;

    // 4. Resolve Cidade e UF
    const { cityId, cityName, stateUf } = await this.resolveCityId(params.cityUf, headers);

    // 5. Calcula os Planos Oficiais BGR no Power CRM (POST /plans/)
    const plansRes = await fetch(`${this.baseUrl}/plans/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        carModelId: matchedModel.id,
        carModelYearId: matchedYearObj.id,
        cityId,
        quotationWorkVehicle: params.workVehicle,
      }),
    });

    const fipeValueBrl = Number(matchedModel.value || 75000);
    const fipeCode = matchedModel.back || '000000-0';
    let calculatedPlans: QuotePlanOption[] = [];

    if (plansRes.ok) {
      const plansData = (await plansRes.json()) as { plans?: CrmRawPlan[] };
      const rawPlans = Array.isArray(plansData.plans) ? plansData.plans : [];

      const fullProtectionPlans = rawPlans.filter((p) => (p.priceValue ?? 0) >= 140);
      const selectedPlans = fullProtectionPlans.length > 0 ? fullProtectionPlans.slice(0, 3) : rawPlans.slice(0, 3);

      calculatedPlans = selectedPlans.map((p) => {
        const monthly = this.parseMoneyString(p.price, p.priceValue);
        const enrollment = this.parseMoneyString(p.accessPrice, 350);
        const franchise = (p.franchisePrice || 'Conforme regulamento BGR').replace(/^R\$\s*R\$/i, 'R$');
        return {
          plan_id: `crm_plan_${p.planId}`,
          plan_name: p.name.toUpperCase().includes('BGR') ? p.name : `BGR ${p.name}`,
          monthly_fee_brl: monthly,
          enrollment_fee_brl: enrollment,
          deductible_description: `Franquia/Cota FIPE: ${franchise}`,
          coverages: [
            `Cobertura 100% Tabela FIPE (R$ ${fipeValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
            'Roubo, Furto, Colisão e Perda Total',
            'Assistência 24h Nacional (Guincho e Socorro)',
            p.trackerIncluded ? 'Rastreador BGR Incluso' : 'Proteção Contra Terceiros',
          ],
        };
      });
    }

    return {
      source: 'powercrm_fipe_live',
      vehicle_type_id: effectiveVehicleTypeId,
      brand_id: matchedBrand.id,
      brand_name: matchedBrand.text,
      model_id: matchedModel.id,
      model_full_name: matchedModel.text,
      model_year_id: matchedYearObj.id,
      year_label: matchedYearObj.text,
      fipe_code: fipeCode,
      fipe_value_brl: fipeValueBrl,
      fipe_value_formatted: `R$ ${fipeValueBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      city_id: cityId,
      city_name: cityName,
      state_uf: stateUf,
      work_vehicle: params.workVehicle,
      plate_info: plateDetails,
      calculated_plans: calculatedPlans,
    };
  }

  private async resolveCityId(
    cityUfRaw: string,
    headers: Record<string, string>
  ): Promise<{ cityId: number; cityName: string; stateUf: string }> {
    const norm = this.normalizeSearch(cityUfRaw);
    if (norm.includes('belo horizonte') || norm === 'bh') {
      return { cityId: 1630, cityName: 'Belo Horizonte', stateUf: 'MG' };
    }
    if (norm.includes('contagem')) {
      return { cityId: 1749, cityName: 'Contagem', stateUf: 'MG' };
    }
    if (norm.includes('betim')) {
      return { cityId: 1637, cityName: 'Betim', stateUf: 'MG' };
    }
    if (norm.includes('sao paulo')) {
      return { cityId: 5270, cityName: 'São Paulo', stateUf: 'SP' };
    }

    try {
      if (!this.statesCache) {
        const stRes = await fetch(`${this.baseUrl}/quotation/stt`, { headers });
        if (stRes.ok) {
          this.statesCache = (await stRes.json()) as CrmItemIdString[];
        }
      }
      const ufMatch = cityUfRaw.match(/\b([A-Z]{2})\b/);
      const uf = ufMatch ? ufMatch[1] : 'MG';
      const stateObj = this.statesCache?.find((s) => s.back === uf) || {
        id: 11,
        text: 'Minas Gerais',
        back: 'MG',
        value: null,
      };
      const ctRes = await fetch(`${this.baseUrl}/quotation/ct?st=${stateObj.id}`, { headers });
      if (ctRes.ok) {
        const cities = (await ctRes.json()) as CrmItemIdString[];
        const cleanCityPart = this.normalizeSearch(cityUfRaw.split(/[/-]/)[0]);
        const foundCity =
          cities.find((c) => this.normalizeSearch(c.text) === cleanCityPart) ||
          cities.find((c) => this.normalizeSearch(c.text).includes(cleanCityPart));
        if (foundCity) {
          return { cityId: foundCity.id, cityName: foundCity.text, stateUf: stateObj.back || 'MG' };
        }
      }
    } catch {
      // Usa Belo Horizonte/MG como fallback padrão BGR
    }

    return { cityId: 1630, cityName: cityUfRaw.split('/')[0] || 'Belo Horizonte', stateUf: 'MG' };
  }

  private buildFallbackFipeData(params: {
    vehicleTypeId: 1 | 2 | 3;
    brand: string;
    model: string;
    year: number;
    workVehicle: boolean;
    cityUf: string;
  }): PowerCrmFipeVehicleData {
    const key = this.normalizeSearch(params.model);
    const primaryWord = key.split(' ')[0];
    const entry = FALLBACK_FIPE_CATALOG[key] ||
      FALLBACK_FIPE_CATALOG[primaryWord] || {
        fipe_code: '004497-0',
        base_value_2022_brl: 78500,
        full_label: `${params.brand} ${params.model} Flex Aut.`,
      };
    const yearDiff = params.year - 2022;
    const adjustedValue = Math.max(
      14000,
      Math.round(entry.base_value_2022_brl * Math.pow(1.045, Math.max(-12, Math.min(4, yearDiff))))
    );

    return {
      source: 'powercrm_fipe_fallback',
      vehicle_type_id: params.vehicleTypeId,
      brand_id: 37,
      brand_name: params.brand,
      model_id: 10225,
      model_full_name: entry.full_label,
      model_year_id: 123,
      year_label: `${params.year} Flex`,
      fipe_code: entry.fipe_code,
      fipe_value_brl: adjustedValue,
      fipe_value_formatted: `R$ ${adjustedValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      city_id: 1630,
      city_name: params.cityUf,
      state_uf: 'MG',
      work_vehicle: params.workVehicle,
      calculated_plans: [],
    };
  }

  private normalizeSearch(str: string): string {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
