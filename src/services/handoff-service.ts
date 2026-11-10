/**
 * BGR Benefícios — Serviço de Roteamento Setorial, Transferência Humana (Handoff)
 * e Trava de Concorrência IA vs. Humano (Fase 5)
 *
 * Regras garantidas (Seções 4, 5, 8 e docs/transferencia-humano.md):
 * - Separa atendimento comercial de sinistro, assistência 24h, financeiro e cancelamento.
 * - NUNCA declara que a transferência já foi concluída antes da confirmação do receptor (T18).
 * - Trava a sessão (aguardando_humano / humano_ativo) para que a IA NUNCA fale simultaneamente
 *   com o atendente humano.
 */

import crypto from 'node:crypto';
import type { AuditEvent, Conversation, Handoff } from '../domain/contracts.ts';
import { sanitizeForAudit } from '../observability/sanitizer.ts';

export type HandoffTriggerReason =
  | 'solicitacao_explicita_cliente'
  | 'duvida_fora_base_conhecimento'
  | 'conflito_informacoes_valores'
  | 'pedido_desconto_condicao_especial'
  | 'veiculo_especial_leilao_modificado'
  | 'reclamacao_sensivel_ouvidoria'
  | 'pedido_cancelamento'
  | 'comunicacao_sinistro_emergencia'
  | 'falha_impeditiva_api_crm';

interface QueueRoutingRule {
  queue: Handoff['target_queue'];
  priority: Handoff['priority'];
}

const ROUTING_MATRIX: Record<HandoffTriggerReason, QueueRoutingRule> = {
  solicitacao_explicita_cliente: { queue: 'comercial', priority: 'ALTA' },
  duvida_fora_base_conhecimento: { queue: 'comercial', priority: 'ALTA' },
  conflito_informacoes_valores: { queue: 'comercial', priority: 'ALTA' },
  pedido_desconto_condicao_especial: { queue: 'comercial', priority: 'MEDIA' },
  veiculo_especial_leilao_modificado: { queue: 'comercial', priority: 'MEDIA' },
  reclamacao_sensivel_ouvidoria: { queue: 'ouvidoria', priority: 'CRITICA' },
  pedido_cancelamento: { queue: 'retencao', priority: 'ALTA' },
  comunicacao_sinistro_emergencia: { queue: 'sinistros', priority: 'CRITICA' },
  falha_impeditiva_api_crm: { queue: 'comercial', priority: 'ALTA' },
};

export interface HandoffInitiationResult {
  handoff: Handoff;
  conversation: Conversation;
  customer_message: string;
  audit_event: AuditEvent;
}

export interface IncomingMessageGateResult {
  allow_ai_processing: boolean;
  attendance_mode: Conversation['attendance_mode'];
  routed_to_human_queue: Handoff['target_queue'] | null;
  auto_reply_message: string | null;
}

export interface HumanAttendantProfile {
  attendant_id: string;
  name: string;
  email: string;
  whatsapp_phone: string;
  queue: Handoff['target_queue'];
  role_title: string;
  shift_hours: string;
  status: 'online' | 'pausa' | 'ocupado' | 'offline';
  active_sessions_count: number;
  created_at: string;
}

export const DEFAULT_HUMAN_ATTENDANTS: HumanAttendantProfile[] = [
  {
    attendant_id: 'atd_lucas_01',
    name: 'Lucas Martins',
    email: 'lucas.martins@bgrbeneficios.com.br',
    whatsapp_phone: '+55 31 99111-2233',
    queue: 'comercial',
    role_title: 'Consultor Comercial Sênior',
    shift_hours: '08:00 às 18:00',
    status: 'online',
    active_sessions_count: 0,
    created_at: '2026-11-10T08:00:00.000Z',
  },
  {
    attendant_id: 'atd_mariana_02',
    name: 'Mariana Costa',
    email: 'mariana.costa@bgrbeneficios.com.br',
    whatsapp_phone: '+55 31 99222-3344',
    queue: 'retencao',
    role_title: 'Especialista de Retenção & Negociação',
    shift_hours: '09:00 às 19:00',
    status: 'online',
    active_sessions_count: 0,
    created_at: '2026-11-10T08:00:00.000Z',
  },
  {
    attendant_id: 'atd_ricardo_03',
    name: 'Ricardo Oliveira',
    email: 'ricardo.plantao@bgrbeneficios.com.br',
    whatsapp_phone: '+55 31 99333-4455',
    queue: 'sinistros',
    role_title: 'Plantão Assistência & Sinistros 24h',
    shift_hours: 'Plantão 24h',
    status: 'online',
    active_sessions_count: 0,
    created_at: '2026-11-10T08:00:00.000Z',
  },
  {
    attendant_id: 'atd_patricia_04',
    name: 'Patrícia Souza',
    email: 'patricia.ouvidoria@bgrbeneficios.com.br',
    whatsapp_phone: '+55 31 99444-5566',
    queue: 'ouvidoria',
    role_title: 'Analista de Ouvidoria & Qualidade',
    shift_hours: '09:00 às 18:00',
    status: 'pausa',
    active_sessions_count: 0,
    created_at: '2026-11-10T08:00:00.000Z',
  },
];

