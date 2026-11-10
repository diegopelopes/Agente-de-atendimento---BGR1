/**
 * BGR Benefícios — Sanitizador de Logs, PII (LGPD) e Credenciais (Fase 1)
 * Regra Operacional: Sem tokens em prompts, repositórios, prints, logs ou mensagens;
 * evitar placa/telefone/CPF completos em logs de auditoria.
 */

export interface SanitizeResult {
  sanitized_text: string;
  redacted_secrets_count: number;
  masked_pii_count: number;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /EAA[A-Za-z0-9]{16,}/g, // Meta / WhatsApp Cloud API tokens
  /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9\-._~+/]{8,}["']?/gi,
];

/**
 * Mascara CPF (ex: 123.456.789-00 -> ***.456.789-**)
 */
export function maskCpf(input: string): string {
  return input.replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, '***.$2.$3-**');
}

/**
 * Mascara placas Mercosul e antigas (ex: ABC1D23 -> ABC-**23, ABC-1234 -> ABC-**34)
 */
export function maskPlate(input: string): string {
  return input.replace(/\b([A-Z]{3})[- ]?([0-9][A-Z0-9])([0-9]{2})\b/gi, '$1-**$3');
}

/**
 * Mascara telefones mantendo apenas DDI/DDD e últimos 4 dígitos (ex: +5511999990001 -> +5511*****0001)
 */
export function maskPhone(input: string): string {
  return input.replace(/(\+?55?\s?\(?\d{2}\)?\s?)(\d{4,5})[- ]?(\d{4})\b/g, '$1*****$3');
}

/**
 * Remove tokens/segredos e mascara dados pessoais sensíveis de qualquer string antes de gravar em log.
 */
export function sanitizeForAudit(rawText: string): SanitizeResult {
  let text = rawText;
  let secretsCount = 0;
  let piiCount = 0;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      secretsCount += 1;
      return '[REDACTED_SECRET]';
    });
  }

  const beforeCpf = text;
  text = maskCpf(text);
  if (text !== beforeCpf) piiCount += 1;

  const beforePlate = text;
  text = maskPlate(text);
  if (text !== beforePlate) piiCount += 1;

  const beforePhone = text;
  text = maskPhone(text);
  if (text !== beforePhone) piiCount += 1;

  return {
    sanitized_text: text,
    redacted_secrets_count: secretsCount,
    masked_pii_count: piiCount,
  };
}
