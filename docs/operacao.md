# Manual de Operação, Ambientes e Rollback | BGR Benefícios
**Versão**: `1.0.0`  
**Data-base**: `2026-11-10`

---

## 1. Regras Operacionais Obrigatórias
1. **Proibição de Segredos no Repositório**: Nenhuma credencial (`Power CRM - Bearer`, `OPENAI_API_KEY`, `WHATSAPP_ACCESS_TOKEN`) pode constar em código, JSON exportado do n8n, logs ou prints.
2. **Segregação de Ambientes**:
   - `teste`: Usa exclusivamente `POWERCRM_MODE=mock`, dados fictícios (`tests/roteiro-testes.md`) e `Chat de Teste`.
   - `homologacao`: Permite leitura controlada (`GET`) no Power CRM com registro fictício, mantendo envios externos de WhatsApp e campanhas desativados.
   - `producao`: Somente após aprovação formal dos 32 testes de homologação e assinatura do responsável BGR em `knowledge-base/VERSAO.md`.
3. **Política de Mudança no n8n**:
   - Antes de alterar qualquer nó no n8n, exportar o JSON atual, passar pelo sanitizador e salvar em `n8n/exports-sanitizados/`.

---

## 2. Como Executar os Testes Automatizados Localmente

O projeto inclui suíte de testes automatizados executável nativamente no Windows (via PowerShell Core / Windows PowerShell `.NET`) e compatível com Node.js/TypeScript:

```powershell
# Executar a suíte completa de testes unitários (Contratos, Máquina de Estados, Sanitização e Segurança)
powershell -ExecutionPolicy Bypass -File .\tests\unit\run-unit-tests.ps1
```

---

## 3. Procedimento de Rollback

Caso uma atualização de prompt, regra de domínio ou workflow apresente comportamento inesperado:
1. **No n8n**:
   - Desativar imediatamente o workflow atual.
   - Importar a última versão estável arquivada em `n8n/exports-sanitizados/bgr-agente-comercial-principal.backup-v1.0.json`.
   - Reassociar as credenciais locais (`OpenAI` e `Power CRM - Bearer`) no painel do n8n.
2. **Nas Filas de Atendimento**:
   - Mudar a flag `modo_atendimento` das sessões ativas para `humano_ativo` e direcionar os atendimentos em aberto para a fila de contingência comercial.
3. **No Repositório**:
   - Reverter para a tag/versão anterior aprovada e registrar um evento `rollback_executed` na auditoria.