export class HandoffService {
  private readonly conversations = new Map<string, Conversation>();
  private readonly handoffsBySession = new Map<string, Handoff>();
  private humanAttendants: HumanAttendantProfile[] = DEFAULT_HUMAN_ATTENDANTS.map((a) => ({ ...a }));
  private readonly environment: 'teste' | 'homologacao' | 'producao';
  private readonly companyId: string;

  constructor(options?: { environment?: 'teste' | 'homologacao' | 'producao'; companyId?: string }) {
    this.environment = options?.environment ?? 'teste';
    this.companyId = options?.companyId ?? 'bgr_beneficios';
  }

  /**
   * Obtém ou inicializa uma sessão isolada de conversa.
   */
  getOrCreateConversation(sessionId: string, channel: Conversation['channel'] = 'chat_teste'): Conversation {
    const existing = this.conversations.get(sessionId);
    if (existing) {
      return existing;
    }

    const nowIso = new Date().toISOString();
    const conv: Conversation = {
      session_id: sessionId,
      channel,
      attendance_mode: 'ia_ativa',
      current_stage: 'contato_iniciado',
      started_at: nowIso,
      last_interaction_at: nowIso,
    };
    this.conversations.set(sessionId, conv);
    return conv;
  }

  /**
   * Verifica se a IA pode responder na sessão atual ou se a trava humana está ativa.
   */
  evaluateIncomingMessageGate(sessionId: string, channel: Conversation['channel'] = 'chat_teste'): IncomingMessageGateResult {
    const conv = this.getOrCreateConversation(sessionId, channel);
    conv.last_interaction_at = new Date().toISOString();

    const activeHandoff = this.handoffsBySession.get(sessionId);

    if (conv.attendance_mode === 'humano_ativo') {
      // Quando o humano já assumiu, a IA fica 100% em silêncio e a mensagem vai direto para a fila humana
      return {
        allow_ai_processing: false,
        attendance_mode: 'humano_ativo',
        routed_to_human_queue: activeHandoff?.target_queue ?? 'comercial',
        auto_reply_message: null,
      };
    }

    if (conv.attendance_mode === 'aguardando_humano') {
      // Enquanto aguarda o humano assumir, a IA não executa fluxo comercial; apenas informa que o atendente já foi acionado
      return {
        allow_ai_processing: false,
        attendance_mode: 'aguardando_humano',
        routed_to_human_queue: activeHandoff?.target_queue ?? 'comercial',
        auto_reply_message:
          'Sua solicitação já está na fila de prioridade e um especialista da BGR Benefícios assumirá esta conversa em instantes. Suas novas mensagens já estão sendo registradas no protocolo.',
      };
    }

    return {
      allow_ai_processing: true,
      attendance_mode: 'ia_ativa',
      routed_to_human_queue: null,
      auto_reply_message: null,
    };
  }

