# Variáveis de Ambiente e Configuração

> Configurações específicas da BGR Benefícios que devem ser separadas para permitir replicação do sistema.

## Dados da Empresa

```yaml
empresa:
  nome: "BGR Benefícios"
  nome_curto: "BGR"
  segmento: "Proteção Veicular"
  cnpj: "[PREENCHER]"
  site: "[PREENCHER]"
  email_comercial: "[PREENCHER]"
  email_suporte: "[PREENCHER]"

agente:
  nome: "Assistente Comercial BGR"
  modelo_ia: "gpt-4o-mini"
  temperatura: 0.4
  max_tokens: 1024
  idioma: "pt-BR"
  memoria_janela: 20  # mensagens mantidas no contexto

crm:
  plataforma: "Power CRM"
  api_base_url: "https://api.powercrm.com.br/api/v1"
  integracao_nome: "Agente IA - BGR Protótipo"
  credencial_n8n: "Power CRM - Bearer"

whatsapp:
  plataforma: "WhatsApp Business Platform"
  api_version: "v18.0"
  phone_number_id: "[PREENCHER]"
  waba_id: "[PREENCHER]"
  credencial_n8n: "WhatsApp Business - BGR"
  templates:
    saudacao: "bgr_saudacao"
    cotacao: "bgr_cotacao_pronta"
    followup: "bgr_followup"
    reativacao: "bgr_reativacao"

follow_up:
  horario_inicio: "09:00"  # BRT
  horario_fim: "18:00"     # BRT
  dias_uteis_apenas: true
  max_tentativas: 3
  intervalo_dias: [1, 3, 7]  # dias entre tentativas
  
campanhas:
  limite_diario: 100  # mensagens por dia
  lote_tamanho: 10
  intervalo_lote_segundos: 30
  respeitar_horario_comercial: true

atendimento_humano:
  setor_comercial: "[PREENCHER - ID/NOME DO GRUPO]"
  setor_suporte: "[PREENCHER - ID/NOME DO GRUPO]"
  setor_sinistros: "[PREENCHER - ID/NOME DO GRUPO]"
  setor_financeiro: "[PREENCHER - ID/NOME DO GRUPO]"
  notificacao_email: "[PREENCHER]"
  notificacao_whatsapp: "[PREENCHER]"
```

## Mapeamento de Etapas Comerciais

```yaml
etapas_funil:
  - id: "novo_lead"
    nome: "Novo Lead"
    cor: "#3498db"
  - id: "contato_iniciado"
    nome: "Contato Iniciado"
    cor: "#2ecc71"
  - id: "qualificacao"
    nome: "Qualificação em Andamento"
    cor: "#f39c12"
  - id: "cotacao_preparada"
    nome: "Cotação Preparada"
    cor: "#e67e22"
  - id: "cotacao_enviada"
    nome: "Cotação Enviada"
    cor: "#e74c3c"
  - id: "cliente_interessado"
    nome: "Cliente Interessado"
    cor: "#9b59b6"
  - id: "cliente_indeciso"
    nome: "Cliente Indeciso"
    cor: "#95a5a6"
  - id: "aguardando_assinatura"
    nome: "Aguardando Assinatura"
    cor: "#1abc9c"
  - id: "aguardando_pagamento"
    nome: "Aguardando Pagamento"
    cor: "#d35400"
  - id: "contratacao_confirmada"
    nome: "Contratação Confirmada"
    cor: "#27ae60"
  - id: "oportunidade_perdida"
    nome: "Oportunidade Perdida"
    cor: "#7f8c8d"
  - id: "atendimento_humano"
    nome: "Atendimento Humano"
    cor: "#c0392b"
```

## Para Replicação (Outras Empresas)

Para adaptar o sistema para outra empresa:

1. Copiar toda a pasta `config/`
2. Alterar os valores neste arquivo
3. Criar nova base de conhecimento em `knowledge-base/`
4. Ajustar o system prompt no workflow principal
5. Criar credenciais separadas no n8n
6. Criar workflows com prefixo da nova empresa

**Nunca misturar dados, credenciais ou conversas entre empresas diferentes.**
