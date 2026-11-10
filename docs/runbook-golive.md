# Runbook de Produção, Alertas e Checklist de Go-Live | BGR Benefícios
**Versão**: `1.0.0`  
**Data-base**: `2026-11-10`

---

## 1. Playbook de Resposta a Alertas Operacionais (`MetricsDashboardService`)

| Categoria de Alerta | Severidade | Causa Raiz Provável | Ação Imediata do Operador (SLA < 15 min) |
|---|---|---|---|
| `CRM_AUTH_OR_OUTAGE` | `CRITICAL` / `HIGH` | Token `Power CRM - Bearer` expirado (`401/403`), rate limit (`429`) ou indisponibilidade (`503`/Timeout). | 1. Verificar credencial `Power CRM - Bearer` no n8n.<br>2. Confirmar que as conversas afetadas foram encaminhadas à fila humana (`comercial`).<br>3. Se a queda do CRM persistir por > 30 min, manter o agente apenas em modo de qualificação + handoff. |
| `SECURITY_THREAT` | `CRITICAL` | Tentativa de *Prompt Injection* (`T21`) ou extração de credenciais (`T20`) bloqueada pelo `AgentRouterService`. | 1. Inspecionar `session_id` na tabela `bgr_eventos_auditoria`.<br>2. Caso haja abuso repetido do mesmo número, bloquear o contato no canal de atendimento. |
| `STATE_MACHINE_VIOLATION` | `CRITICAL` | Recebimento de evento `member.activated` sem `signature_verified` ou `payment_verified` prévios. | 1. O sistema já bloqueou o anúncio de ativação automaticamente.<br>2. Conferir manualmente no Power CRM o status financeiro e de vistoria do associado antes de liberar confirmação humana. |

---

## 2. Checklist de Go-Live (Homologação -> Produção)

> ⚠️ **REGRA DE OURO**: Preparado não equivale a integrado; integrado não equivale a homologado; homologado não equivale a publicado. Nenhuma ativação em produção pode ocorrer sem todos os itens abaixo assinados pelo responsável BGR.

### 2.1. Validações Técnicas Concluídas no Repositório (Automatizadas)
- [x] **Fase 0**: Diagnóstico e backups sanitizados em `n8n/exports-sanitizados/`.
- [x] **Fase 1**: Repositório Git, `.env.example` sem segredos, 10 contratos JSON Schema e sanitizador LGPD (`v1.0.0-fase1`).
- [x] **Fase 2**: `PowerCrmAdapter` com timeout, retry apenas em `GET`, tratamento `401/403/404/429/503` e padronização da credencial `Power CRM - Bearer` (`v1.1.0-fase2`).
- [x] **Fase 3**: `QuotationService` com qualificação progressiva, zero invenção de preços, `idempotency_key` e contorno de objeções sem descontos não autorizados (`v1.2.0-fase3`).
- [x] **Fase 4**: `ProposalLifecycleService` com máquina de estados verificável e bloqueio de ativação prematura (`v1.3.0-fase4`).
- [x] **Fase 5**: `WhatsAppChannelService` + `HandoffService` com janela de 24h, templates, opt-out imediato e trava IA vs. Humano (`v1.4.0-fase5`).
- [x] **Fase 6**: `CampaignFollowUpService` com elegibilidade LGPD, supressão opt-out, horário comercial BRT e cadência (`v1.5.0-fase6`).
- [x] **Fase 7**: `AgentRouterService` + `MetricsDashboardService` + 32 cenários `T01`–`T32` aprovados em suíte automatizada (`v1.6.0-fase7`).

### 2.2. Validações de Ambiente Externo (Obrigatórias pelo Administrador BGR antes de Ativar Nós no n8n)
- [ ] Revisar e preencher todos os campos `[VALIDAR COM BGR]` e `[PREENCHER]` nos 8 arquivos de `knowledge-base/` e atualizar `knowledge-base/VERSAO.md` para `1.0.0-prod`.
- [ ] Confirmar no painel do n8n que a credencial `Power CRM - Bearer` está salva, vinculada ao nó `Consultar Cotação Power CRM` e testada com 1 `GET` controlado de registro fictício.
- [ ] Confirmar na documentação contratada do Power CRM se a URL base da instância BGR utiliza `/api/v1/quotations/{id}` ou `/api/quotation/{code}`.
- [ ] Aprovar os templates oficiais (`bgr_saudacao`, `bgr_cotacao_pronta`, `bgr_followup`, `bgr_reativacao`) no Meta Business Manager antes de habilitar o Webhook WhatsApp.
- [ ] Validar com o jurídico/DPO a planilha de consentimento LGPD antes de habilitar qualquer disparo de campanha de reativação.

---

## 3. Procedimento de Rollback Testado

Para reverter imediatamente qualquer alteração de código, contrato ou workflow para uma fase anterior estável:

```powershell
# Listar todas as tags de versão homologadas
git tag -l

# Fazer rollback imediato para qualquer fase anterior (ex.: v1.5.0-fase6 ou v1.0.0-fase1)
git checkout v1.5.0-fase6

# Reexecutar suíte de validação pós-rollback
npm test
```
No n8n: desativar o workflow ativo e reimportar `n8n/exports-sanitizados/bgr-agente-comercial-principal.backup-v1.0.json`.