  /**
   * Aciona o protocolo de transferência para atendimento humano (T18 / T19):
   * - Muda a sessão para 'aguardando_humano'
   * - Cria o ticket com acknowledgment_status = 'aguardando_confirmacao'
   * - NUNCA mente dizendo que o humano já assumiu antes da confirmação do receptor
   */
  initiateHandoff(params: {
    sessionId: string;
    channel?: Conversation['channel'];
    trigger: HandoffTriggerReason;
    conversationSummary: string;
    customReasonText?: string;
  }): HandoffInitiationResult {
    const { sessionId, trigger, conversationSummary, customReasonText } = params;
    const conv = this.getOrCreateConversation(sessionId, params.channel ?? 'chat_teste');
    const rule = ROUTING_MATRIX[trigger];
    const nowIso = new Date().toISOString();

    const rawIdem = `${sessionId}|handoff|${trigger}|${nowIso.slice(0, 13)}`;
    const idemHash = crypto.createHash('sha256').update(rawIdem, 'utf8').digest('hex').slice(0, 18);
    const ticketId = `TCK-${idemHash.slice(0, 8).toUpperCase()}`;

    const sanitizedSummary = sanitizeForAudit(conversationSummary).sanitized_text;
    const reasonText = customReasonText ?? `Gatilho de transferência acionado: ${trigger}`;

    const handoff: Handoff = {
      ticket_id: ticketId,
      idempotency_key: `idem_hdf_${idemHash}`,
      session_id: sessionId,
      target_queue: rule.queue,
      priority: rule.priority,
      reason: reasonText,
      conversation_summary: sanitizedSummary.length >= 10 ? sanitizedSummary : `${sanitizedSummary} (resumo registrado)`,
      acknowledgment_status: 'aguardando_confirmacao',
      created_at: nowIso,
    };

    conv.attendance_mode = 'aguardando_humano';
    conv.current_stage = 'atendimento_humano';
    conv.last_interaction_at = nowIso;

    this.handoffsBySession.set(sessionId, handoff);

    const emergencyNotice =
      trigger === 'comunicacao_sinistro_emergencia'
        ? '🚨 Para atendimento imediato de emergência/sinistro 24h, você também pode acionar diretamente a central 0800 oficial da BGR Benefícios. '
        : '';

    const customerMessage =
      `${emergencyNotice}Estou encaminhando seu atendimento com o resumo da nossa conversa para o setor *${rule.queue.toUpperCase()}* da BGR Benefícios (Protocolo *${ticketId}*, prioridade *${rule.priority}*). ` +
      `No momento seu pedido está *aguardando confirmação do atendente* e um especialista assumirá esta conversa em instantes.`;

    const auditEvent: AuditEvent = {
      event_id: `evt_hdf_${ticketId}`,
      idempotency_key: handoff.idempotency_key,
      correlation_id: `corr_${ticketId}`,
      timestamp: nowIso,
      environment: this.environment,
      company_id: this.companyId,
      session_id: sessionId,
      event_type: `handoff_initiated_${rule.queue}`,
      severity: rule.priority === 'CRITICA' ? 'CRITICAL' : 'HIGH',
      status: 'pendente',
      http_code: 202,
      safe_summary: `Transferência iniciada na sessão ${sessionId} para fila ${rule.queue} (${ticketId}) - aguardando confirmação humana.`,
    };

    return {
      handoff: { ...handoff },
      conversation: { ...conv },
      customer_message: customerMessage,
      audit_event: auditEvent,
    };
  }

  /**
   * Confirma que o atendente humano assumiu o ticket (Takeover confirmado):
   * - Atualiza acknowledgment_status para 'confirmado'
   * - Muda attendance_mode para 'humano_ativo' (silenciando totalmente a IA)
   */
  confirmHumanTakeover(sessionId: string, agentIdentifier: string): {
    handoff: Handoff;
    conversation: Conversation;
    audit_event: AuditEvent;
  } {
    const conv = this.conversations.get(sessionId);
    const handoff = this.handoffsBySession.get(sessionId);

    if (!conv || !handoff) {
      throw new Error(`Nenhum handoff pendente encontrado para a sessão '${sessionId}'.`);
    }

    const nowIso = new Date().toISOString();
    handoff.acknowledgment_status = 'confirmado';
    conv.attendance_mode = 'humano_ativo';
    conv.last_interaction_at = nowIso;

    const auditEvent: AuditEvent = {
      event_id: `evt_ack_${handoff.ticket_id}`,
      idempotency_key: `idem_ack_${handoff.ticket_id}`,
      correlation_id: `corr_${handoff.ticket_id}`,
      timestamp: nowIso,
      environment: this.environment,
      company_id: this.companyId,
      session_id: sessionId,
      event_type: 'handoff_confirmed_human_active',
      severity: 'MEDIUM',
      status: 'sucesso',
      http_code: 200,
      safe_summary: sanitizeForAudit(
        `Takeover humano confirmado no protocolo ${handoff.ticket_id} pelo atendente ${agentIdentifier}. IA silenciada.`
      ).sanitized_text,
    };

    return {
      handoff: { ...handoff },
      conversation: { ...conv },
      audit_event: auditEvent,
    };
  }

