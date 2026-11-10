# Template de Importação — Campanha de Reativação

> Use este template para preparar a lista de contatos para campanhas de reativação de ex-associados.

## Formato Aceito
- CSV (separador: vírgula ou ponto-e-vírgula)
- XLSX (Excel)

## Colunas Obrigatórias

| Coluna | Tipo | Descrição | Exemplo |
|--------|------|-----------|---------|
| `id_cliente` | Texto | Identificador único do cliente | "CLI-001" |
| `nome` | Texto | Nome completo | "Roberto Almeida" |
| `telefone` | Texto | Telefone com DDD (formato E.164) | "+5511999990001" |
| `autorizacao_contato` | Texto | Se autoriza contato ("sim" ou "nao") | "sim" |
| `data_autorizacao` | Data | Data da autorização (YYYY-MM-DD) | "2026-01-15" |
| `origem_autorizacao` | Texto | Como a autorização foi obtida | "formulário site" |

## Colunas Opcionais

| Coluna | Tipo | Descrição | Exemplo |
|--------|------|-----------|---------|
| `email` | Texto | E-mail do cliente | "roberto@email.com" |
| `status_anterior` | Texto | Último status na associação | "cancelado" |
| `data_ultima_associacao` | Data | Data do último vínculo (YYYY-MM-DD) | "2025-06-15" |
| `motivo_saida` | Texto | Motivo do cancelamento | "financeiro" |
| `historico_comercial` | Texto | Observações relevantes | "Associado por 2 anos" |
| `plano_anterior` | Texto | Plano que possuía | "Completo" |
| `veiculo_marca` | Texto | Marca do veículo | "Honda" |
| `veiculo_modelo` | Texto | Modelo do veículo | "Civic" |
| `veiculo_ano` | Número | Ano do veículo | 2022 |

## Exemplo CSV

```csv
id_cliente,nome,telefone,autorizacao_contato,data_autorizacao,origem_autorizacao,status_anterior,data_ultima_associacao,motivo_saida
CLI-001,Roberto Almeida,+5511999990001,sim,2026-01-15,formulário site,cancelado,2025-06-15,financeiro
CLI-002,Ana Paula Costa,+5521988880002,sim,2026-02-20,atendimento telefônico,cancelado,2025-08-20,mudança de cidade
CLI-003,José Carlos Lima,+5531977770003,nao,,,,2025-03-10,insatisfação
```

## Regras de Validação

1. ✅ Apenas contatos com `autorizacao_contato = "sim"` serão processados
2. ✅ Telefone deve estar no formato E.164 (+55DDDNUMERO)
3. ✅ Data de autorização deve ser preenchida quando `autorizacao_contato = "sim"`
4. ❌ Contatos com `autorizacao_contato = "nao"` ou vazio serão IGNORADOS
5. ❌ Telefones inválidos serão REJEITADOS
6. ❌ Duplicatas (mesmo telefone) serão REMOVIDAS

## ⚠️ Avisos Importantes

- **LGPD**: A empresa é responsável por garantir que a base legal para contato existe
- **Consentimento**: A coluna `autorizacao_contato` NÃO substitui a verificação da base legal
- **Meta/WhatsApp**: Os templates de mensagem devem ser previamente aprovados pela Meta
- **Descadastro**: Respeitar imediatamente qualquer pedido de remoção
- **Frequência**: Não enviar mais de uma mensagem por campanha para o mesmo contato
