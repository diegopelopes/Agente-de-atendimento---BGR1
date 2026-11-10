# PROJETO MESTRE — Agente Comercial IA | BGR Benefícios (v1.0)

Bem-vindo ao repositório oficial de arquitetura, workflows n8n, base de conhecimento e governança do **Agente Comercial IA da BGR Benefícios**.

---

## 📁 Estrutura do Projeto

```
bgr-agente-comercial/
├── workflows/
│   ├── bgr-agente-comercial-principal.json   # Workflow principal n8n (Chat + WhatsApp + OpenAI + Power CRM Tools)
│   ├── bgr-follow-up-comercial.json          # Workflow de acompanhamento automático por etapa do funil
│   └── bgr-campanha-reativacao.json          # Workflow de recuperação de ex-associados (com travas LGPD/Meta)
│
├── knowledge-base/
│   ├── 01-servicos-e-coberturas.md           # Roubo, furto, colisão, terceiros, assistência 24h, exclusões
│   ├── 02-planos-e-valores.md                # Planos, adesão, mensalidades, regras FIPE, app e leilão
│   ├── 03-processo-contratacao.md            # Documentos, vistoria, assinatura digital, pagamento e ativação
│   ├── 04-sinistros-e-assistencia.md         # Procedimentos de emergência, 0800, prazos e documentos
│   ├── 05-cancelamento-e-reativacao.md       # Regras de cancelamento, inadimplência, reativação e opt-out
│   ├── 06-contatos-e-horarios.md             # Telefones, setores, horários e dados institucionais da BGR
│   ├── 07-objecoes-e-argumentos.md           # Scripts comerciais aprovados para contorno de objeções
│   ├── 08-perguntas-frequentes.md            # FAQ oficial com 18 perguntas e respostas estruturadas
│   └── VERSAO.md                             # Controle de versão e checklist de homologação da base
│
├── config/
│   ├── credenciais-n8n.md                    # Guia seguro de configuração do Power CRM Bearer, OpenAI e WhatsApp
│   ├── endpoints-powercrm.md                 # Mapeamento técnico e validação progressiva da Power API + Webhooks V2
│   └── variaveis-ambiente.md                 # Parâmetros isolados por empresa (multi-tenant) e etapas do funil
│
├── n8n/exports-sanitizados/                  # Backups imutáveis e sanitizados dos workflows n8n
│   ├── bgr-agente-comercial-principal.backup-v1.0.json
│   ├── bgr-follow-up-comercial.backup-v1.0.json
│   ├── bgr-campanha-reativacao.backup-v1.0.json
│   └── README.md
│
├── prompts/
│   ├── system.md                             # System prompt oficial versionado
│   └── developer.md                          # Instruções de orquestração, tools e contratos
│
├── src/
│   ├── domain/
│   │   ├── contracts.schema.json             # JSON Schema formal dos 10 contratos canônicos
│   │   └── contracts.ts                      # Contratos tipados, qualificação e máquina de estados
│   ├── observability/
│   │   └── sanitizer.ts                      # Mascaramento de CPF/placa/telefone e redaction de tokens
│   └── runtime/
│       └── BgrCore.ps1                       # Motor nativo de validação e segurança para testes
│
├── docs/
│   ├── arquitetura.md                        # Arquitetura técnica em camadas e diagrama de sequência
│   ├── operacao.md                           # Manual de operação, ambientes e procedimento de rollback
│   ├── n8n-inventario.md                     # Inventário comparativo dos workflows e dependências
│   ├── powercrm-contratos.md                 # Contratos de integração e política de resiliência CRM
│   ├── painel-administrativo.md              # Especificação dos 14 KPIs, filtros e tabela SQL de auditoria
│   ├── transferencia-humano.md               # Protocolo de handoff, payload de resumo e trava IA vs. Humano
│   ├── treinamento-continuo.md               # Procedimento administrativo de melhoria, revisão e regressão
│   ├── auditoria-compliance.md               # Segurança, LGPD, mascaramento de logs e matriz de falhas
│   └── arquitetura-replicacao.md             # Guia para replicação modular em outras empresas e segmentos
│
├── tests/
│   ├── roteiro-testes.md                     # 32 cenários de testes obrigatórios (dados fictícios inclusos)
│   └── unit/
│       └── run-unit-tests.ps1                # Suíte automatizada de testes unitários e de segurança (35 assertions)
│
├── templates/
│   └── template-importacao-reativacao.md     # Modelo CSV/XLSX para importação segura de ex-associados
│
├── .env.example                              # Template seguro de variáveis de ambiente (sem segredos)
├── .gitignore                                # Proteção contra commit de segredos e exports brutos
├── package.json                              # Manifesto do projeto e scripts de teste
└── tsconfig.json                             # Configuração TypeScript estrita
```

---

## 🚦 Status das Etapas de Desenvolvimento

| Etapa / Fase | Descrição | Status Atual |
|-------|-----------|--------------|
| **Fase 0** | Diagnóstico, inventário n8n, backup JSON sem secrets e mapa de riscos | ✅ **Concluída** |
| **Fase 1** | Fundação, `.env.example`, contratos tipados, sanitizador LGPD e testes unitários (35/35) | ✅ **Concluída e Validada** |
| **Fase 2** | Adapter Power CRM de leitura (`MockProvider` + `HttpProvider`), credencial segura e testes HTTP | 🔄 **Próxima Fase (Aguardando autorização)** |
| **Etapa 3** | Criação de cotação e consulta dos valores oficiais no Power CRM | ⏳ Preparada no workflow (aguardando validação da Etapa 2) |
| **Etapa 4** | Proposta, aceite, assinatura digital e confirmação de pagamento | ⏳ Arquitetura pronta (aguardando Etapa 3) |
| **Etapa 5** | Integração WhatsApp Business Platform oficial (número de teste) | ⏳ Nós configurados e desativados por segurança |
| **Etapa 6** | Follow-up comercial e campanha de reativação de ex-associados | ⏳ Workflows criados e desativados até homologação |
| **Etapa 7** | Painel gerencial, auditoria e relatórios verificáveis | ⏳ Esquema SQL e KPIs documentados |
| **Etapa 8** | Homologação completa (32 testes) e preparação para produção | ⏳ Roteiro de testes pronto |
