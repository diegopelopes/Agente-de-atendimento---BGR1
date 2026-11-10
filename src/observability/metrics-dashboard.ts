/**
 * BGR Benefícios — Motor de Observabilidade, Alertas Operacionais e KPIs do Painel Gerencial (Fase 7)
 *
 * Implementa os requisitos das Seções 5, 8 e 12 e docs/painel-administrativo.md:
 * - Contrato: Entradas (event_id, duração, resultado) -> Saídas (métricas, alertas, trilha de auditoria)
 * - KPIs mínimos: leads únicos, conversas, taxa de qualificação, cotações oficiais criadas,
 *   propostas enviadas, conversão de contratos efetivamente confirmados, tempo até primeiro retorno,
 *   taxa de transferência, falhas CRM, contatos descadastrados, custo por conversa e
 *   receita atribuída SEM DUPLA CONTAGEM.
 */

import type { AuditEvent } from '../domain/contracts.ts';

export interface OperationalAlert {
  alert_id: string;
  event_id: string;
  severity: 'HIGH' | 'CRITICAL';
  category: 'CRM_AUTH_OR_OUTAGE' | 'SECURITY_THREAT' | 'STATE_MACHINE_VIOLATION';
  message: string;
  triggered_at: string;
}

export interface KpiDashboardSnapshot {
  unique_leads: number;
  total_conversations: number;
  qualified_leads: number;
  qualification_rate_pct: number;
  official_quotes_created: number;
  proposals_sent: number;
  confirmed_contracts: number;
  conversion_rate_pct: number;
  avg_first_response_ms: number;
  handoff_count: number;
  handoff_rate_pct: number;
  crm_failures: number;
  opt_out_contacts: number;
  total_cost_usd: number;
  avg_cost_per_conversation_usd: number;
  attributed_revenue_monthly_brl: number;
  active_alerts_count: number;
}

export class MetricsDashboardService {
  private readonly uniqueSessions = new Set<string>();
  private readonly uniqueLeads = new Set<string>();
  private readonly qualifiedLeads = new Set<string>();
  private readonly officialQuotes = new Set<string>();
  private readonly proposalsSent = new Set<string>();
  private readonly confirmedContractsByOpportunity = new Map<string, number>(); // opportunity_id -> monthly_revenue_brl (sem dupla contagem)
  private readonly handoffSessions = new Set<string>();
  private readonly optOutContacts = new Set<string>();
  private readonly responseTimesMs: number[] = [];
  private crmFailuresCount = 0;
  private totalCostUsd = 0;

  private readonly auditTrail: AuditEvent[] = [];
  private readonly alerts: OperationalAlert[] = [];

