-- =========================================================================================
-- BGR Benefícios — Modelagem Relacional Completa (PostgreSQL / Supabase)
-- Projeto Supabase: mxynaxlpdfraalbfrgyx (https://mxynaxlpdfraalbfrgyx.supabase.co)
-- =========================================================================================
-- Diagrama de Relacionamentos (Chaves Estrangeiras / Integridade Referencial):
--   1. public.bgr_leads (1) ───────────────< (N) public.bgr_vehicles_fipe
--   2. public.bgr_leads (1) ───────────────< (N) public.bgr_quotations
--   3. public.bgr_vehicles_fipe (1) ───────< (N) public.bgr_quotations
--   4. public.bgr_quotations (1) ──────────< (N) public.bgr_opportunities
--   5. public.bgr_human_attendants (1) ────< (N) public.bgr_sessions
--   6. public.bgr_leads (1) ───────────────< (N) public.bgr_sessions
--   7. public.bgr_quotations (1) ──────────< (N) public.bgr_sessions
--   8. public.bgr_cadence_rules (1) ───────< (N) public.bgr_cadence_dispatches
--   9. public.bgr_sessions (1) ────────────< (N) public.bgr_audit_events
--  10. public.bgr_optout_suppression (Tabela de Supressão LGPD Independente)
-- =========================================================================================

BEGIN;

-- 1. TABELA DE LEADS (CLIENTES / PROSPECTS)
CREATE TABLE IF NOT EXISTS public.bgr_leads (
  lead_id TEXT PRIMARY KEY,
  external_crm_id TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  document_masked TEXT,
  city_uf TEXT NOT NULL DEFAULT 'Belo Horizonte/MG',
  origin TEXT NOT NULL DEFAULT 'whatsapp_oficial',
  powercrm_origin_id INTEGER DEFAULT 19266, -- 19266=BGR-DIEGO, 19265=BGR-BRAZ, 19264=BGR-RANGEL
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_leads_phone ON public.bgr_leads (phone);

-- 2. TABELA DE VEÍCULOS & FICHA TÉCNICA FIPE NATIVA (POWER CRM)
CREATE TABLE IF NOT EXISTS public.bgr_vehicles_fipe (
  vehicle_id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.bgr_leads(lead_id) ON DELETE CASCADE,
  vehicle_type_id SMALLINT NOT NULL DEFAULT 1, -- 1=Carro/Utilitário, 2=Moto, 3=Caminhão
  brand_id INTEGER,
  brand TEXT NOT NULL,
  model_id INTEGER,
  model TEXT NOT NULL,
  model_full_name TEXT,
  model_year_id INTEGER,
  year INTEGER NOT NULL,
  usage TEXT NOT NULL DEFAULT 'particular' CHECK (usage IN ('particular', 'aplicativo', 'comercial', 'frota')),
  fipe_code TEXT,
  fipe_value_brl NUMERIC(12, 2),
  plate_masked TEXT,
  is_auction BOOLEAN NOT NULL DEFAULT FALSE,
  is_modified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_vehicles_lead_id ON public.bgr_vehicles_fipe (lead_id);
CREATE INDEX IF NOT EXISTS idx_bgr_vehicles_fipe_code ON public.bgr_vehicles_fipe (fipe_code);

-- 3. TABELA DE COTAÇÕES OFICIAIS (POWER CRM + TABELA FIPE)
CREATE TABLE IF NOT EXISTS public.bgr_quotations (
  quotation_code TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  lead_id TEXT REFERENCES public.bgr_leads(lead_id) ON DELETE SET NULL,
  vehicle_id TEXT REFERENCES public.bgr_vehicles_fipe(vehicle_id) ON DELETE SET NULL,
  fipe_code TEXT,
  fipe_value_brl NUMERIC(12, 2),
  status TEXT NOT NULL DEFAULT 'oficial_calculada',
  source TEXT NOT NULL DEFAULT 'powercrm_oficial',
  plans_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_until TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_quotations_lead_id ON public.bgr_quotations (lead_id);

-- 4. TABELA DE OPORTUNIDADES E CICLO DE VIDA DA PROPOSTA (ASSINATURA, PAGAMENTO, VISTORIA E ATIVAÇÃO)
CREATE TABLE IF NOT EXISTS public.bgr_opportunities (
  opportunity_id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES public.bgr_leads(lead_id) ON DELETE SET NULL,
  quotation_code TEXT REFERENCES public.bgr_quotations(quotation_code) ON DELETE SET NULL,
  selected_plan_id TEXT NOT NULL,
  selected_plan_name TEXT,
  monthly_fee_brl NUMERIC(10, 2),
  stage TEXT NOT NULL DEFAULT 'proposta_enviada',
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  inspection_approved BOOLEAN NOT NULL DEFAULT FALSE,
  member_activated BOOLEAN NOT NULL DEFAULT FALSE,
  protection_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_opportunities_quotation ON public.bgr_opportunities (quotation_code);

-- 5. TABELA DE ATENDENTES HUMANOS (CONSULTORES BGR / HANDOFF SETORIAL)
CREATE TABLE IF NOT EXISTS public.bgr_human_attendants (
  attendant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  queue TEXT NOT NULL DEFAULT 'comercial' CHECK (queue IN ('comercial', 'vistoria', 'financeiro', 'sinistro', 'retencao', 'ouvidoria')),
  role_title TEXT NOT NULL,
  shift_hours TEXT NOT NULL DEFAULT '08:00 às 18:00',
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'ocupado', 'pausa', 'offline')),
  active_sessions_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TABELA DE SESSÕES DE ATENDIMENTO E MEMÓRIA CONTEXTUAL (WHATSAPP / SIMULADOR)
CREATE TABLE IF NOT EXISTS public.bgr_sessions (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'whatsapp_oficial',
  attendance_mode TEXT NOT NULL DEFAULT 'ia_ativa' CHECK (attendance_mode IN ('ia_ativa', 'aguardando_humano', 'humano_ativo')),
  current_stage TEXT NOT NULL DEFAULT 'contato_iniciado',
  lead_id TEXT REFERENCES public.bgr_leads(lead_id) ON DELETE SET NULL,
  quotation_code TEXT REFERENCES public.bgr_quotations(quotation_code) ON DELETE SET NULL,
  assigned_attendant_id TEXT REFERENCES public.bgr_human_attendants(attendant_id) ON DELETE SET NULL,
  lead_name TEXT,
  lead_phone TEXT,
  lead_city_uf TEXT,
  vehicle_brand TEXT,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_usage TEXT,
  fipe_code TEXT,
  fipe_value_brl NUMERIC(12, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_sessions_stage ON public.bgr_sessions (current_stage);
CREATE INDEX IF NOT EXISTS idx_bgr_sessions_lead_phone ON public.bgr_sessions (lead_phone);

-- 7. TABELA DE REGRAS DA RÉGUA DE CADÊNCIA (VENDAS D+1/D+3/D+7 E COBRANÇAS)
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

-- 8. TABELA DE HISTÓRICO DE DISPAROS DA RÉGUA (RELACIONADA À REGRA DE CADÊNCIA)
CREATE TABLE IF NOT EXISTS public.bgr_cadence_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES public.bgr_cadence_rules(step_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('vendas', 'cobranca')),
  day_label TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_phone TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone_masked TEXT NOT NULL,
  eligibility BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_status TEXT NOT NULL,
  rendered_message TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_cadence_dispatches_step_id ON public.bgr_cadence_dispatches (step_id);

-- 9. TABELA DE SUPRESSÃO DE OPT-OUT (CONFORMIDADE LGPD / COMANDO "PARAR")
CREATE TABLE IF NOT EXISTS public.bgr_optout_suppression (
  phone_normalized TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'PARAR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. TABELA DE AUDITORIA E OBSERVABILIDADE SANITIZADA (LGPD / ANTI-LEAK)
CREATE TABLE IF NOT EXISTS public.bgr_audit_events (
  event_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status TEXT NOT NULL,
  safe_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgr_audit_events_session ON public.bgr_audit_events (session_id);
CREATE INDEX IF NOT EXISTS idx_bgr_audit_events_created_at ON public.bgr_audit_events (created_at DESC);

-- =========================================================================================
-- DADOS INICIAIS (SEED) PARA OPERAÇÃO IMEDIATA
-- =========================================================================================

INSERT INTO public.bgr_human_attendants (attendant_id, name, email, whatsapp_phone, queue, role_title, shift_hours, status, active_sessions_count)
VALUES
  ('att_bgr_diego', 'Diego Gomes (BGR - DIEGO #19266)', 'diego@bgrbeneficios.com.br', '+5531998887766', 'comercial', 'Consultor Comercial Sênior BGR', '08:00 às 18:00', 'online', 0),
  ('att_bgr_braz', 'Consultor Braz (BGR - BRAZ #19265)', 'braz@bgrbeneficios.com.br', '+5531998887767', 'comercial', 'Consultor Comercial BGR', '08:00 às 18:00', 'online', 0),
  ('att_bgr_rangel', 'Consultor Rangel (BGR - RANGEL #19264)', 'rangel@bgrbeneficios.com.br', '+5531998887768', 'comercial', 'Consultor Comercial BGR', '08:00 às 18:00', 'online', 0)
ON CONFLICT (attendant_id) DO NOTHING;

COMMIT;
