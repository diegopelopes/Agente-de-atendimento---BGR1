# Protocolo de Transferência para Atendimento Humano (Handoff) | BGR Benefícios

> **Módulo**: Seção 12 — Transferência Real para Equipe Humana  
> **Regra Central**: O agente **NUNCA** deve declarar que a transferência já ocorreu antes de receber a confirmação do sistema receptor, e deve **PAUSAR** sua atuação comercial após a transferência para não falar simultaneamente com o atendente humano.

---

## 1. Gatilhos Obrigatórios de Transferência

| Gatilho | Setor de Destino | Prioridade |
|---------|------------------|------------|
| Cliente solicita explicitamente falar com uma pessoa | Comercial / Atendimento | ALTA |
| Dúvida não consta na base de conhecimento ou não há segurança | Comercial / Especialista | ALTA |
| Conflito de informações ou divergência de valores | Comercial | ALTA |
| Solicitação de desconto ou condição especial fora da tabela | Comercial (Supervisor) | MÉDIA |
| Veículo especial (leilão, modificado, acima do teto FIPE) | Comercial / Vistoria | MÉDIA |
| Reclamação sensível, insatisfação grave ou conflito contratual | Ouvidoria / Retenção | CRÍTICA |
| Pedido de cancelamento da proteção | Retenção / Associado | ALTA |
| Comunicação de sinistro (roubo, furto, colisão) | Sinistros / Assistência 24h | CRÍTICA |
| Falha impeditiva na API do Power CRM (timeout / erro 500) | Comercial (Contingência) | ALTA |

---

## 2. Estrutura do Payload de Encaminhamento

Quando um gatilho de transferência é acionado, o workflow envia ao sistema de atendimento humano / Power CRM o seguinte envelope estruturado:

```json
{
  "atendimento_id": "sess_20261109_abc123",
  "timestamp": "2026-11-09T21:25:00-03:00",
  "canal": "whatsapp_oficial",
  "setor_responsavel": "comercial",
  "prioridade": "ALTA",
  "motivo_transferencia": "Solicitação direta do cliente para falar com consultor humano",
  "cliente": {
    "nome": "Carlos Eduardo",
    "telefone": "+5511999990001",
    "lead_id_crm": "LEAD-9876",
    "cotacao_codigo": "COT-54321"
  },
  "veiculo": {
    "marca": "Honda",
    "modelo": "Civic",
    "ano": 2022
  },
  "resumo_conversa": "Cliente iniciou contato para nova cotação de Honda Civic 2022. Recebeu explicação inicial sobre coberturas e solicitou falar com atendente humano para negociar condições.",
  "status_recebimento": "aguardando_confirmacao"
}
```

---

## 3. Controle de Sessão (Trava de Concorrência IA vs. Humano)

Para impedir que o Agente IA continue respondendo enquanto o atendente humano assume a conversa:

1. **Flag de Sessão (`modo_atendimento`)**:
   - `ia_ativa`: O Agente IA processa e responde às mensagens normalmente.
   - `aguardando_humano`: O pedido de transferência foi enviado; se o cliente mandar nova mensagem antes do humano assumir, o sistema informa apenas que o atendente já foi acionado e assumirá em instantes.
   - `humano_ativo`: O webhook/n8n ignora o nó do Agente IA e roteia as mensagens exclusivamente para a fila humana.
2. **Retorno para IA**:
   - Somente quando o atendente humano encerrar o ticket ou devolver explicitamente a sessão para `ia_ativa`.
