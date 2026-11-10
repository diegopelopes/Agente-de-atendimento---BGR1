# Exports Sanitizados do n8n (Backups Oficiais)

Esta pasta armazena os backups imutáveis e sanitizados (sem tokens, cabeçalhos privados, IDs sensíveis ou dados de clientes reais) dos workflows do n8n da **BGR Benefícios**.

## Inventário de Backups Arquivados
- `bgr-agente-comercial-principal.backup-v1.0.json` — Backup integral da linha de base v1.0 do workflow principal antes de qualquer evolução da Fase 2+.
- `bgr-follow-up-comercial.backup-v1.0.json` — Backup integral da linha de base v1.0 do workflow de follow-up comercial.
- `bgr-campanha-reativacao.backup-v1.0.json` — Backup integral da linha de base v1.0 do workflow de campanha de reativação.

## Regra de Segurança antes de Arquivar um Novo Export
1. Verifique que nenhum nó `httpRequest` ou `toolHttpRequest` contém `Authorization: Bearer ...` hardcoded nos parâmetros.
2. Verifique que `pinData` está vazio (`{}`) ou contém apenas dados fictícios de teste (`TST0A01`, `+5511999990001`).
3. Execute a suíte de testes (`tests/unit/run-unit-tests.ps1`), que audita automaticamente todos os arquivos `.json` de `workflows/` e `n8n/exports-sanitizados/` em busca de vazamento de tokens ou chaves.
