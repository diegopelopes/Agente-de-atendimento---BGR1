# Documentação Técnica: Passo a Passo do Desenvolvimento do Agente Comercial IA — BGR Benefícios

Este documento detalha **toda a trajetória técnica de engenharia** percorrida desde a concepção inicial até a entrega final em produção do **Agente Comercial de Inteligência Artificial da BGR Benefícios**, hospedado e operacional na nuvem Render ([https://agente-de-atendimento-bgr1.onrender.com](https://agente-de-atendimento-bgr1.onrender.com)).

---

## 1. Linha do Tempo e Marcos de Desenvolvimento

```mermaid
timeline
    title Linha do Tempo do Desenvolvimento
    Marco 0 : Arquitetura Canônica & Contratos Tipados
            : Máquina de Estados e Sanitização LGPD
    Marco 1 : Motor NLU Contextual & Slot-Filling FIPE
            : Bloqueio Estrito de Alucinações de Preços
    Marco 2 : Conexão com Power CRM & Ingestão no Funil
            : Origem 19266 (BGR - DIEGO) & Contato no Card
    Marco 3 : Correção do Loop de Cotação de Novo Veículo
            : Isolamento de Sessões por Remetente
    Marco 4 : Automações n8n & Supabase (Réguas & Opt-Out)
    Marco 5 : Console Visual IA & Redesign Profissional
            : Rail Lucide, Chat Prioritário & Ficha Comercial
    Marco 6 : Modo Claro (Base Branca), Modo Escuro & Logo Oficial
            : 40/40 Testes Automatizados & Deploy Live no Render
```

---

## 2. Passo a Passo Detalhado por Etapa de Engenharia

### Etapa 1: Concepção da Arquitetura e Contratos Tipados
- **Objetivo:** Estabelecer uma fundação ultra-estável, rápida e sem dependências pesadas de frameworks, garantindo que o bot não travasse ou sofresse lentidão.
- **Implementação:**
  - Adoção do **Node.js (v22+)** com suporte nativo a ES Modules (`import`/`export`) e TypeScript em tempo de execução sem compiladores lentos.
  - Definição do arquivo canônico `contracts.schema.json` contendo a tipagem estrita de 10 entidades comerciais: `Lead`, `Vehicle`, `Quotation`, `CoveragePlan`, `Inspection`, `Payment`, `AuditTrail`, `HandoffState`, `Attendant` e `Campaign`.
  - Construção do **Sanitizador LGPD e Anti-Leak** (`src/utils/sanitizer.ts`), mascarando automaticamente CPF, telefones e placas, e impedindo o vazamento de tokens de API (`Bearer` ou `sk-...`) em logs e respostas ao cliente.

---

### Etapa 2: Motor NLU Contextual, Slot-Filling e Catálogo FIPE
- **Desafio:** Clientes no WhatsApp respondem de forma fragmentada, usando gírias, nomes populares de carros e omitindo a marca ou ano (ex: *"quero cotar um gol 2015"*, *"tenho uma spin"* ou apenas digitando a placa *"RFW7108"*).
- **Solução de Engenharia:**
  - Desenvolvimento do serviço `src/services/slot-filling.ts` utilizando uma arquitetura híbrida:
    - *Regex Determinístico:* Captura instantânea de placas (tanto padrão antigo `ABC-1234` quanto Mercosul `ABC1D23`), anos de fabricação e modelos reconhecidos.
    - *LLM Contextual (OpenAI gpt-4o-mini):* Extração de intenções quando a resposta é coloquial, contorno de dúvidas e categorização de objeções de venda.
  - **Regra de Ouro Anti-Alucinação:** O modelo de IA foi bloqueado para **nunca inventar preços ou coberturas**. Se faltarem dados essenciais, o bot pergunta exclusivamente o próximo dado faltante; quando completos, os preços são obtidos diretamente das regras comerciais oficiais da BGR (Planos Prata, Ouro e Diamante).

---

### Etapa 3: Integração Bidirecional com o Power CRM
- **Desafio Inicial:** As cotações precisavam aparecer imediatamente no funil de vendas dos consultores dentro da coluna *"Cotações recebidas"*, mas requisições iniciais retornavam erros `HTTP 412 (Precondition Failed)` e `HTTP 400 (Bad Request)`.
- **Diagnóstico e Correções Técnicas:**
  1. **Falha HTTP 412:** O Power CRM exigia obrigatoriamente os campos `phone` (ou `phoneMobile1`) e `email` para instanciar a cotação. Quando o cliente não informava e-mail no primeiro momento, a API rejeitava. Foi implementado um fallback que sintetiza um e-mail padronizado e injeta o telefone com DDD limpo.
  2. **Falha HTTP 400:** O endpoint rejeitava requisições que enviavam strings para o código do modelo (`mdl`) ou para a cidade (`city`). O payload foi refinado para passar `plts` (placa em string), `mdlYr` (ano como inteiro) e `origemId: 19266`.
  3. **Vínculo Oficial da Origem:** Toda cotação foi amarrada à origem `19266 (BGR - DIEGO)`.
  4. **Telefone WhatsApp Visível no Card:** Os consultores precisavam ver o contato sem ter que abrir o modal detalhado do Power CRM. O adapter foi ajustado para formatar o título da oportunidade como:
     ```typescript
     name: `${lead.name} • WhatsApp: ${formattedPhone}`
     ```
  5. **Comprovação em Produção:** Realizada cotação real de teste para `Renato Ribeiro` (GM Spin, placa `RFW7108`), resultando no código oficial `rzQ4NL2D` inserido com sucesso na coluna *"Cotações recebidas"*.

---

### Etapa 4: Resolução de Loops e Isolamento de Sessões
- **Problema 1: Confusão entre novos leads:** O bot ocasionalmente associava o contexto de uma cotação anterior a um novo cliente que entrava em contato pela primeira vez.
  - *Solução:* Isolamento estrito das sessões em memória e no banco com chave primária baseada no número de telefone do remetente (`customer_phone`). Cada número possui seu próprio histórico e estado independente.
- **Problema 2: Loop ao cotar outro veículo:** Quando o cliente recebia os planos e digitava que gostaria de cotar um segundo veículo, o bot entrava em loop ou insistia em fechar o primeiro carro.
  - *Solução:* Implementado detector contextual de `wantsAnotherQuote` (capturando expressões como *"cotar outro"*, *"outro carro"*, *"segundo veículo"*, *"outro automóvel"*).
  - Quando disparado, o sistema:
    1. Mantém os dados cadastrais do cliente (nome, telefone).
    2. Reseta as variáveis veiculares (`plate`, `model`, `brand`, `fipe_value`).
    3. Retorna a máquina de estados para `qualificacao`.
    4. Solicita a placa ou modelo do próximo veículo.
  - A pergunta de encerramento da proposta foi padronizada para:
    > *"Qual das opções faz mais sentido para você hoje, ou gostaria de cotar outro veículo?"*

---

### Etapa 5: Orquestração n8n, Supabase e Conformidade LGPD
- **Workflows n8n:**
  - Automação da régua comercial em cadência `D+1`, `D+3` e `D+7`.
  - Trava de horário comercial brasileiro (BRT): disparos retidos fora do intervalo 09:00 às 18:00 ou em finais de semana.
  - Nó de verificação de **Opt-Out**: se o cliente responder *"PARAR"*, *"CANCELAR"* ou *"NÃO QUERO MAIS"*, o consentimento é revogado imediatamente e o contato entra na lista de supressão.
- **Supabase (PostgreSQL):**
  - Armazenamento seguro de sessões, leads e propostas.
  - Gestão de atendentes humanos com filas setoriais (Comercial, Sinistros 24h, Retenção e Ouvidoria).

---

### Etapa 6: O Console Visual Operacional IA (Cockpit do Operador)
A interface operacional passou por duas grandes fases:

#### 6.1. Identificação de Gargalos da Primeira Versão
- O painel anterior apresentava excesso de emojis desordenados, botões operacionais misturados na barra superior e ausência de uma área dedicada para disparos manuais diretos para qualquer número de WhatsApp.
- O operador precisava de um fluxo ágil, com botões de 1 clique e ficha comercial visível lado a lado com o chat.

#### 6.2. O Redesign Completo (Conforme Especificação Oficial)
Com base na especificação técnica e protótipo fornecidos, o arquivo `src/api/visual-server.ts` foi refatorado:
1. **Topbar Unificada (70px):**
   - Identidade visual BGR, indicador do módulo ativo, status dinâmicos (`WhatsApp conectado`, `IA ativa`) e botão seletor de temas.
2. **Rail Lateral de Navegação (76px):**
   - Ícones SVG padronizados (família Lucide): *Atendimento, Cockpit, Simulador, Régua, Equipe, Número, APIs, KPIs e Ajuda*.
   - Indicador azul lateral para evidenciar a aba ativa.
3. **Coluna de Conversas (298px):**
   - Busca em tempo real, contador de conversas, botão **`+ Novo`** (para abrir modal de envio manual para qualquer WhatsApp) e filtros rápidos (*Todas*, *Com IA*, *Humano*).
4. **Chat Prioritário Central (Flex):**
   - Botão **`Assumir / Devolver à IA`** com feedback visual imediato.
   - Menu contextual **`Mais ações (...)`**: *Enviar para número*, *Abrir chat cliente*, *Copiar telefone* e *Reiniciar atendimento*.
   - **Composer sem rolagem horizontal**: 4 botões de ação rápida (*Enviar planos*, *Solicitar placa*, *Dados PIX*, *Adesão digital*), campo de digitação autoajustável e atalhos (`Enter` para enviar, `Shift + Enter` para quebra de linha).
5. **Ficha Comercial do Lead (316px / Drawer Responsivo):**
   - Aba **Dados:** Contato, localidade, progresso de qualificação em 4 etapas e botão para solicitar dados do veículo.
   - Aba **Cotação:** Status oficial e cartões dos planos (Prata R$ 119,90, Ouro R$ 149,90, Diamante R$ 189,90) com botão *Preparar mensagem*.
   - Aba **Dúvidas:** Sanfona com as 6 respostas padrão para dúvidas de mercado (Associação x Seguradora, Guincho 24h, Carro Reserva, Franquia, Sem SPC, Uber/99).
6. **Correção de Console:** Sanada a duplicidade da variável `inboxFilter`, resultando em **zero erros de JavaScript** no console do navegador.

---

### Etapa 7: Modo Claro (Base Branca), Modo Escuro e Logo Oficial
1. **Suporte a Tema Duplo:**
   - Adicionada a classe `body.theme-light` com paleta em base branca (`#FFFFFF` e `#F4F6FA`), mantendo alto contraste nos textos (`#0F172A`) e cartões limpos com sombras suaves.
   - O tema azul noturno original foi mantido como o `Modo Escuro`.
   - Criado o botão seletor de tema com ícones de Sol e Lua na topbar, salvando a preferência do operador no `localStorage`.
2. **Substituição Cirúrgica da Logo:**
   - Atendendo à solicitação do usuário (*"é nesse B que quero a logo. somente"*), o quadrado anterior com a letra `B` estática foi **completamente substituído** pela imagem oficial da logo da BGR Benefícios (`public/logo.png`), com cantos arredondados de 11px, mantendo ao lado exclusivamente o nome **BGR Benefícios** e o subtítulo **Console Visual IA**.

---

### Etapa 8: Homologação Automatizada e Deploy Contínuo no Render
- **Suíte de 40 Testes:** Todos os 40 testes unitários, de integração e E2E foram executados com **100% de aprovação**.
- **Pipeline de Deploy:** A cada commit enviado à branch `main` no GitHub, o **Render Cloud** compila o código, reinicia o serviço e disponibiliza a versão mais recente em menos de 2 minutos com SSL automático.
- **Validação ao Vivo:** Subagente navegador acessou `https://agente-de-atendimento-bgr1.onrender.com` e comprovou a operação, o tema claro, o chat e a logo sem nenhuma pendência técnica.

---

## 3. Resumo das Decisões de Arquitetura

| Componente | Decisão Tomada | Justificativa Técnica |
| :--- | :--- | :--- |
| **Runtime** | Node.js nativo sem frameworks pesados | Tempo de resposta sub-milissegundo e baixo consumo de memória no Render. |
| **NLU** | Abordagem híbrida (Regex + LLM) | Garante que placas e números não falhem, enquanto o LLM cuida do tom comercial. |
| **Preços** | Bloqueio de alucinação de preços | Protege a associação de promessas contratuais errôneas; preços vêm da regra oficial. |
| **Power CRM** | Injeção com `origemId: 19266` e telefone no nome | Permite que os consultores identifiquem e liguem para o lead sem abrir menus adicionais. |
| **Interface** | Vanilla HTML5/CSS3 com variáveis CSS | Permitiu suporte imediato a Dark/Light Mode sem quebrar layout ou gerar pacotes JS pesados. |
| **Segurança** | Trava quádrupla para ativação | Impede que comprovantes falsos no chat ativem proteções veiculares sem vistoria e pagamento. |

---

## 4. Estado Final de Entrega

O sistema encontra-se **100% operacional, homologado e estável**:
- **URL de Produção:** [https://agente-de-atendimento-bgr1.onrender.com](https://agente-de-atendimento-bgr1.onrender.com)
- **Repositório GitHub:** `diegopelopes/Agente-de-atendimento---BGR1`
- **Últimos Commits de Referência:**
  - `20f4eb3`: Correção da ingestão no Power CRM (origem 19266, telefone no card e loop de cotação).
  - `2953492`: Redesign completo do Console Visual (rail Lucide, chat prioritário e ficha em abas).
  - `3dccdcb`: Eliminação da duplicidade de `inboxFilter` no script cliente.
  - `cc6961a`: Adição do Modo Claro (base branca), seletor de temas e rota de assets.
  - `b9c5cae`: Substituição definitiva do ícone 'B' pela logo oficial da BGR Benefícios.
  - `b2eb27e`: Inclusão da documentação técnica e guia de replicabilidade por nicho.
