# Mapeamento de Endpoints — Power CRM API

> **Status**: Endpoints baseados na documentação pública e padrões observados.
> Todos devem ser **validados** com a documentação oficial em https://power-crm.readme.io/ antes do uso.

## Base URL

```
https://api.powercrm.com.br/api/v1
```

## Autenticação

```
Header: Authorization: Bearer {token}
Content-Type: application/json
```

## Endpoints Identificados

### 1. Cotações (Quotations)

| Método | Endpoint | Descrição | Status |
|--------|----------|-----------|--------|
| GET | `/quotations` | Listar cotações | ⏳ Validar |
| GET | `/quotations/{id}` | Consultar cotação por ID | ⏳ Validar |
| POST | `/quotations` | Criar nova cotação | ⏳ Validar |
| GET | `/quotations/{id}/plans` | Consultar planos da cotação | ⏳ Validar |

**Parâmetros de consulta (GET /quotations):**
- `?page=1` — Paginação
- `?limit=20` — Limite por página
- `?status=open` — Filtro por status

**Corpo para criação (POST /quotations):**
```json
{
  "vehicle": {
    "plate": "ABC1D23",
    "brand": "Fiat",
    "model": "Pulse",
    "year": 2023,
    "fipe_code": "001234-5"
  },
  "client": {
    "name": "Nome do Cliente",
    "phone": "+5511999999999",
    "email": "cliente@email.com",
    "document": "12345678900"
  },
  "plan_id": null,
  "origin": "agente_ia"
}
```
> ⚠️ Estrutura do corpo **NÃO CONFIRMADA**. Validar com documentação.

### 2. Leads

| Método | Endpoint | Descrição | Status |
|--------|----------|-----------|--------|
| GET | `/leads` | Listar leads | ⏳ Validar |
| GET | `/leads/{id}` | Consultar lead por ID | ⏳ Validar |
| POST | `/leads` | Criar novo lead | ⏳ Validar |
| PATCH | `/leads/{id}` | Atualizar lead | ⏳ Validar |
| GET | `/leads?phone={phone}` | Buscar por telefone | ⏳ Validar |

**Corpo para criação (POST /leads):**
```json
{
  "name": "Nome do Cliente",
  "phone": "+5511999999999",
  "email": "cliente@email.com",
  "document": "12345678900",
  "origin": "agente_ia",
  "vehicle": {
    "plate": "ABC1D23",
    "brand": "Fiat",
    "model": "Pulse",
    "year": 2023
  },
  "plan_id": null,
  "notes": "Lead captado pelo Agente Comercial IA"
}
```
> ⚠️ Estrutura do corpo **NÃO CONFIRMADA**. Validar com documentação.

### 3. Propostas (Proposals)

| Método | Endpoint | Descrição | Status |
|--------|----------|-----------|--------|
| GET | `/proposals` | Listar propostas | ⏳ Validar |
| GET | `/proposals/{id}` | Consultar proposta | ⏳ Validar |
| POST | `/proposals` | Criar proposta | ⏳ Validar |
| PATCH | `/proposals/{id}/status` | Atualizar status | ⏳ Validar |

### 4. Veículos / FIPE

| Método | Endpoint | Descrição | Status |
|--------|----------|-----------|--------|
| GET | `/vehicles/brands` | Listar marcas | ⏳ Validar |
| GET | `/vehicles/models?brand_id={id}` | Listar modelos | ⏳ Validar |
| GET | `/vehicles/years?model_id={id}` | Listar anos | ⏳ Validar |
| GET | `/vehicles/fipe?plate={plate}` | Consultar FIPE por placa | ⏳ Validar |

### 5. Associados (Members)

| Método | Endpoint | Descrição | Status |
|--------|----------|-----------|--------|
| GET | `/members/{id}` | Consultar associado | ⏳ Validar |
| GET | `/members/{id}/status` | Status da associação | ⏳ Validar |
| GET | `/members/{id}/payments` | Histórico de pagamentos | ⏳ Validar |

### 6. Webhooks V2

| Evento | Descrição | Status |
|--------|-----------|--------|
| `quotation.created` | Cotação criada | ⏳ Validar |
| `quotation.accepted` | Cotação aceita | ⏳ Validar |
| `proposal.created` | Proposta criada | ⏳ Validar |
| `proposal.signed` | Proposta assinada | ⏳ Validar |
| `payment.confirmed` | Pagamento confirmado | ⏳ Validar |
| `member.activated` | Associado ativado | ⏳ Validar |
| `member.cancelled` | Associado cancelado | ⏳ Validar |

**Configuração de Webhook no Power CRM:**
```
URL destino: https://{seu-n8n}.app.n8n.cloud/webhook/bgr-powercrm-events
Método: POST
Content-Type: application/json
Authorization: Bearer {token-de-validação}
Header de segurança: X-PowerCRM-Event-Id (para evitar duplicatas)
```

## Prioridade de Implementação

| Prioridade | Endpoint | Etapa |
|------------|----------|-------|
| 1️⃣ | GET /quotations/{id} | Etapa 2 |
| 2️⃣ | POST /quotations | Etapa 3 |
| 3️⃣ | GET /vehicles/fipe | Etapa 3 |
| 4️⃣ | POST /leads | Etapa 3 |
| 5️⃣ | PATCH /leads/{id} | Etapa 3 |
| 6️⃣ | POST /proposals | Etapa 4 |
| 7️⃣ | GET /proposals/{id} | Etapa 4 |
| 8️⃣ | GET /members/{id}/status | Etapa 4 |
| 9️⃣ | Webhooks V2 | Etapa 5 |

## ⚠️ Ação Necessária

1. **Acessar** https://power-crm.readme.io/ com as credenciais da BGR
2. **Validar** cada endpoint listado acima
3. **Corrigir** URLs, parâmetros e estruturas de resposta
4. **Documentar** códigos de erro e limites de taxa
5. **Testar** com o token da integração "Agente IA - BGR Protótipo"
