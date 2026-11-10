# Inventário de Workflows n8n e Mapa de Dependências | BGR Benefícios
**Versão**: `1.0.0`  
**Data-base**: `2026-11-10`

---

## 1. Comparativo: Histórico do Protótipo vs. Arquivos JSON no Repositório

| Componente | Estado no Histórico do Protótipo | Estado em `workflows/bgr-agente-comercial-principal.json` | Ação de Padronização (Fase 2) |
|---|---|---|---|
| **Nome do Workflow** | `BGR - Agente Comercial IA - Protótipo` | `BGR - Agente Comercial IA - v1.0` | Manter backup intacto em `n8n/exports-sanitizados/` |
| **Gatilho de Homologação** | `Chat de Teste` (`chatTrigger` v1.1) | Ativo (`webhookId: bgr-chat-teste-001`) | Confirmado para testes locais |
| **Gatilho WhatsApp** | Não comprovado | `Webhook WhatsApp` (`POST /bgr-whatsapp`, **desativado**) | Manter desativado até Fase 5 |
| **Agente e LLM** | AI Agent + OpenAI (`gpt-4o-mini`, temp `0.4`) | Ativo (`@n8n/n8n-nodes-langchain.agent` v1.7) | Sincronizar prompt com `prompts/system.md` |
| **Memória por Sessão** | `memoryBufferWindow` (janela 20) | Ativo (`sessionIdType: fromInput`) | Garantir chave de sessão isolada por canal |
| **Tool: Consultar Cotação** | Desativado; URL histórica: `https://api.powercrm.com.br/api/quotation/{{ $json.quotationCode }}` | Desativado; URL no JSON: `https://api.powercrm.com.br/api/v1/quotations/{quotation_code}` | Auditar rota real no portal Power CRM antes de ativar |
| **Credencial Power CRM** | `Power CRM - Bearer` (vínculo não confirmado) | `Power CRM API - BGR` (`httpHeaderAuth`, `id: ""`) | Unificar nome para `Power CRM - Bearer` e validar no n8n |
| **Tools de Lead (`GET`/`POST`)** | Planejadas | Preparadas e **desativadas** no JSON (`Consultar Lead` / `Criar Lead`) | Conectar via Adapter validado com `idempotency_key` |
| **Saída WhatsApp** | Planejada | `Responder WhatsApp` (`respondToWebhook`, **desativado**) | Substituir por `ACK 200` imediato + `POST` Graph API na Fase 5 |

---

## 2. Inventário dos Demais Workflows Auxiliares

### 2.1. `workflows/bgr-follow-up-comercial.json`
- **Objetivo**: Busca diária (9h BRT) de leads abertos nos últimos 7 dias e disparo de template WhatsApp por estágio (`cotacao_enviada`, `aguardando_assinatura`, `primeiro_contato`, `negociacao`).
- **Status de Segurança**: **100% dos nós desativados** (`disabled: true`).
- **Dependências Pendentes**:
  1. Validação do endpoint `GET /api/v1/leads?status=open&updated_since=...`.
  2. Substituição do placeholder `https://YOUR_WHATSAPP_API_URL/v1/messages`.
  3. Checagem obrigatória de `opt-out` e janela comercial antes do envio.

### 2.2. `workflows/bgr-campanha-reativacao.json`
- **Objetivo**: Importação de planilha de ex-associados, filtro de consentimento LGPD (`autorizacao_contato == sim/true`), controle de lotes (10 a cada 30s) e envio do template `bgr_reativacao`.
- **Status de Segurança**: Nós de disparo HTTP e registro no CRM estão **desativados** (`disabled: true`).
- **Dependências Pendentes**:
  1. O nó `Verificar Descadastro` está apenas como placeholder (verifica se `telefone` não é vazio). Deve consultar a base real de supressão (`opt_out = true`).
  2. Aprovação prévia do template `bgr_reativacao` na Meta e validação da base legal LGPD.

---

## 3. Regra de Backup e Rollback
1. Nenhum arquivo em `workflows/` deve ser sobrescrito sem antes salvar cópia imutável em `n8n/exports-sanitizados/`.
2. Antes de qualquer importação no servidor n8n da BGR, exportar o workflow em produção/homologação, remover eventuais segredos com o sanitizador (`src/observability/sanitizer.ts`) e arquivar com data e versão.
