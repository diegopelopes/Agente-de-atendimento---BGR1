# Contratos de Integração — Power CRM & Domínio BGR
**Versão**: `1.0.0`  
**Data-base**: `2026-11-10`

> ⚠️ **AVISO DE EVIDÊNCIA**: As URLs da API Power CRM (`/api/v1/quotations/...` e `/api/quotation/...`) são tratadas como **CONFIGURAÇÃO HISTÓRICA NÃO VALIDADA** até homologação oficial no ambiente da BGR com a credencial `Power CRM - Bearer`. Por isso, toda lógica de negócio interage exclusivamente com os **Contratos de Domínio Internos** abaixo através do `PowerCRM Adapter`.

---

## 1. Entidades e Contratos Tipados (`src/domain/contracts.schema.json`)

Todas as trocas de dados entre o Orquestrador (n8n), a Camada de Domínio e o `PowerCRM Adapter` seguem os 10 contratos canônicos abaixo:

1. **`Lead`**:
   - Campos obrigatórios: `id`, `name`, `phone`, `origin`, `created_at`, `updated_at`.
   - Campos opcionais: `email`, `document_masked`, `city_uf`, `external_crm_id`.
2. **`Vehicle`**:
   - Campos obrigatórios: `brand`, `model`, `year`, `usage` (`particular` | `aplicativo` | `comercial` | `taxi`).
   - Campos opcionais: `plate_masked`, `fipe_code`, `estimated_value_brl`, `is_auction` (leilão), `is_modified`.
3. **`QuoteRequest`**:
   - Campos obrigatórios: `idempotency_key`, `correlation_id`, `session_id`, `lead_id`, `vehicle`, `requested_at`.
   - Regra de negócio: Rejeita solicitação se faltar `lead.name`, `vehicle.model`, `vehicle.year` ou `vehicle.usage`.
4. **`QuoteResult`**:
   - Campos obrigatórios: `quote_id`, `quotation_code`, `status` (`oficial_calculada` | `pendente_analise_humana` | `inelegivel` | `erro_integracao`), `source` (`powercrm_oficial` | `mock_homologacao`), `plans`, `valid_until`, `fetched_at`.
   - Regra de negócio: Nenhum plano é válido se `monthly_fee_brl <= 0` ou se `source` não for identificado.
5. **`Conversation`**:
   - Campos obrigatórios: `session_id`, `channel` (`chat_teste` | `whatsapp_oficial`), `attendance_mode` (`ia_ativa` | `aguardando_humano` | `humano_ativo`), `current_stage`, `started_at`, `last_interaction_at`.
6. **`Consent`**:
   - Campos obrigatórios: `contact_id`, `phone_hash`, `opt_in_status` (`granted` | `revoked` | `unknown`), `legal_basis` (`execucao_contrato` | `consentimento_explicito` | `legitimo_interesse`), `opt_out_requested`, `updated_at`.
7. **`Opportunity`**:
   - Campos obrigatórios: `opportunity_id`, `lead_id`, `quote_id`, `stage`, `signature_verified`, `payment_verified`, `inspection_verified`, `activation_confirmed`, `updated_at`.
   - **Invariante Crítica**: `stage == 'contratacao_confirmada'` e `activation_confirmed == true` **EXIGEM** `signature_verified == true` **E** `payment_verified == true`.
8. **`Handoff`**:
   - Campos obrigatórios: `ticket_id`, `session_id`, `target_queue` (`comercial` | `suporte` | `sinistros` | `financeiro` | `retencao` | `ouvidoria`), `priority` (`BAIXA` | `MEDIA` | `ALTA` | `CRITICA`), `reason`, `conversation_summary`, `acknowledgment_status` (`aguardando_confirmacao` | `confirmado` | `falha`), `created_at`.
9. **`PaymentStatus`**:
   - Campos obrigatórios: `payment_id`, `opportunity_id`, `status` (`nao_iniciado` | `aguardando_pagamento` | `comprovante_enviado_nao_validado` | `confirmado_oficial` | `vencido` | `estornado`), `verified_by_system`, `updated_at`.
   - **Invariante Crítica**: `comprovante_enviado_nao_validado` tem `verified_by_system = false` e **jamais** autoriza ativação.
10. **`AuditEvent`**:
    - Campos obrigatórios: `event_id`, `idempotency_key`, `correlation_id`, `timestamp`, `environment` (`teste` | `homologacao` | `producao`), `company_id`, `session_id`, `event_type`, `severity`, `status`, `safe_summary`.
    - **Invariante de Segurança**: `safe_summary` e `details` passam obrigatoriamente pelo `Sanitizer`, impedindo gravação de `Bearer`, CPF completo, placa completa ou cartão.

---

## 2. Política de Resiliência do PowerCRM Adapter (Fase 2)

| Cenário HTTP / Rede | Comportamento do Adapter | Ação Recomendada ao Agente |
|---|---|---|
| `200 OK` / `201 Created` | Valida schema de retorno; retorna `status: success` com `correlation_id`. | Prosseguir com dados oficiais. |
| `401 Unauthorized` / `403 Forbidden` | **Não faz retry**; gera alerta crítico de credencial; retorna `ERR_CRM_AUTH`. | Informar indisponibilidade momentânea e oferecer consultor humano. |
| `404 Not Found` | **Não faz retry**; retorna `ERR_CRM_NOT_FOUND`. | Pedir confirmação do código ao cliente ou iniciar nova cotação. |
| `429 Too Many Requests` | Aguarda `Retry-After` (apenas em `GET`); retorna `ERR_CRM_RATE_LIMIT`. | Informar que está processando e transferir se persistir. |
| `500/502/503/504` ou `TIMEOUT` | Faz até 2 retries com backoff **somente em operações `GET` idempotentes**; retorna `ERR_CRM_UNAVAILABLE`. | Acionar fallback humano sem inventar valores. |
