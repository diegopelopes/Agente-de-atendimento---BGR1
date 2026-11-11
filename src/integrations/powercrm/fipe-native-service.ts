/**
 * BGR Benefícios — Serviço de Consulta à API FIPE Nativa e Cálculo de Planos do Power CRM
 *
 * Conecta diretamente nas rotas nativas do Power CRM (https://api.powercrm.com.br/api):
 * 1. GET /api/quotation/cb?type={1|2|3}        -> Busca ID da Marca FIPE (1=Carro, 2=Moto, 3=Caminhão)
 * 2. GET /api/quotation/cmby?cb={id}&cy={year} -> Busca Versões FIPE do Modelo no Ano + Código FIPE (back) + Valor FIPE (value)
 * 3. GET /api/quotation/cmy?cm={modelId}       -> Busca ID do Ano/Combustível (carModelYearId)
 * 4. GET /api/quotation/stt & /ct?st={stateId} -> Busca ID da Cidade/UF no Power CRM
 * 5. POST /api/plans/                          -> Calcula os Planos Oficiais da BGR para o veículo FIPE e cidade
 * 6. GET /api/quotation/plates/{plate}         -> Consulta opcional por Placa do veículo
 */

import type { QuotePlanOption } from '../../domain/contracts.ts';

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

const MOTORCYCLE_MODELS_REGEX = /\b(cg\s*160|cg\s*150|titan|fan\s*160|start\s*160|biz|bros|xre|sahara|pcx|cb\s*300|twister|cb\s*500|hornet|fazer|factor|lander|tenere|crosser|mt-03|mt-07|nmax|neo\s*125|florence|harley|royal\s*enfield)\b/i;

const FALLBACK_FIPE_CATALOG: Record<
  string,
  { fipe_code: string; base_value_2022_brl: number; full_label: string }