  /**
   * Devolve explicitamente a sessão para a IA somente quando o atendente humano encerrar o ticket.
   */
  releaseSessionToAi(sessionId: string): Conversation {
    const conv = this.getOrCreateConversation(sessionId);
    conv.attendance_mode = 'ia_ativa';
    conv.last_interaction_at = new Date().toISOString();
    this.handoffsBySession.delete(sessionId);
    return { ...conv };
  }

  /**
   * Lista todos os atendentes humanos cadastrados (opcionalmente filtrados por fila).
   */
  listHumanAttendants(queue?: Handoff['target_queue']): HumanAttendantProfile[] {
    const list = queue
      ? this.humanAttendants.filter((a) => a.queue === queue)
      : this.humanAttendants;
    return list.map((a) => ({ ...a }));
  }

  /**
   * Cadastra um novo atendente humano na equipe da BGR Benefícios.
   */
  registerHumanAttendant(params: {
    name: string;
    email: string;
    whatsapp_phone: string;
    queue: Handoff['target_queue'];
    role_title?: string;
    shift_hours?: string;
    status?: HumanAttendantProfile['status'];
  }): HumanAttendantProfile {
    const cleanName = params.name.trim() || 'Consultor BGR';
    const profile: HumanAttendantProfile = {
      attendant_id: `atd_${Date.now()}`,
      name: cleanName,
      email: params.email.trim() || 'consultor@bgrbeneficios.com.br',
      whatsapp_phone: params.whatsapp_phone.trim() || '+55 31 99000-0000',
      queue: params.queue || 'comercial',
      role_title: params.role_title?.trim() || 'Consultor Especialista BGR',
      shift_hours: params.shift_hours?.trim() || '08:00 às 18:00',
      status: params.status || 'online',
      active_sessions_count: 0,
      created_at: new Date().toISOString(),
    };
    this.humanAttendants.unshift(profile);
    return { ...profile };
  }

  /**
   * Atualiza o status de disponibilidade de um atendente humano (online, pausa, ocupado, offline).
   */
  updateHumanAttendantStatus(
    attendantId: string,
    status: HumanAttendantProfile['status']
  ): HumanAttendantProfile | null {
    const found = this.humanAttendants.find((a) => a.attendant_id === attendantId);
    if (!found) return null;
    found.status = status;
    return { ...found };
  }

  /**
   * Remove um atendente humano da lista.
   */
  removeHumanAttendant(attendantId: string): boolean {
    const before = this.humanAttendants.length;
    this.humanAttendants = this.humanAttendants.filter((a) => a.attendant_id !== attendantId);
    return this.humanAttendants.length < before;
  }

  /**
   * Atribui imediatamente uma sessão de conversa a um atendente humano cadastrado (Takeover direto).
   */
  assignSessionToHumanAttendant(sessionId: string, attendantId: string): {
    attendant: HumanAttendantProfile;
    handoff: Handoff;
    conversation: Conversation;
    audit_event: AuditEvent;
  } {
    const attendant = this.humanAttendants.find((a) => a.attendant_id === attendantId);
    if (!attendant) {
      throw new Error(`Atendente humano '${attendantId}' não encontrado.`);
    }

    if (!this.handoffsBySession.has(sessionId)) {
      this.initiateHandoff({
        sessionId,
        channel: 'chat_teste',
        trigger: 'solicitacao_explicita_cliente',
        conversationSummary: `Atendimento atribuído diretamente ao especialista humano ${attendant.name} (${attendant.queue}).`,
      });
    }

    const ack = this.confirmHumanTakeover(sessionId, `${attendant.name} (${attendant.email})`);
    attendant.active_sessions_count += 1;
    attendant.status = 'ocupado';

    return {
      attendant: { ...attendant },
      ...ack,
    };
  }
}
