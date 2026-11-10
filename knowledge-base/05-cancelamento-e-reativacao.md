# 05 — Cancelamento e Reativação de Associados | BGR Benefícios

> ⚠️ **STATUS**: Rascunho Estruturado — Validar prazos, taxas de reativação e regras de fidelidade com a BGR Benefícios (`[VALIDAR COM BGR]`).

---

## 1. Regras de Cancelamento da Proteção
- **Quem pode solicitar**: Exclusivamente o associado titular (mediante confirmação de dados).
- **Canal oficial**: Setor de Retenção / Atendimento ao Associado BGR (o Agente IA **NÃO** realiza cancelamento automático; ele registra a solicitação e transfere/encaminha ao setor responsável).
- **Requisitos para cancelamento** `[VALIDAR COM BGR]`:
  - Estar em dia com as mensalidades vencidas e eventual rateio em aberto.
  - Cumprimento do período mínimo de permanência `[VALIDAR COM BGR - ex: 90/180 dias]` ou pagamento de multa contratual proporcional, caso aplicável.
  - Não ter acionado benefícios de sinistro/colisão dentro do período de fidelidade exigido pelo regulamento.
  - **Devolução do equipamento de rastreamento** (quando instalado em comodato): agendamento de desinstalação técnica.
  - Assinatura do Termo de Cancelamento.

---

## 2. Reativação de Associados e Ex-Associados Elegíveis
O módulo de recuperação e reativação atende dois cenários distintos:

### Cenário A — Associado Inadimplente (Boleto Vencido / Proteção Suspensa)
- **Situação**: O veículo fica **sem cobertura** a partir do vencimento não pago `[VALIDAR COM BGR - confirmar prazo de tolerância, se houver]`.
- **Para reativar**:
  - Pagamento da pendência financeira via canal oficial.
  - **Nova Vistoria**: Obrigatória após `[VALIDAR COM BGR - ex: 5 ou 10 dias]` de atraso para comprovar que o veículo não sofreu sinistro durante o período descoberto.
  - **Início da cobertura reativada**: Somente após compensação bancária + aprovação da nova vistoria.

### Cenário B — Ex-Associado (Campanha de Recuperação Comercial)
- **Público elegível**: Ex-associados que cancelaram sem pendências restritivas e possuem **consentimento/base legal válida** para contato.
- **Condições comerciais de reativação** `[VALIDAR COM BGR]`:
  - Condição especial na taxa de adesão: `[VALIDAR COM BGR - somente quando retornada/autorizada pelo sistema oficial]`.
  - Atualização cadastral e nova cotação conforme Tabela FIPE atual do veículo.
  - Realização de nova vistoria prévia digital.
  - Assinatura de novo Termo de Adesão.

---

## 3. Diretrizes de LGPD e Opt-out em Campanhas de Reativação
1. **Respeito imediato ao Descadastro**: Se o ex-associado responder *"Não tenho interesse"*, *"Pare"*, *"Sair"* ou pedir para não receber mais mensagens, o agente deve:
   - Confirmar educadamente que o contato foi removido da lista de campanhas.
   - Registrar a flag `opt_out = true` no CRM.
   - Encerrar imediatamente qualquer follow-up futuro.
2. **Proibição de promessas sem validação**: O agente nunca deve prometer isenção de adesão ou desconto de reativação que não esteja expressamente autorizado na campanha ativa do Power CRM.