> = {
  civic: { fipe_code: '014091-0', base_value_2022_brl: 119800, full_label: 'Civic Sedan EX 2.0 Flex 16V Aut. 4p' },
  city: { fipe_code: '014108-9', base_value_2022_brl: 93861, full_label: 'CITY Hatchback EXL 1.5 Flex 16V Aut.' },
  'hr-v': { fipe_code: '014087-2', base_value_2022_brl: 127400, full_label: 'HR-V EXL 1.8 Flexone 16V 5p Aut.' },
  fit: { fipe_code: '014081-3', base_value_2022_brl: 82900, full_label: 'Fit EX 1.5 Flexone 16V 5p Aut.' },
  'cg 160': { fipe_code: '811138-3', base_value_2022_brl: 16890, full_label: 'CG 160 Titan Flexone' },
  biz: { fipe_code: '811140-5', base_value_2022_brl: 14500, full_label: 'Biz 125 Flexone' },
  bros: { fipe_code: '811139-1', base_value_2022_brl: 19200, full_label: 'NXR 160 Bros ESDD Flexone' },
  corolla: { fipe_code: '002111-3', base_value_2022_brl: 128900, full_label: 'Corolla XEi 2.0 Flex 16V Direct Shift' },
  'corolla cross': { fipe_code: '002201-2', base_value_2022_brl: 142500, full_label: 'Corolla Cross XRE 2.0 16V Flex Aut.' },
  hilux: { fipe_code: '002114-8', base_value_2022_brl: 219500, full_label: 'Hilux CD SRV 4x4 2.8 TDI Diesel Aut.' },
  yaris: { fipe_code: '002174-1', base_value_2022_brl: 86400, full_label: 'Yaris XL Live 1.3 Flex 16V 5p Aut.' },
  onix: { fipe_code: '004497-0', base_value_2022_brl: 78500, full_label: 'ONIX HATCH LT 1.0 12V TB Flex 5p Aut.' },
  tracker: { fipe_code: '004522-5', base_value_2022_brl: 108900, full_label: 'Tracker LT 1.0 Turbo 12V Flex Aut.' },
  s10: { fipe_code: '004393-1', base_value_2022_brl: 198000, full_label: 'S10 Pick-Up LTZ 2.8 TDI 4x4 CD Diesel Aut' },
  strada: { fipe_code: '001529-6', base_value_2022_brl: 96400, full_label: 'Strada Freedom 1.3 Flex 8V CD' },
  toro: { fipe_code: '001463-0', base_value_2022_brl: 118700, full_label: 'Toro Freedom 1.3 T270 4x2 Flex Aut.' },
  argo: { fipe_code: '001491-5', base_value_2022_brl: 68900, full_label: 'Argo Drive 1.0 6V Flex' },
  mobi: { fipe_code: '001461-3', base_value_2022_brl: 54900, full_label: 'Mobi Like 1.0 Fire Flex 5p.' },
  pulse: { fipe_code: '001543-1', base_value_2022_brl: 94200, full_label: 'Pulse Drive 1.3 Flex 8V Aut.' },
  palio: { fipe_code: '001266-1', base_value_2022_brl: 42500, full_label: 'Palio Attractive 1.0 EVO Fire Flex 8v 5p' },
  uno: { fipe_code: '001343-9', base_value_2022_brl: 46800, full_label: 'Uno Attractive 1.0 Fire Flex 8V 5p' },
  gol: { fipe_code: '005490-9', base_value_2022_brl: 58900, full_label: 'Gol 1.0 Flex 12V 5p' },
  polo: { fipe_code: '005479-8', base_value_2022_brl: 83500, full_label: 'Polo Comfortline 200 TSI 1.0 Flex 12V Aut' },
  't-cross': { fipe_code: '005510-7', base_value_2022_brl: 112900, full_label: 'T-Cross 200 TSI 1.0 Flex 12V 5p Aut.' },
  nivus: { fipe_code: '005525-5', base_value_2022_brl: 109800, full_label: 'Nivus Comfortline 1.0 200 TSI Flex Aut.' },
  hb20: { fipe_code: '015188-2', base_value_2022_brl: 74900, full_label: 'HB20 Vision 1.0 Flex 12V Mec.' },
  creta: { fipe_code: '015145-9', base_value_2022_brl: 114500, full_label: 'Creta Action 1.6 16V Flex Aut.' },
  compass: { fipe_code: '017076-3', base_value_2022_brl: 144900, full_label: 'Compass Longitude T270 1.3 TB 4x2 Flex Aut' },
  renegade: { fipe_code: '017085-2', base_value_2022_brl: 112400, full_label: 'Renegade Sport T270 1.3 TB 4x2 Flex Aut.' },
  kicks: { fipe_code: '023146-0', base_value_2022_brl: 98900, full_label: 'Kicks Sense 1.6 16V Flex Aut.' },
  kwid: { fipe_code: '025266-2', base_value_2022_brl: 53400, full_label: 'KWID Zen 1.0 Flex 12V 5p Mec.' },
  duster: { fipe_code: '025293-0', base_value_2022_brl: 96800, full_label: 'Duster Iconic 1.6 16V Flex Aut.' },
};

