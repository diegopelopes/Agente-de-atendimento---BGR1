# Arquitetura de Replicação — Sistema Multi-Empresa

> **Objetivo**: Permitir que o sistema seja replicado para outras empresas e segmentos.

## Princípio

Cada empresa opera como uma **instância independente** com:
- Identidade própria
- Base de conhecimento própria
- Credenciais separadas
- Workflows dedicados
- Dados isolados

**Nunca misturar dados, conversas, credenciais ou regras entre empresas.**

## Estrutura de Diretórios por Empresa

```
sistema-agente-comercial/
├── empresas/
│   ├── bgr-beneficios/           # Instância BGR
│   │   ├── workflows/
│   │   ├── knowledge-base/
│   │   ├── config/
│   │   ├── docs/
│   │   ├── tests/
│   │   └── templates/
│   │
│   ├── empresa-xyz/              # Outra empresa
│   │   ├── workflows/
│   │   ├── knowledge-base/
│   │   ├── config/
│   │   ├── docs/
│   │   ├── tests/
│   │   └── templates/
│   │
│   └── template/                 # Template base para novas empresas
│       ├── workflows/
│       ├── knowledge-base/
│       ├── config/
│       ├── docs/
│       ├── tests/
│       └── templates/
│
└── compartilhado/                # Componentes reutilizáveis
    ├── templates-workflow/       # Templates de workflow genéricos
    ├── docs-padrao/             # Documentação padrão
    └── scripts/                 # Scripts de automação
```

## Configurações Independentes por Empresa

| Configuração | Isolamento | Exemplo BGR | Exemplo Imobiliária |
|-------------|-----------|-------------|-------------------|
| Nome da empresa | Por instância | BGR Benefícios | Imobiliária ABC |
| Segmento | Por instância | Proteção Veicular | Imóveis |
| Base de conhecimento | Por instância | Coberturas, planos | Imóveis, financiamento |
| CRM | Por instância | Power CRM | Outro CRM |
| API | Por instância | api.powercrm.com.br | api.outra.com.br |
| Credenciais | Por instância | Token BGR | Token ABC |
| WhatsApp | Por instância | +55 XX XXXXX-XXXX | +55 YY YYYYY-YYYY |
| System Prompt | Por instância | Proteção veicular | Imóveis |
| Produtos | Por instância | Planos de proteção | Imóveis disponíveis |
| Funil de vendas | Por instância | Lead → Cotação → Contratação | Lead → Visita → Proposta |
| Equipe | Por instância | Equipe BGR | Equipe ABC |
| Indicadores | Por instância | Cotações, contratações | Visitas, contratos |

## Procedimento para Nova Empresa

### 1. Preparação

```
1. Copiar pasta `template/` para `empresas/nova-empresa/`
2. Renomear prefixos nos workflows (ex: "BGR" → "ABC")
3. Preencher `config/variaveis-ambiente.md` com dados da empresa
```

### 2. Personalização

```
1. Editar base de conhecimento com informações da empresa
2. Adaptar system prompt para o segmento
3. Configurar CRM (se diferente do Power CRM)
4. Definir funil de vendas e etapas comerciais
5. Criar argumentos e objeções do segmento
6. Definir FAQ específica
```

### 3. Configuração Técnica

```
1. Criar credenciais separadas no n8n
2. Importar workflows com prefixo da empresa
3. Configurar webhooks dedicados
4. Configurar número WhatsApp exclusivo
5. Criar canal de atendimento humano separado
```

### 4. Validação

```
1. Executar roteiro de testes completo
2. Validar base de conhecimento com a empresa
3. Homologar com equipe comercial
4. Aprovação do cliente
```

## Segmentos Planejados para Expansão

| Segmento | Adaptações Principais |
|----------|---------------------|
| **Proteção Veicular** | ✅ Implementado (BGR) |
| **Imobiliárias** | Imóveis, financiamento, visitas, documentação |
| **Prestadores de Serviços** | Agendamento, orçamentos, portfólio |
| **Clínicas/Consultórios** | Agendamento, convênios, procedimentos |
| **Educação** | Matrículas, cursos, mensalidades |
| **E-commerce** | Produtos, pedidos, entregas |

## Isolamento de Dados

```yaml
regras_isolamento:
  - Cada empresa tem workflows com prefixo próprio
  - Credenciais NUNCA compartilhadas entre empresas
  - Sessões de conversa vinculadas à empresa
  - Base de conhecimento separada
  - Logs e métricas segregados
  - Números WhatsApp exclusivos
  - Webhooks com URLs diferentes
  - Backups independentes
```
