# Guia de Configuração de Credenciais — n8n

> ⚠️ **SEGURANÇA**: Nunca compartilhe tokens, senhas ou credenciais em chats, e-mails ou documentos públicos.

## Credenciais Necessárias

### 1. Power CRM - Bearer Token

| Campo | Valor |
|-------|-------|
| **Nome no n8n** | `Power CRM - Bearer` |
| **Tipo** | Header Auth |
| **Header Name** | `Authorization` |
| **Header Value** | `Bearer {SEU_TOKEN_POWER_CRM}` |

**Como obter o token:**
1. Acesse o painel do Power CRM
2. Vá em **Minha Empresa > Plugins > Power API**
3. Localize a integração **"Agente IA - BGR Protótipo"**
4. Copie o token ativo
5. No n8n, vá em **Credenciais > Adicionar > Header Auth**
6. Configure conforme a tabela acima

### 2. OpenAI API Key

| Campo | Valor |
|-------|-------|
| **Nome no n8n** | `OpenAI Account` |
| **Tipo** | OpenAI API |
| **API Key** | `{SUA_CHAVE_OPENAI}` |

**Como obter:**
1. Acesse [platform.openai.com](https://platform.openai.com)
2. Vá em **API Keys**
3. Crie uma nova chave
4. No n8n, vá em **Credenciais > Adicionar > OpenAI API**

### 3. WhatsApp Business Platform (Futuro - Etapa 5)

| Campo | Valor |
|-------|-------|
| **Nome no n8n** | `WhatsApp Business - BGR` |
| **Tipo** | Header Auth |
| **Header Name** | `Authorization` |
| **Header Value** | `Bearer {TOKEN_WHATSAPP}` |

**Pré-requisitos:**
- Conta Meta Business verificada
- Número de telefone exclusivo para testes
- App registrado no Meta Developers
- Token permanente configurado

## Configuração no n8n

### Passo a Passo

```
n8n → Menu lateral → Credenciais → + Adicionar Credencial

1. Selecionar tipo: "Header Auth"
2. Nome: "Power CRM - Bearer"
3. Name: Authorization
4. Value: Bearer <colar-token-aqui>
5. Salvar
```

### Ambientes

| Ambiente | Uso | Observação |
|----------|-----|------------|
| **Teste** | Desenvolvimento e validação | Usar tokens de teste quando disponíveis |
| **Produção** | Atendimento real | Tokens definitivos com permissões mínimas |

> **IMPORTANTE**: Manter credenciais de teste e produção separadas.

## Verificação

Após configurar cada credencial, testar com uma requisição simples:

```
Power CRM: GET https://api.powercrm.com.br/api/v1/quotations?limit=1
Esperado: HTTP 200 com dados ou array vazio

OpenAI: Usar o nó "Chat de Teste" no workflow
Esperado: Resposta do agente com saudação
```

## Rotação de Tokens

- Trocar tokens a cada **90 dias** ou conforme política da empresa
- Documentar data da última troca
- Testar após cada troca

| Credencial | Última Troca | Próxima Troca |
|------------|-------------|---------------|
| Power CRM | [PENDENTE] | [PENDENTE] |
| OpenAI | [PENDENTE] | [PENDENTE] |
| WhatsApp | [PENDENTE] | [PENDENTE] |
