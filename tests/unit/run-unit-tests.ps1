# ============================================================================
# BGR Beneficios - Suite de Testes Unitarios e de Seguranca (Fase 1)
# Valida contratos JSON Schema, Qualificacao, Maquina de Estados,
# Idempotencia, Sanitizacao de PII/Tokens e Auditoria de Workflows n8n.
# ============================================================================

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. "$ProjectRoot\src\runtime\BgrCore.ps1"

$TotalTests = 0
$PassedTests = 0
$FailedTests = 0

function Assert-Test {
    param(
        [string]$TestName,
        [bool]$Condition,
        [string]$FailureMessage = "Falha na assercao"
    )
    $script:TotalTests++
    if ($Condition) {
        $script:PassedTests++
        Write-Host "  [PASS] $TestName" -ForegroundColor Green
    } else {
        $script:FailedTests++
        Write-Host "  [FAIL] $TestName -> $FailureMessage" -ForegroundColor Red
    }
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " BGR BENEFICIOS - EXECUCAO DE TESTES AUTOMATIZADOS (FASE 1)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# --- SUITE 1: Validacao de Estrutura e Contratos JSON Schema ---
Write-Host "`n[1/5] Validando Contratos JSON Schema e Arquivos Essenciais..." -ForegroundColor Yellow

$schemaPath = "$ProjectRoot\src\domain\contracts.schema.json"
Assert-Test "Arquivo contracts.schema.json existe" (Test-Path $schemaPath)

$schemaJson = Get-Content $schemaPath -Raw -Encoding UTF8 | ConvertFrom-Json
$requiredEntities = @('Lead', 'Vehicle', 'QuoteRequest', 'QuoteResult', 'Conversation', 'Consent', 'Opportunity', 'Handoff', 'PaymentStatus', 'AuditEvent')
foreach ($entity in $requiredEntities) {
    $hasEntity = $null -ne $schemaJson.'$defs'.$entity
    Assert-Test "Contrato tipado definido no Schema: $entity" $hasEntity "Entidade $entity ausente em defs"
}

# --- SUITE 2: Regras de Qualificacao Comercial (Evitar Cotacao Incompleta) ---
Write-Host "`n[2/5] Validando Qualificacao de Lead e Veiculo (T07 / T08)..." -ForegroundColor Yellow

$incompleteCheck = Test-BgrLeadQualification -Lead @{ name = "Carlos" } -Vehicle @{ model = "Civic" }
Assert-Test "Bloqueia cotacao com dados incompletos (T08)" (-not $incompleteCheck.ready_for_quote)
Assert-Test "Identifica 5 campos faltantes (phone, city_uf, brand, year, usage)" ($incompleteCheck.missing_fields.Count -eq 5)

$completeCheck = Test-BgrLeadQualification `
    -Lead @{ name = "Carlos Eduardo Silva"; phone = "+5511999990001"; city_uf = "Belo Horizonte/MG" } `
    -Vehicle @{ brand = "Honda"; model = "Civic"; year = 2022; usage = "particular"; is_auction = $false }
Assert-Test "Aprova qualificacao com dados obrigatorios completos (T07)" ($completeCheck.ready_for_quote -and $completeCheck.missing_fields.Count -eq 0)

$auctionCheck = Test-BgrLeadQualification `
    -Lead @{ name = "Joao Pedro"; phone = "+5511999990003"; city_uf = "Sao Paulo/SP" } `
    -Vehicle @{ brand = "Fiat"; model = "Pulse"; year = 2024; usage = "aplicativo"; is_auction = $true }
Assert-Test "Sinaliza revisao humana obrigatoria para veiculo de leilao" ($auctionCheck.requires_human_review)

# --- SUITE 3: Maquina de Estados Comercial (Prevencao de Ativacao Prematura) ---
Write-Host "`n[3/5] Validando Maquina de Estados de Proposta/Pagamento (T27 / T28 / T29)..." -ForegroundColor Yellow

$prematureSignOnly = Test-BgrOpportunityStateTransition `
    -Opportunity @{ stage = "contratacao_confirmada"; signature_verified = $true; payment_verified = $false; activation_confirmed = $true } `
    -PaymentStatus @{ status = "comprovante_enviado_nao_validado"; verified_by_system = $false }
Assert-Test "BLOQUEIA ativacao apenas com assinatura ou comprovante nao validado (T27/T28)" (-not $prematureSignOnly.valid)

$officialConfirmed = Test-BgrOpportunityStateTransition `
    -Opportunity @{ stage = "contratacao_confirmada"; signature_verified = $true; payment_verified = $true; activation_confirmed = $true } `
    -PaymentStatus @{ status = "confirmado_oficial"; verified_by_system = $true }
Assert-Test "PERMITE ativacao somente com assinatura + pagamento oficialmente confirmados (T29)" ($officialConfirmed.valid)

# --- SUITE 4: Sanitizacao de PII (LGPD), Idempotencia e Vazamento de Tokens ---
Write-Host "`n[4/5] Validando Sanitizacao de Logs, LGPD, Opt-out e Idempotencia (T20 / T30 / T31 / T32)..." -ForegroundColor Yellow

$rawLog = "Cliente CPF 123.456.789-00, placa ABC1D23, tel +5511999990001 usou Authorization: Bearer segredoSuperSecreto123456 e sk-proj1234567890abcdefghij"
$sanitized = Invoke-BgrSanitizeText -InputText $rawLog
Assert-Test "Remove tokens Bearer e chaves OpenAI dos logs (T20)" ($sanitized.redacted_secrets_count -ge 2 -and ($sanitized.sanitized_text -notmatch "segredoSuperSecreto"))
Assert-Test "Mascara CPF, Placa e Telefone nos logs de auditoria (LGPD)" (
    ($sanitized.sanitized_text -notmatch "123\.456\.789-00") -and
    ($sanitized.sanitized_text -notmatch "ABC1D23") -and
    ($sanitized.sanitized_text -notmatch "999990001") -and
    ($sanitized.masked_pii_count -eq 3)
)

$idem1 = Get-BgrIdempotencyKey -SessionId "sess-001" -Operation "create_lead" -EntityFingerprint "+5511999990001|TST0A01"
$idem2 = Get-BgrIdempotencyKey -SessionId "sess-001" -Operation "create_lead" -EntityFingerprint "+5511999990001|TST0A01"
$idem3 = Get-BgrIdempotencyKey -SessionId "sess-002" -Operation "create_lead" -EntityFingerprint "+5511999990001|TST0A01"
Assert-Test "Chave de idempotencia deterministica para evitar duplicidade (T32)" (($idem1 -eq $idem2) -and ($idem1 -ne $idem3))

$optOutContact = Test-BgrCampaignEligibility -Consent @{ opt_in_status = "granted"; legal_basis = "consentimento_explicito"; opt_out_requested = $true }
Assert-Test "Bloqueia disparo de campanha para contato em opt-out (T31)" (-not $optOutContact.eligible)

$validCampaignContact = Test-BgrCampaignEligibility -Consent @{ opt_in_status = "granted"; legal_basis = "consentimento_explicito"; opt_out_requested = $false }
Assert-Test "Aprova disparo apenas para contato com opt-in e base legal (T30)" ($validCampaignContact.eligible)

# --- SUITE 5: Auditoria de Seguranca nos Workflows n8n e .env.example ---
Write-Host "`n[5/5] Auditando Workflows n8n e .env.example contra Segredos Expostos..." -ForegroundColor Yellow

$workflowFiles = @(Get-ChildItem "$ProjectRoot\workflows\*.json") + @(Get-ChildItem "$ProjectRoot\n8n\exports-sanitizados\*.json")
foreach ($wf in $workflowFiles) {
    $content = Get-Content $wf.FullName -Raw -Encoding UTF8
    $parsed = $content | ConvertFrom-Json
    Assert-Test "JSON valido e integro: $($wf.Name)" ($null -ne $parsed.nodes)
    $leakCheck = Invoke-BgrSanitizeText -InputText $content
    Assert-Test "Zero tokens reais expostos em: $($wf.Name)" ($leakCheck.redacted_secrets_count -eq 0)
}

$envExampleContent = Get-Content "$ProjectRoot\.env.example" -Raw -Encoding UTF8
Assert-Test "Arquivo .env.example nao contem chaves reais preenchidas" (
    ($envExampleContent -match "OPENAI_API_KEY=\s*(\r?\n|$)") -and
    ($envExampleContent -match "POWERCRM_BEARER_TOKEN=\s*(\r?\n|$)")
)

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host " RESUMO: $PassedTests/$TotalTests TESTES APROVADOS | FALHAS: $FailedTests" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

if ($FailedTests -gt 0) {
    exit 1
}
exit 0