export class PowerCrmNativeFipeService {
  private baseUrl: string;
  private bearerToken: string;
  private brandsCache = new Map<number, CrmItemIdString[]>();
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
   * Marca (cb) -> Modelo e Valor FIPE no Ano (cmby) -> Ano/Combustível (cmy) -> Cidade/UF (stt/ct) -> Planos Reais (POST /api/plans/)
   */
  async lookupFipeAndPlans(params: {
    brand: string;
    model: string;
    year: number;
    usage: 'particular' | 'aplicativo' | 'comercial' | 'frota';
    cityUf: string;
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

  private async executeLiveCrmFipeFlow(params: {
    vehicleTypeId: 1 | 2 | 3;
    brand: string;
    model: string;
    year: number;
    workVehicle: boolean;
    cityUf: string;
  }): Promise<PowerCrmFipeVehicleData | null> {
    const headers = this.getHeaders();

    // 1. Busca Marcas FIPE (GET /quotation/cb?type=1|2)
    let brands = this.brandsCache.get(params.vehicleTypeId);
    if (!brands) {
      const cbRes = await fetch(`${this.baseUrl}/quotation/cb?type=${params.vehicleTypeId}`, { headers });
      if (!cbRes.ok) return null;
      brands = (await cbRes.json()) as CrmItemIdString[];
      this.brandsCache.set(params.vehicleTypeId, brands);
    }

    const cleanBrand = this.normalizeSearch(params.brand);
    const matchedBrand =
      brands.find((b) => this.normalizeSearch(b.text) === cleanBrand) ||
      brands.find((b) => this.normalizeSearch(b.text).includes(cleanBrand) || cleanBrand.includes(this.normalizeSearch(b.text)));

    if (!matchedBrand) return null;

    // 2. Busca Modelos FIPE no Ano (GET /quotation/cmby?cb={brandId}&cy={year})
    // Se o modelo específico não teve versão naquele ano exato (ex: Civic 2022 no Brasil), tenta ano-1 ou ano+1
    const cleanModel = this.normalizeSearch(params.model);
    let matchedModel: CrmItemIdString | undefined;
    let effectiveYear = params.year;

    for (const candidateYear of [params.year, params.year - 1, params.year + 1, 2022, 2021]) {
      const cmbyRes = await fetch(
        `${this.baseUrl}/quotation/cmby?cb=${matchedBrand.id}&cy=${candidateYear}`,
        { headers }
      );
      if (!cmbyRes.ok) continue;
      const modelsInYear = (await cmbyRes.json()) as CrmItemIdString[];
      if (!Array.isArray(modelsInYear) || modelsInYear.length === 0) continue;

      const found =
        modelsInYear.find((m) => this.normalizeSearch(m.text).startsWith(cleanModel + ' ')) ||
        modelsInYear.find((m) => this.normalizeSearch(m.text).includes(cleanModel));

      if (found) {
        matchedModel = found;
        effectiveYear = candidateYear;
        break;
      }
    }

    if (!matchedModel) return null;

    // 3. Busca carModelYearId (GET /quotation/cmy?cm={modelId})
    const cmyRes = await fetch(`${this.baseUrl}/quotation/cmy?cm=${matchedModel.id}`, { headers });
    if (!cmyRes.ok) return null;
    const yearsForModel = (await cmyRes.json()) as CrmItemIdString[];
    const matchedYearObj =
      yearsForModel.find((y) => String(y.text).includes(String(effectiveYear))) ||
      yearsForModel.find((y) => String(y.text).includes(String(params.year))) ||
      yearsForModel[0];

    if (!matchedYearObj) return null;

    // 4. Resolve Cidade e UF (padrão rápido: Belo Horizonte/MG = 1630, São Paulo/SP = 5270, Rio de Janeiro/RJ = 3658)
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

      // Filtra planos principais de proteção veicular (como BGR PLUS, Essencial, Master, Light)
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
      vehicle_type_id: params.vehicleTypeId,
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
      const stateObj = this.statesCache?.find((s) => s.back === uf) || { id: 11, text: 'Minas Gerais', back: 'MG', value: null };
      const ctRes = await fetch(`${this.baseUrl}/quotation/ct?st=${stateObj.id}`, { headers });
      if (ctRes.ok) {
        const cities = (await ctRes.json()) as CrmItemIdString[];
        const cleanCityPart = this.normalizeSearch(cityUfRaw.split(/[/-]/)[0]);
        const foundCity = cities.find((c) => this.normalizeSearch(c.text) === cleanCityPart) ||
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
    const key = params.model.toLowerCase().trim();
    const entry = FALLBACK_FIPE_CATALOG[key] || {
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
