# Guia de Treinamento Contínuo — Agente Comercial IA BGR

> **Versão**: 1.0  
> **Objetivo**: Procedimento administrativo para melhoria contínua do agente.

## Visão Geral

O treinamento contínuo do agente é um processo **administrativo**, não automático.  
Nenhuma correção altera o comportamento do agente sem **revisão e aprovação** humana.

## Fluxo de Melhoria

```
Identificar problema → Registrar → Analisar → Propor correção → Validar → Testar → Aprovar → Publicar
```

## 1. Identificar Respostas Inadequadas

### Fontes de identificação:

- Revisão periódica de conversas
- Feedback de clientes
- Relatórios de transferência para humano
- Reclamações registradas
- Testes de qualidade programados
- Análise de conversões perdidas

### Classificação:

| Tipo | Descrição | Prioridade |
|------|-----------|------------|
| **Erro factual** | Informação incorreta sobre produto/serviço | URGENTE |
| **Erro de conduta** | Promessa indevida, pressão comercial | URGENTE |
| **Lacuna** | Não soube responder algo que deveria | ALTA |
| **Tom inadequado** | Resposta muito longa, formal demais, etc. | MÉDIA |
| **Oportunidade** | Poderia ter conduzido melhor a negociação | BAIXA |

## 2. Registrar a Correção

### Ficha de registro:

```markdown
## Registro de Correção #[NÚMERO]

**Data**: [YYYY-MM-DD]
**Identificado por**: [NOME]
**Tipo**: [Erro factual / Erro de conduta / Lacuna / Tom / Oportunidade]
**Prioridade**: [URGENTE / ALTA / MÉDIA / BAIXA]

### Situação Observada
[Descrever o que o agente respondeu/fez]

### Resposta Esperada
[Descrever o que deveria ter sido dito/feito]

### Causa Provável
- [ ] Prompt insuficiente
- [ ] Base de conhecimento incompleta
- [ ] Base de conhecimento desatualizada
- [ ] Limitação do modelo de IA
- [ ] Erro de integração

### Correção Proposta
[Descrever a alteração necessária]

### Componente Afetado
- [ ] System prompt
- [ ] Base de conhecimento - Arquivo: ___________
- [ ] Workflow
- [ ] Configuração
- [ ] Outro: ___________

### Aprovado por
**Nome**: ___________
**Data**: ___________
```

## 3. Validar a Nova Orientação

Antes de aplicar qualquer correção:

1. **Verificar com a BGR** se a informação/comportamento proposto está correto
2. **Verificar impacto** em outras respostas e fluxos
3. **Documentar** a fonte da informação correta
4. **Obter aprovação** por escrito (e-mail ou sistema)

## 4. Atualizar Base de Conhecimento ou Instruções

### Para alterações na base de conhecimento:

1. Editar o arquivo correspondente em `knowledge-base/`
2. Marcar a alteração no arquivo `VERSAO.md`
3. Incrementar a versão (PATCH para correções, MINOR para adições)

### Para alterações no system prompt:

1. Salvar backup do prompt atual
2. Fazer a alteração pontual
3. Documentar o que mudou e por quê
4. NÃO reescrever todo o prompt — alterações incrementais

### Para alterações no workflow:

1. Exportar o workflow atual como backup
2. Fazer a alteração no ambiente de teste
3. Testar antes de aplicar em produção

## 5. Executar Testes de Regressão

Após qualquer alteração, executar os testes relevantes do [Roteiro de Testes](../tests/roteiro-testes.md):

| Tipo de Alteração | Testes Obrigatórios |
|-------------------|-------------------|
| Prompt (saudação) | T01, T02 |
| Prompt (cotação) | T07, T08, T09, T10 |
| Prompt (objeções) | T15, T16, T17 |
| Prompt (segurança) | T20, T21, T22 |
| Base de conhecimento | T10, T15-T17 |
| Integração CRM | T11-T14 |
| Qualquer alteração | T04, T05, T06 (memória) |

## 6. Publicar Nova Versão

### Checklist de publicação:

- [ ] Alteração aprovada por responsável
- [ ] Testes de regressão executados e aprovados
- [ ] Backup do estado anterior salvo
- [ ] Documentação atualizada (VERSAO.md)
- [ ] Alteração aplicada em teste primeiro
- [ ] Validação final em teste
- [ ] Aplicação em produção
- [ ] Monitoramento por 24h após publicação

## Cronograma de Revisão

| Frequência | Atividade |
|-----------|-----------|
| **Diário** | Verificar transferências para humano e motivos |
| **Semanal** | Revisar amostra de 10 conversas |
| **Quinzenal** | Analisar métricas de conversão |
| **Mensal** | Revisão completa da base de conhecimento |
| **Trimestral** | Auditoria de segurança e compliance |

## Registro de Versões do Prompt

| Versão | Data | Alteração | Aprovado por |
|--------|------|-----------|-------------|
| 1.0 | 2026-11-09 | Versão inicial | [PENDENTE] |
| | | | |
