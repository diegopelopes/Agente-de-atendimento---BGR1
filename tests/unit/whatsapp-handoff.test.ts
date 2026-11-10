import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HandoffService } from '../../src/services/handoff-service.ts';
import { WhatsAppChannelService } from '../../src/channels/whatsapp/channel-service.ts';

describe('Fase 5 — WhatsApp Business Platform, Sessões Isoladas, Opt-out e Transferência Humana (Handoff)', () => {
  test('T18 (Solicitar Atendente + Trava IA vs. Humano): Não mente antes do ACK e silencia IA durante takeover humano', () => {
    const handoffService = new HandoffService();
    const sessionId = 'sess_t18_001';

    // 1. Cliente solicita falar com humano
    const init = handoffService.initiateHandoff({
      sessionId,
      channel: 'whatsapp_oficial',
      trigger: 'solicitacao_explicita_cliente',
      conversationSummary: 'Cliente Carlos solicitou falar com consultor sobre Honda Civic 2022.',
    });

    assert.equal(init.handoff.acknowledgment_status, 'aguardando_confirmacao');
    assert.equal(init.conversation.attendance_mode, 'aguardando_humano');
    assert.equal(init.handoff.target_queue, 'comercial');
    assert.equal(init.handoff.priority, 'ALTA');
    assert.equal(
      init.customer_message.includes('aguardando confirmação do atendente'),
      true,
      'Não deve mentir dizendo que o atendente já assumiu antes da confirmação'
    );

    // 2. Cliente manda mensagem enquanto ainda aguarda humano assumir
    const gateWaiting = handoffService.evaluateIncomingMessageGate(sessionId, 'whatsapp_oficial');
    assert.equal(gateWaiting.allow_ai_processing, false);
    assert.equal(gateWaiting.attendance_mode, 'aguardando_humano');
    assert.ok(gateWaiting.auto_reply_message?.includes('já está na fila'));

    // 3. Atendente humano confirma o recebimento e assume a conversa (Takeover)
    const confirmed = handoffService.confirmHumanTakeover(sessionId, 'consultor.marcos@bgr');
    assert.equal(confirmed.handoff.acknowledgment_status, 'confirmado');
    assert.equal(confirmed.conversation.attendance_mode, 'humano_ativo');

    // 4. Com humano ativo, a IA fica 100% silenciada (allow_ai_processing = false, auto_reply_message = null)
    const gateActive = handoffService.evaluateIncomingMessageGate(sessionId, 'whatsapp_oficial');
    assert.equal(gateActive.allow_ai_processing, false);
    assert.equal(gateActive.attendance_mode, 'humano_ativo');
    assert.equal(gateActive.auto_reply_message, null, 'IA não deve enviar nenhuma mensagem enquanto o humano conversa');

    // 5. Quando o humano encerra e devolve a sessão para a IA
    const released = handoffService.releaseSessionToAi(sessionId);
    assert.equal(released.attendance_mode, 'ia_ativa');
  });

  test('T19 (Roteamento Setorial): Separa Sinistros (CRITICA + 0800), Cancelamento (retencao) e Reclamação (ouvidoria)', () => {
    const handoffService = new HandoffService();

    const sinistro = handoffService.initiateHandoff({
      sessionId: 'sess_sinistro',
      trigger: 'comunicacao_sinistro_emergencia',
      conversationSummary: 'Associado relatou colisão e precisa de assistência urgente.',
    });
    assert.equal(sinistro.handoff.target_queue, 'sinistros');
    assert.equal(sinistro.handoff.priority, 'CRITICA');
    assert.equal(sinistro.customer_message.includes('0800'), true);

    const cancelamento = handoffService.initiateHandoff({
      sessionId: 'sess_cancel',
      trigger: 'pedido_cancelamento',
      conversationSummary: 'Associado solicitou cancelamento da proteção.',
    });
    assert.equal(cancelamento.handoff.target_queue, 'retencao');
    assert.equal(cancelamento.handoff.priority, 'ALTA');

    const ouvidoria = handoffService.initiateHandoff({
      sessionId: 'sess_ouvidoria',
      trigger: 'reclamacao_sensivel_ouvidoria',
      conversationSummary: 'Cliente insatisfeito solicitando posicionamento da ouvidoria.',
    });
    assert.equal(ouvidoria.handoff.target_queue, 'ouvidoria');
    assert.equal(ouvidoria.handoff.priority, 'CRITICA');
  });

  test('T23 & T32 (WhatsApp Inbound): Isola sessões por telefone e deduplica wamid repetido pela Meta', () => {
    const handoffService = new HandoffService();
    const waService = new WhatsAppChannelService(handoffService);

    const first = waService.processInboundWebhook({
      message_id: 'wamid.HBgMNTUxMTk5OTk5MDAwMVUCABIYFDNB',
      from_phone: '+5511999990001',
      text_body: 'Olá, quero fazer uma cotação',
      received_at_iso: '2026-11-10T10:00:00.000Z',
    });

    const duplicate = waService.processInboundWebhook({
      message_id: 'wamid.HBgMNTUxMTk5OTk5MDAwMVUCABIYFDNB',
      from_phone: '+5511999990001',
      text_body: 'Olá, quero fazer uma cotação',
      received_at_iso: '2026-11-10T10:00:02.000Z',
    });

    const otherContact = waService.processInboundWebhook({
      message_id: 'wamid.HBgMNTUxMTk5OTk5MDAwMlUCABIYFDNC',
      from_phone: '+5511999990002',
      text_body: 'Bom dia',
      received_at_iso: '2026-11-10T10:01:00.000Z',
    });

    assert.equal(first.duplicate_ignored, false);
    assert.equal(first.allow_ai_agent, true);
    assert.equal(duplicate.duplicate_ignored, true, 'Deve ignorar reenvio do mesmo wamid pela Meta');
    assert.equal(duplicate.allow_ai_agent, false);
    assert.notEqual(
      first.session_id,
      otherContact.session_id,
      'Telefones diferentes devem ter session_id estritamente isolados'
    );
  });

  test('T24, T25 & T26 (Janela de 24h do WhatsApp e Templates Aprovados): Permite texto em <24h, bloqueia texto em >24h e exige template aprovado', () => {
    const handoffService = new HandoffService();
    const waService = new WhatsAppChannelService(handoffService);

    const inbound = waService.processInboundWebhook({
      message_id: 'wamid.window_test_001',
      from_phone: '+5511999990001',
      text_body: 'Quero cotação',
      received_at_iso: '2026-11-10T10:00:00.000Z',
    });

    // T24: 2 horas depois (dentro da janela de 24h) -> permite texto livre
    const textInside24h = waService.prepareOutboundMessage({
      session_id: inbound.session_id,
      to_phone: '+5511999990001',
      message_type: 'text',
      text_body: 'Olá! Qual é o seu nome?',
      now_iso: '2026-11-10T12:00:00.000Z',
    });
    assert.equal(textInside24h.allowed, true);
    assert.equal(textInside24h.within_24h_window, true);
    assert.equal(textInside24h.meta_api_payload?.type, 'text');

    // T25: 26 horas depois (fora da janela de 24h) -> bloqueia texto livre
    const textOutside24h = waService.prepareOutboundMessage({
      session_id: inbound.session_id,
      to_phone: '+5511999990001',
      message_type: 'text',
      text_body: 'Oi, ainda tem interesse?',
      now_iso: '2026-11-11T12:00:00.000Z',
    });
    assert.equal(textOutside24h.allowed, false);
    assert.equal(textOutside24h.blocked_reason, 'OUTSIDE_24H_WINDOW_REQUIRES_TEMPLATE');

    // T26: 26 horas depois usando template aprovado pela Meta ('bgr_followup') -> permitido!
    const templateOutside24h = waService.prepareOutboundMessage({
      session_id: inbound.session_id,
      to_phone: '+5511999990001',
      message_type: 'template',
      template_name: 'bgr_followup',
      template_params: ['Carlos', 'Honda Civic'],
      now_iso: '2026-11-11T12:00:00.000Z',
    });
    assert.equal(templateOutside24h.allowed, true);
    assert.equal(templateOutside24h.meta_api_payload?.type, 'template');

    // Template não aprovado -> bloqueado
    const unapprovedTpl = waService.prepareOutboundMessage({
      session_id: inbound.session_id,
      to_phone: '+5511999990001',
      message_type: 'template',
      template_name: 'template_nao_aprovado_meta',
      now_iso: '2026-11-11T12:00:00.000Z',
    });
    assert.equal(unapprovedTpl.allowed, false);
    assert.equal(unapprovedTpl.blocked_reason, 'UNAPPROVED_TEMPLATE');
  });

  test('T31 (Opt-Out no WhatsApp): Comando PARAR revoga consentimento imediatamente e bloqueia disparos futuros', () => {
    const handoffService = new HandoffService();
    const waService = new WhatsAppChannelService(handoffService);

    const optOutMsg = waService.processInboundWebhook({
      message_id: 'wamid.optout_001',
      from_phone: '+5511999990004',
      text_body: 'PARAR',
      received_at_iso: '2026-11-10T14:00:00.000Z',
    });

    assert.equal(optOutMsg.opt_out_processed, true);
    assert.equal(optOutMsg.allow_ai_agent, false);
    assert.equal(optOutMsg.consent_state.opt_out_requested, true);
    assert.equal(optOutMsg.consent_state.opt_in_status, 'revoked');
    assert.ok(optOutMsg.immediate_reply_text?.includes('descadastro foi realizado com sucesso'));

    // Tentativa de enviar campanha depois do opt-out deve ser bloqueada
    const blockedAttempt = waService.prepareOutboundMessage({
      session_id: optOutMsg.session_id,
      to_phone: '+5511999990004',
      message_type: 'template',
      template_name: 'bgr_reativacao',
      template_params: ['Roberto'],
      now_iso: '2026-11-10T15:00:00.000Z',
    });

    assert.equal(blockedAttempt.allowed, false);
    assert.equal(blockedAttempt.blocked_reason, 'OPT_OUT_ACTIVE');
  });

  test('Cadastro e Gestão de Atendentes Humanos (Consultores BGR + Takeover Direto)', () => {
    const handoffService = new HandoffService();

    const initialList = handoffService.listHumanAttendants();
    assert.equal(initialList.length, 4);

    // Cadastra novo atendente humano
    const created = handoffService.registerHumanAttendant({
      name: 'Rafael Mendes',
      email: 'rafael.mendes@bgrbeneficios.com.br',
      whatsapp_phone: '+55 31 99555-7788',
      queue: 'comercial',
      role_title: 'Consultor Fechamento Digital',
      shift_hours: '08:00 às 18:00',
      status: 'online',
    });

    assert.equal(handoffService.listHumanAttendants().length, 5);
    assert.equal(created.name, 'Rafael Mendes');
    assert.equal(created.queue, 'comercial');

    // Atribui sessão de atendimento diretamente ao atendente recém-cadastrado
    const assigned = handoffService.assignSessionToHumanAttendant('sess_rafael_01', created.attendant_id);
    assert.equal(assigned.conversation.attendance_mode, 'humano_ativo');
    assert.equal(assigned.handoff.acknowledgment_status, 'confirmado');
    assert.equal(assigned.attendant.active_sessions_count, 1);
    assert.equal(assigned.attendant.status, 'ocupado');

    // Altera status para pausa e remove
    const paused = handoffService.updateHumanAttendantStatus(created.attendant_id, 'pausa');
    assert.equal(paused?.status, 'pausa');

    const removed = handoffService.removeHumanAttendant(created.attendant_id);
    assert.equal(removed, true);
    assert.equal(handoffService.listHumanAttendants().length, 4);
  });
});
