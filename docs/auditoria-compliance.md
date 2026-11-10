# Guia de Auditoria e Compliance — BGR Agente Comercial IA

> **Versão**: 1.0  
> **Última atualização**: 2026-11-09

## 1. Registro de Ações Sensíveis

### O que registrar:

| Categoria | Eventos | Nível |
|-----------|---------|-------|
| **Autenticação** | Login, falha de autenticação, troca de credenciais | CRÍTICO |
| **Dados pessoais** | Consulta de CPF, telefone, endereço | ALTO |
| **Operações financeiras** | Cotação, proposta, pagamento | ALTO |
| **Contratação** | Aceite, assinatura, ativação | CRÍTICO |
| **Cancelamento** | Solicitação, processamento | ALTO |
| **Transferência** | Encaminhamento para humano | MÉDIO |
| **Campanhas** | Envio de mensagens, descadastro | ALTO |
| **Administração** | Alteração de prompt, base de conhecimento | CRÍTICO |
| **Erros** | Falhas de API, timeout, dados inválidos | ALTO |

### Formato do registro:

```json
{
  "timestamp": "2026-11-09T17:00:00-03:00",
  "event_type": "quotation_created",
  "severity": "HIGH",
  "session_id": "sess_abc123",
  "client_phone_hash": "sha256_...",
  "action": "Cotação criada no Power CRM",
  "details": {
    "quotation_id": "QOT-12345",
    "vehicle_model": "Honda Civic 2022",
    "status": "success"
  },
  "source": "agente_ia",
  "ip": null,
  "user_agent": null
}
```

> ⚠️ **NUNCA** registrar dados pessoais completos nos logs. Usar hash ou mascaramento.

## 2. Proteção de Dados (LGPD)

### Dados coletados pelo agente:

| Dado | Finalidade | Base Legal | Retenção |
|------|-----------|------------|----------|
| Nome | Identificação e cotação | Execução contratual | Enquanto necessário |
| Telefone | Comunicação | Consentimento | Até descadastro |
| Veículo | Cotação | Execução contratual | Enquanto necessário |
| CPF | Cadastro no CRM | Execução contratual | Conforme legislação |
| E-mail | Comunicação | Consentimento | Até descadastro |

### Direitos do titular:

- [x] Informação sobre o tratamento
- [x] Acesso aos dados
- [x] Correção de dados
- [x] Eliminação (quando aplicável)
- [x] Portabilidade (quando aplicável)
- [x] Revogação do consentimento
- [x] Oposição ao tratamento

### Procedimentos:

1. **Solicitação de dados**: Encaminhar ao setor responsável pela LGPD
2. **Solicitação de exclusão**: Registrar e encaminhar; não processar automaticamente
3. **Descadastro de campanhas**: Processar imediatamente e confirmar

## 3. Segregação de Ambientes

| Ambiente | Uso | Dados | Credenciais |
|----------|-----|-------|-------------|
| **Teste** | Desenvolvimento e validação | Fictícios | Token de teste |
| **Homologação** | Validação pré-produção | Fictícios + amostra controlada | Token separado |
| **Produção** | Operação real | Reais | Token de produção |

### Regras:

- ❌ Nunca usar dados reais em ambiente de teste
- ❌ Nunca usar credenciais de produção em teste
- ❌ Nunca testar automações de envio com números reais sem autorização
- ✅ Sempre validar em teste antes de promover para produção
- ✅ Manter workflows separados por ambiente quando necessário

## 4. Controle de Acesso

### Perfis de acesso ao n8n:

| Perfil | Permissões | Responsável |
|--------|-----------|-------------|
| **Administrador** | Editar workflows, credenciais, configurações | [DEFINIR] |
| **Operador** | Visualizar execuções, ativar/desativar workflows | [DEFINIR] |
| **Auditor** | Visualizar logs e relatórios | [DEFINIR] |

## 5. Tratamento de Falhas

### Matriz de falhas:

| Falha | Impacto | Ação do Agente | Ação Operacional |
|-------|---------|----------------|------------------|
| CRM indisponível | Não consulta cotações | Informa indisponibilidade temporária | Alerta por e-mail |
| OpenAI indisponível | Sem respostas | Mensagem padrão de fallback | Alerta imediato |
| WhatsApp indisponível | Não envia/recebe | Acumula em fila | Alerta + reprocessamento |
| Timeout de API | Resposta atrasada | Informa que está verificando | Retry automático (max 3x) |
| Dados inválidos | Erro no processamento | Solicita correção ao cliente | Registro no log |
| Token expirado | Autenticação falha | Mensagem de indisponibilidade | Alerta crítico |

### Procedimento de escalonamento:

```
Falha detectada
  → Retry automático (até 3x)
    → Mensagem de fallback ao cliente
      → Registro no log
        → Notificação ao administrador
          → Transferência para humano (se necessário)
```

## 6. Versionamento

### O que versionar:

- [x] System prompt do agente
- [x] Base de conhecimento (todos os arquivos)
- [x] Configuração de workflows
- [x] Variáveis de ambiente
- [x] Templates de mensagem
- [x] Regras de negociação

### Formato de versão:

```
MAJOR.MINOR.PATCH

MAJOR: Mudança significativa no comportamento
MINOR: Novas funcionalidades ou ajustes importantes
PATCH: Correções pontuais
```

### Procedimento de alteração:

1. Identificar necessidade de mudança
2. Documentar a alteração proposta
3. Obter aprovação do responsável
4. Implementar em ambiente de teste
5. Executar testes de regressão (Grupo relevante do roteiro)
6. Obter aprovação final
7. Publicar em produção
8. Atualizar documentação de versão

## 7. Checklist de Conformidade

### Antes de ativar o sistema:

- [ ] Credenciais armazenadas com segurança no n8n
- [ ] Permissões mínimas configuradas nos tokens
- [ ] Ambientes de teste e produção segregados
- [ ] Logs configurados sem dados pessoais completos
- [ ] Política de retenção de dados definida
- [ ] Procedimento de descadastro implementado
- [ ] Termos de uso e política de privacidade atualizados
- [ ] Base de conhecimento validada pela BGR
- [ ] Templates do WhatsApp aprovados pela Meta
- [ ] Testes de segurança executados (T20, T21, T22)
- [ ] Backup dos workflows configurado
- [ ] Plano de contingência documentado
- [ ] Responsáveis definidos para cada perfil de acesso