  /**
   * Registra evento de auditoria, contabiliza métricas operacionais e dispara alertas automáticos.
   */
  recordEvent(params: {
    auditEvent: AuditEvent;
    durationMs?: number;
    costUsd?: number;
    leadId?: string;
    qualified?: boolean;
    quoteCode?: string;
    proposalOpportunityId?: string;
    confirmedContract?: {
      opportunityId: string;
      officialMonthlyFeeBrl: number;
      signatureVerified: boolean;
      paymentVerified: boolean;
      activationConfirmed: boolean;
    };
  }): { recorded: boolean; generated_alert: OperationalAlert | null } {
    const { auditEvent, durationMs, costUsd, leadId, qualified, quoteCode, proposalOpportunityId, confirmedContract } =
      params;

    this.auditTrail.push(auditEvent);
    this.uniqueSessions.add(auditEvent.session_id);

    if (typeof durationMs === 'number' && durationMs >= 0) {
      this.responseTimesMs.push(durationMs);
    }

    if (typeof costUsd === 'number' && costUsd > 0) {
      this.totalCostUsd += costUsd;
    }

    if (leadId) {
      this.uniqueLeads.add(leadId);
      if (qualified) {
        this.qualifiedLeads.add(leadId);
      }
    }

    if (quoteCode && auditEvent.status === 'sucesso') {
      this.officialQuotes.add(quoteCode);
    }

    if (proposalOpportunityId && auditEvent.event_type.includes('proposal_created')) {
      this.proposalsSent.add(proposalOpportunityId);
    }

    // Contratos confirmados e Receita atribuída: exige verificação oficial e garante ZERO dupla contagem por opportunityId
    if (
      confirmedContract &&
      confirmedContract.signatureVerified &&
      confirmedContract.paymentVerified &&
      confirmedContract.activationConfirmed &&
      !this.confirmedContractsByOpportunity.has(confirmedContract.opportunityId)
    ) {
      this.confirmedContractsByOpportunity.set(
        confirmedContract.opportunityId,
        confirmedContract.officialMonthlyFeeBrl
      );
    }

    if (auditEvent.event_type.startsWith('handoff_initiated')) {
      this.handoffSessions.add(auditEvent.session_id);
    }

    if (
      auditEvent.event_type.includes('opt_out_confirmed') ||
      auditEvent.event_type.includes('suppressed_opt_out')
    ) {
      this.optOutContacts.add(auditEvent.session_id);
    }

    if (auditEvent.event_type.startsWith('powercrm_') && auditEvent.status === 'erro') {
      this.crmFailuresCount += 1;
    }

    // Geração automática de Alertas Operacionais
    let generatedAlert: OperationalAlert | null = null;
    if (auditEvent.severity === 'CRITICAL' || (auditEvent.event_type.startsWith('powercrm_') && auditEvent.status === 'erro' && auditEvent.severity === 'HIGH')) {
      const category: OperationalAlert['category'] = auditEvent.event_type.startsWith('security_')
        ? 'SECURITY_THREAT'
        : auditEvent.event_type.includes('blocked_inconsistent_state')
          ? 'STATE_MACHINE_VIOLATION'
          : 'CRM_AUTH_OR_OUTAGE';

      generatedAlert = {
        alert_id: `alt_${auditEvent.event_id}`,
        event_id: auditEvent.event_id,
        severity: auditEvent.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        category,
        message: `[${category}] ${auditEvent.safe_summary}`,
        triggered_at: auditEvent.timestamp,
      };
      this.alerts.push(generatedAlert);
    }

    return {
      recorded: true,
      generated_alert: generatedAlert,
    };
  }

  /**
   * Calcula o snapshot consolidado dos KPIs exigidos na Seção 12 e docs/painel-administrativo.md.
   */
  getDashboardSnapshot(): KpiDashboardSnapshot {
    const totalConversations = this.uniqueSessions.size;
    const uniqueLeadsCount = this.uniqueLeads.size;
    const qualifiedCount = this.qualifiedLeads.size;
    const confirmedCount = this.confirmedContractsByOpportunity.size;
    const handoffCount = this.handoffSessions.size;

    const qualificationRate =
      uniqueLeadsCount > 0 ? Number(((qualifiedCount / uniqueLeadsCount) * 100).toFixed(2)) : 0;

    const conversionRate =
      qualifiedCount > 0 ? Number(((confirmedCount / qualifiedCount) * 100).toFixed(2)) : 0;

    const handoffRate =
      totalConversations > 0 ? Number(((handoffCount / totalConversations) * 100).toFixed(2)) : 0;

    const avgResponseMs =
      this.responseTimesMs.length > 0
        ? Math.round(this.responseTimesMs.reduce((a, b) => a + b, 0) / this.responseTimesMs.length)
        : 0;

    let totalRevenueBrl = 0;
    for (const fee of this.confirmedContractsByOpportunity.values()) {
      totalRevenueBrl += fee;
    }

    const avgCostPerConv =
      totalConversations > 0 ? Number((this.totalCostUsd / totalConversations).toFixed(6)) : 0;

    return {
      unique_leads: uniqueLeadsCount,
      total_conversations: totalConversations,
      qualified_leads: qualifiedCount,
      qualification_rate_pct: qualificationRate,
      official_quotes_created: this.officialQuotes.size,
      proposals_sent: this.proposalsSent.size,
      confirmed_contracts: confirmedCount,
      conversion_rate_pct: conversionRate,
      avg_first_response_ms: avgResponseMs,
      handoff_count: handoffCount,
      handoff_rate_pct: handoffRate,
      crm_failures: this.crmFailuresCount,
      opt_out_contacts: this.optOutContacts.size,
      total_cost_usd: Number(this.totalCostUsd.toFixed(6)),
      avg_cost_per_conversation_usd: avgCostPerConv,
      attributed_revenue_monthly_brl: Number(totalRevenueBrl.toFixed(2)),
      active_alerts_count: this.alerts.length,
    };
  }

  getActiveAlerts(): OperationalAlert[] {
    return [...this.alerts];
  }

  getAuditTrail(): AuditEvent[] {
    return [...this.auditTrail];
  }
}
