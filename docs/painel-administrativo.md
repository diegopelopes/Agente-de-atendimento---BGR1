# Especificação do Painel Administrativo e Indicadores (KPIs) | BGR Benefícios

> **Módulo**: Etapa 7 — Painel Gerencial, Auditoria e Relatórios  
> **Regra Central**: Exibir exclusivamente indicadores fundamentados em eventos reais registrados e verificáveis nos logs de auditoria e no Power CRM.

---

## 1. Indicadores Principais (KPIs)

| Grupo | Indicador | Fonte Oficial do Evento | Fórmula / Métrica |
|-------|-----------|-------------------------|-------------------|
| **Atendimento** | Conversas Recebidas | Webhook WhatsApp / Sessões n8n | Total de sessões únicas iniciadas no período |
| **Atendimento** | Tempo Médio de Resposta (TMR) | Log de Execução n8n | `timestamp_resposta - timestamp_recebimento` |
| **Comercial** | Leads Novos Qualificados | Power CRM (`POST /leads` confirmado) | Total de leads criados com HTTP 200/201 |
| **Comercial** | Cotações Geradas | Power CRM (`quotation.created`) | Total de cotações oficiais retornadas |
| **Comercial** | Propostas Enviadas | Power CRM (`proposal.created`) | Total de links de proposta gerados e entregues |
| **Conversão** | Contratações Confirmadas | Power CRM Webhook (`member.activated`) | Apenas ativações com assinatura + pagamento confirmados |
| **Conversão** | Taxa de Conversão Comercial | Eventos verificados | `(Contratações Confirmadas / Leads Qualificados) * 100` |
| **Reativação** | Campanhas de Reativação | Workflow Reativação | Total de mensagens-modelo entregues com autorização |
| **Reativação** | Ex-Associados Recuperados | Power CRM (`member.reactivated`) | Ex-associados com status ativo confirmado |
| **Perdas** | Oportunidades Perdidas | Power CRM (`status = lost`) | Total de negociações encerradas sem contratação |
| **Perdas** | Motivos de Perda | Classificação no CRM | Distribuição por motivo (preço, concorrência, desistência, inelegível) |
| **Transbordo** | Atendimentos Encaminhados (Humano) | Evento `handoff.confirmed` | Total de transferências confirmadas por setor |
| **Operacional** | Erros de Integração | Error Workflow n8n | Falhas HTTP 4xx/5xx, timeouts Power CRM / WhatsApp |
| **Financeiro** | Custos Operacionais e de IA | Contagem de Tokens OpenAI + Meta API | `tokens_prompt + tokens_completion` + conversas faturadas Meta |

---

## 2. Filtros Obrigatórios do Painel

1. **Período**: Hoje, Últimos 7 dias, Últimos 30 dias, Mês Atual, Personalizado (`data_inicio` a `data_fim`).
2. **Campanha**: Orgânico (Inbound), Reativação Ex-Associados, Follow-up Automático, Tráfego Pago.
3. **Canal**: WhatsApp Oficial, Chat de Teste (Homologação).
4. **Etapa do Funil**:
   - `Novo Lead`
   - `Contato Iniciado`
   - `Qualificação em Andamento`
   - `Cotação Preparada`
   - `Cotação Enviada`
   - `Cliente Interessado`
   - `Cliente Indeciso`
   - `Aguardando Assinatura`
   - `Aguardando Pagamento`
   - `Contratação Confirmada`
   - `Oportunidade Perdida`
   - `Atendimento Humano Solicitado`
5. **Responsável / Setor**: Agente IA, Comercial Humano, Assistência/Sinistro, Financeiro, Retenção.

---

## 3. Estrutura do Banco de Eventos (Auditoria e BI)

Para alimentar o painel (via Supabase / PostgreSQL conectado ao n8n), cada evento relevante do workflow grava um registro na tabela `bgr_eventos_auditoria`:

```sql
CREATE TABLE bgr_eventos_auditoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id VARCHAR(50) NOT NULL DEFAULT 'bgr_beneficios',
    ambiente VARCHAR(20) NOT NULL DEFAULT 'teste', -- 'teste' ou 'producao'
    sessao_id VARCHAR(100) NOT NULL,
    lead_id_crm VARCHAR(100),
    cotacao_codigo VARCHAR(100),
    tipo_evento VARCHAR(60) NOT NULL,
    etapa_funil VARCHAR(50),
    canal VARCHAR(30) NOT NULL,
    campanha VARCHAR(60),
    setor_destino VARCHAR(50),
    motivo_perda VARCHAR(100),
    tempo_resposta_ms INTEGER,
    tokens_ia_utilizados INTEGER DEFAULT 0,
    custo_estimado_usd NUMERIC(10, 6) DEFAULT 0,
    status_integracao VARCHAR(30) NOT NULL, -- 'sucesso', 'pendente', 'erro'
    codigo_http INTEGER,
    resumo_seguro TEXT, -- Sem dados sensíveis completos (CPF/cartão mascarados)
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
