/**
 * BGR Benefícios — Integração Real com OpenAI API (GPT-4o-mini / GPT-4o)
 * e Conector REST / Schema SQL para Supabase
 *
 * Regras de Governança:
 * - Usa os prompts oficiais do projeto (prompts/system.md e prompts/developer.md)
 * - Extrai automaticamente entidades (nome, marca, modelo, ano, uso, cidade/UF e intenção)
 *   de qualquer frase livre do usuário
 * - NUNCA inventa preços (quando os dados do veículo estão completos, sinaliza ready_for_crm_quote=true
 *   para o QuotationService consultar o Power CRM)
 * - NUNCA expõe a OPENAI_API_KEY em logs ou respostas da API
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Lead, QuoteResult, Vehicle } from '../../domain/contracts.ts';

export interface OpenAiRuntimeConfig {
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface SupabaseRuntimeConfig {
  projectUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface OpenAiTurnInput {
  userMessage: string;
  sessionMemory: {
    lead: Partial<Lead>;
    vehicle: Partial<Vehicle>;
    currentStage: string;
    hasOfficialQuote: boolean;
    officialQuoteSummary?: string;
  };
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface OpenAiTurnOutput {
  replyText: string;
  extractedLead: Partial<Lead>;
  extractedVehicle: Partial<Vehicle>;
  readyForCrmQuote: boolean;
  wantsHumanHandoff: boolean;
  wantsPlanId: string | null;
  modelUsed: string;
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

function loadPromptFile(filename: string): string {
  try {
    return fs.readFileSync(path.join(PROJECT_ROOT, 'prompts', filename), 'utf-8');
  } catch {
    return 'Você é o assistente virtual comercial da BGR Benefícios.';
  }
}

export class OpenAiCommercialAssistant {
  private apiKey = process.env.OPENAI_API_KEY ?? '';
  private model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  private readonly systemPrompt: string;
  private readonly developerPrompt: string;

  constructor(config?: Partial<OpenAiRuntimeConfig>) {
    if (config?.apiKey) this.apiKey = config.apiKey.trim();
    if (config?.model) this.model = config.model.trim();
    this.systemPrompt = loadPromptFile('system.md');
    this.developerPrompt = loadPromptFile('developer.md');
  }

  configure(params: { apiKey?: string; model?: string }): void {
    if (typeof params.apiKey === 'string') {
      this.apiKey = params.apiKey.trim();
    }
    if (typeof params.model === 'string' && params.model.trim()) {
      this.model = params.model.trim();
    }
  }

  isConfigured(): boolean {
    return this.apiKey.startsWith('sk-') && this.apiKey.length > 15;
  }

  getMaskedKey(): string {
    if (!this.isConfigured()) return 'Não configurada (Modo Local Ativo)';
    return `${this.apiKey.slice(0, 7)}...${this.apiKey.slice(-4)}`;
  }

  getModel(): string {
    return this.model;
  }

  async processCustomerTurn(input: OpenAiTurnInput): Promise<OpenAiTurnOutput> {
    if (!this.isConfigured()) {
      throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
    }

    const extractionInstruction = `
Você é o Agente Comercial IA da BGR Benefícios (Proteção Veicular).
Responda EXCLUSIVAMENTE com um objeto JSON válido (sem markdown em volta) no formato:
{
  "reply_text": "Sua resposta natural, empática e comercial ao cliente em português do Brasil",
  "extracted_name": "Nome do cliente se informado na mensagem atual ou anterior, ou null",
  "extracted_brand": "Marca do veículo (inferida se o cliente disser só o modelo, ex: Onix -> Chevrolet, T-Cross -> Volkswagen, CG 160 -> Honda, Palio -> Fiat) ou null",
  "extracted_model": "Modelo do veículo (ex: Onix, Civic, T-Cross, CG 160, Palio) ou null",
  "extracted_year": 2022,
  "extracted_usage": "particular" | "aplicativo" | null,
  "extracted_city_uf": "Cidade/UF informada pelo cliente ou null",
  "vehicle_cleared_or_undecided": false,
  "wants_human_handoff": false,
  "wants_plan_selection": "bgr_essencial" | "bgr_completo" | null
}

REGRAS OBRIGATÓRIAS:
1. Memória atual da sessão:
   - Nome atual: ${input.sessionMemory.lead.name ?? 'não informado'}
   - Veículo atual: ${input.sessionMemory.vehicle.brand ?? ''} ${input.sessionMemory.vehicle.model ?? 'não informado'} (Ano: ${input.sessionMemory.vehicle.year ?? 'não informado'}, Uso: ${input.sessionMemory.vehicle.usage ?? 'não informado'})
   - Cidade/UF atual: ${input.sessionMemory.lead.city_uf ?? 'não informada'}
   - Etapa atual: ${input.sessionMemory.currentStage}
   - Já possui cotação oficial do CRM: ${input.sessionMemory.hasOfficialQuote ? 'SIM' : 'NÃO'}
   ${input.sessionMemory.officialQuoteSummary ? `- Resumo da Cotação Oficial: ${input.sessionMemory.officialQuoteSummary}` : ''}
2. NUNCA repita perguntas cujos dados já estão preenchidos na memória atual.
3. Para gerar a cotação oficial, precisamos de: (a) Nome, (b) Modelo do veículo, (c) Ano do veículo, (d) Uso (particular ou aplicativo), (e) Cidade onde circula. Peça apenas 1 dado faltante por vez de forma natural!
4. Se o cliente disser que ainda não escolheu o veículo ou está só pesquisando, defina "vehicle_cleared_or_undecided": true e convide-o a simular qualquer modelo que ele tenha em mente (ex: Onix 2022, HB20 2021, Corolla 2023).
5. NUNCA invente valores em reais (R$) por conta própria se "Já possui cotação oficial do CRM" for NÃO. Quando todos os 5 dados estiverem preenchidos, o sistema anexará automaticamente os valores oficiais do Power CRM!
6. NUNCA confunda o verbo "fazer" (ex: "quero fazer uma cotação") com a moto "Yamaha Fazer".`;

    const messages = [
      { role: 'system', content: `${this.systemPrompt}\n\n${this.developerPrompt}\n\n${extractionInstruction}` },
      ...input.conversationHistory.slice(-8),
      { role: 'user', content: input.userMessage },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = data.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(rawContent) as {
      reply_text?: string;
      extracted_name?: string | null;
      extracted_brand?: string | null;
      extracted_model?: string | null;
      extracted_year?: number | null;
      extracted_usage?: 'particular' | 'aplicativo' | null;
      extracted_city_uf?: string | null;
      vehicle_cleared_or_undecided?: boolean;
      wants_human_handoff?: boolean;
      wants_plan_selection?: string | null;
    };

    const mergedLead: Partial<Lead> = { ...input.sessionMemory.lead };
    if (parsed.extracted_name && parsed.extracted_name.trim()) {
      mergedLead.name = parsed.extracted_name.trim();
    }
    if (parsed.extracted_city_uf && parsed.extracted_city_uf.trim()) {
      mergedLead.city_uf = parsed.extracted_city_uf.trim();
    }

    let mergedVehicle: Partial<Vehicle> = { ...input.sessionMemory.vehicle };
    if (parsed.vehicle_cleared_or_undecided) {
      mergedVehicle = {};
    } else {
      if (parsed.extracted_brand && parsed.extracted_brand.trim()) {
        mergedVehicle.brand = parsed.extracted_brand.trim();
      }
      if (parsed.extracted_model && parsed.extracted_model.trim()) {
        mergedVehicle.model = parsed.extracted_model.trim();
        if (!mergedVehicle.brand) mergedVehicle.brand = 'Veículo';
      }
      if (typeof parsed.extracted_year === 'number' && parsed.extracted_year >= 1970 && parsed.extracted_year <= 2027) {
        mergedVehicle.year = parsed.extracted_year;
      }
      if (parsed.extracted_usage === 'particular' || parsed.extracted_usage === 'aplicativo') {
        mergedVehicle.usage = parsed.extracted_usage;
      }
    }

    const readyForCrmQuote = Boolean(
      mergedLead.name &&
        mergedVehicle.brand &&
        mergedVehicle.model &&
        mergedVehicle.year &&
        mergedVehicle.usage &&
        mergedLead.city_uf &&
        !input.sessionMemory.hasOfficialQuote
    );

    return {
      replyText:
        parsed.reply_text?.trim() ||
        'Perfeito! Como posso ajudar você com a proteção do seu veículo na BGR Benefícios?',
      extractedLead: mergedLead,
      extractedVehicle: mergedVehicle,
      readyForCrmQuote,
      wantsHumanHandoff: Boolean(parsed.wants_human_handoff),
      wantsPlanId: parsed.wants_plan_selection ?? null,
      modelUsed: this.model,
    };
  }
}

export const SUPABASE_SQL_SCHEMA = `-- =========================================================================
-- BGR Benefícios — Schema Oficial Supabase (PostgreSQL) para Produção
-- Execute no SQL Editor do seu projeto Supabase (https://supabase.com/dashboard)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.bgr_sessions (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'whatsapp_oficial',
  attendance_mode TEXT NOT NULL DEFAULT 'ia_ativa',
  current_stage TEXT NOT NULL DEFAULT 'contato_iniciado',
  lead_name TEXT,
  lead_phone TEXT,
  lead_city_uf TEXT,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_usage TEXT,
  quotation_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bgr_human_attendants (
  attendant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  queue TEXT NOT NULL DEFAULT 'comercial',
  role_title TEXT NOT NULL,
  shift_hours TEXT NOT NULL DEFAULT '08:00 às 18:00',
  status TEXT NOT NULL DEFAULT 'online',
  active_sessions_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bgr_cadence_rules (
  step_id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('vendas', 'cobranca')),
  day_label TEXT NOT NULL,
  day_offset INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '💬',
  template_id TEXT NOT NULL,
  message_template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bgr_optout_suppression (
  phone_normalized TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'PARAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bgr_audit_events (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  safe_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
