# 02 — Planos, Valores e Regras Comerciais | BGR Benefícios

> ⚠️ **STATUS**: Template Oficial — Todos os campos `[PREENCHER - DADO OFICIAL BGR]` devem ser alimentados pela tabela vigente e/ou retornados via API do Power CRM.
> **REGRA CRÍTICA**: O agente NUNCA deve inventar valores ou aplicar descontos não retornados pelo sistema oficial.

---

## 1. Planos Disponíveis

| Plano | Coberturas Principais | Guincho | Terceiros | Vidros | Carro Reserva |
|-------|-----------------------|---------|-----------|--------|---------------|
| **Essencial / Básico** `[PREENCHER]` | Roubo, Furto, Incêndio, Colisão, Assistência 24h | `[PREENCHER]` km | `[PREENCHER]` | Opcional | Opcional |
| **Intermediário / Plus** `[PREENCHER]` | Básico + Vidros + Terceiros ampliado | `[PREENCHER]` km | `R$ [PREENCHER]` | Incluso | `7 dias` `[PREENCHER]` |
| **Completo / Premium** `[PREENCHER]` | Cobertura total + Carro Reserva + Guincho ampliado | `[PREENCHER]` km | `R$ [PREENCHER]` | Completo | `15 ou 30 dias` `[PREENCHER]` |

## 2. Taxa de Adesão / Implementação
- **Valor padrão**: `[PREENCHER - DADO OFICIAL BGR]` (obtido na cotação do Power CRM).
- **O que inclui**: Vistoria prévia, cadastro associativo e instalação de rastreador (quando aplicável) `[PREENCHER]`.
- **Formas de pagamento da adesão**: PIX, Boleto ou Cartão de Crédito `[PREENCHER - DADO OFICIAL BGR]`.

## 3. Mensalidades
- **Cálculo**: Baseado na faixa de valor do veículo na Tabela FIPE, categoria do veículo e plano escolhido.
- **Fonte**: Exclusivamente retornada pelo endpoint de cotação do Power CRM.
- **Vencimentos disponíveis**: Dias `[PREENCHER - ex: 05, 10, 15, 20, 25]` de cada mês.

## 4. Regras da Tabela FIPE
- **Limite máximo de valor FIPE aceito**:
  - Passeio nacional: `R$ [PREENCHER - DADO OFICIAL BGR]`
  - Passeio importado: `R$ [PREENCHER - DADO OFICIAL BGR]`
  - Utilitários / Caminhonetes: `R$ [PREENCHER - DADO OFICIAL BGR]`
  - Motocicletas: `R$ [PREENCHER - DADO OFICIAL BGR]`
- **Limite de ano de fabricação**: Veículos a partir do ano `[PREENCHER - DADO OFICIAL BGR]` (veículos mais antigos exigem avaliação especial).

## 5. Regras por Tipo de Uso (Aplicativo, Táxi, Comercial)
> **Regra do Projeto**: Não criar diferenciação de cotação entre uso pessoal e trabalho se essa distinção não existir nas regras comerciais vigentes da BGR.

- **Motoristas de Aplicativo (Uber, 99, Indrive) / Táxi**:
  - Aceitação: `[PREENCHER - DADO OFICIAL BGR - Sim/Não/Condições]`
  - Diferença na mensalidade: `[PREENCHER - DADO OFICIAL BGR]`
  - Diferença na cota de participação (franquia): `[PREENCHER - DADO OFICIAL BGR - ex: cota diferenciada em caso de sinistro]`
  - Rastreador obrigatório: `[PREENCHER - DADO OFICIAL BGR]`

## 6. Veículos de Leilão, Recuperados ou Sinistrados
- **Aceitação**: `[PREENCHER - DADO OFICIAL BGR - Aceita pequena/média monta? Não aceita grande monta?]`
- **Percentual de indenização FIPE**: `[PREENCHER - DADO OFICIAL BGR - ex: 70% ou 75% da Tabela FIPE em caso de perda total/roubo]`
- **Cota de participação**: Calculada sobre 100% da FIPE `[PREENCHER - DADO OFICIAL BGR]`.
- **Vistoria**: Obrigatória e sujeita a aprovação técnica.

## 7. Veículos Especiais (Rebaixados, GNV, Blindados)
- **Com Kit GNV**: `[PREENCHER - DADO OFICIAL BGR - Exige CSV/Inmetro em dia? Cobre o kit?]`
- **Rebaixados / Modificados**: `[PREENCHER - DADO OFICIAL BGR - Aceita apenas legalizados no CRLV?]`
- **Blindados**: `[PREENCHER - DADO OFICIAL BGR]`
