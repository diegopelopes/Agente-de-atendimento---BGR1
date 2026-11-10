# ============================================================================
# BGR Beneficios - Runtime Nativo de Validacao de Contratos, Estados e Seguranca
# Implementa as invariantes de src/domain/contracts.ts e src/observability/sanitizer.ts
# para execucao imediata em Windows PowerShell / .NET sem dependencias externas.
# ============================================================================

Set-StrictMode -Version Latest

function Get-BgrIdempotencyKey {
    param(
        [Parameter(Mandatory=$true)][string]$SessionId,
        [Parameter(Mandatory=$true)][string]$Operation,
        [Parameter(Mandatory=$true)][string]$EntityFingerprint
    )
    $raw = "$SessionId|$Operation|$EntityFingerprint"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
    $hashBytes = $sha256.ComputeHash($bytes)
    $hex = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
    return "idem_" + $hex.Substring(0, 24)
}

function Invoke-BgrSanitizeText {
    param(
        [Parameter(Mandatory=$true)][AllowEmptyString()][string]$InputText
    )
    $text = $InputText
    $secretsCount = 0
    $piiCount = 0

    # 1. Redact Bearer tokens, OpenAI keys (sk-...), Meta tokens (EAA...), and key=value secrets
    $secretPatterns = @(
        'Bearer\s+[A-Za-z0-9\-._~+/]+=*',
        'sk-[A-Za-z0-9]{16,}',
        'EAA[A-Za-z0-9]{16,}',
        '(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*["'']?[A-Za-z0-9\-._~+/]{8,}["'']?'
    )

    foreach ($pat in $secretPatterns) {
        $matchesFound = [regex]::Matches($text, $pat)
        if ($matchesFound.Count -gt 0) {
            $secretsCount += $matchesFound.Count
            $text = [regex]::Replace($text, $pat, '[REDACTED_SECRET]')
        }
    }

    # 2. Mask CPF (123.456.789-00 -> ***.456.789-**)
    $cpfPattern = '\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b'
    if ([regex]::IsMatch($text, $cpfPattern)) {
        $piiCount++
        $text = [regex]::Replace($text, $cpfPattern, '***.$2.$3-**')
    }

    # 3. Mask License Plate (ABC1D23 or ABC-1234 -> ABC-**23 / ABC-**34)
    $platePattern = '\b([A-Za-z]{3})[- ]?([0-9][A-Za-z0-9])([0-9]{2})\b'
    if ([regex]::IsMatch($text, $platePattern)) {
        $piiCount++
        $text = [regex]::Replace($text, $platePattern, '$1-**$3')
    }

    # 4. Mask Phone (+5511999990001 -> +5511*****0001)
    $phonePattern = '(\+?55?\s?\(?\d{2}\)?\s?)(\d{4,5})[- ]?(\d{4})\b'
    if ([regex]::IsMatch($text, $phonePattern)) {
        $piiCount++
        $text = [regex]::Replace($text, $phonePattern, '$1*****$3')
    }

    return [PSCustomObject]@{
        sanitized_text         = $text
        redacted_secrets_count = $secretsCount
        masked_pii_count       = $piiCount
    }
}

function Test-BgrLeadQualification {
    param(
        [hashtable]$Lead,
        [hashtable]$Vehicle
    )
    $missing = New-Object System.Collections.Generic.List[string]

    if (-not $Lead -or [string]::IsNullOrWhiteSpace($Lead['name']) -or $Lead['name'].Trim().Length -lt 2) {
        $missing.Add('lead.name')
    }
    $cleanPhone = if ($Lead -and $Lead['phone']) { ($Lead['phone'] -replace '\D', '') } else { '' }
    if ($cleanPhone.Length -lt 10 -or $cleanPhone.Length -gt 15) {
        $missing.Add('lead.phone')
    }
    if (-not $Lead -or [string]::IsNullOrWhiteSpace($Lead['city_uf'])) {
        $missing.Add('lead.city_uf')
    }

    if (-not $Vehicle -or [string]::IsNullOrWhiteSpace($Vehicle['brand'])) {
        $missing.Add('vehicle.brand')
    }
    if (-not $Vehicle -or [string]::IsNullOrWhiteSpace($Vehicle['model'])) {
        $missing.Add('vehicle.model')
    }
    $year = if ($Vehicle -and $Vehicle['year']) { [int]$Vehicle['year'] } else { 0 }
    if ($year -lt 1980 -or $year -gt 2028) {
        $missing.Add('vehicle.year')
    }
    $validUsages = @('particular', 'aplicativo', 'comercial', 'taxi')
    if (-not $Vehicle -or -not $Vehicle['usage'] -or ($validUsages -notcontains $Vehicle['usage'])) {
        $missing.Add('vehicle.usage')
    }

    $isAuction = [bool]($Vehicle -and $Vehicle['is_auction'])
    $isModified = [bool]($Vehicle -and $Vehicle['is_modified'])
    $requiresHuman = ($isAuction -or $isModified)

    return [PSCustomObject]@{
        ready_for_quote       = ($missing.Count -eq 0)
        missing_fields        = $missing.ToArray()
        requires_human_review = $requiresHuman
    }
}

function Test-BgrOpportunityStateTransition {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Opportunity,
        [hashtable]$PaymentStatus
    )
    $errors = New-Object System.Collections.Generic.List[string]

    $isConfirming = ($Opportunity['stage'] -eq 'contratacao_confirmada') -or ([bool]$Opportunity['activation_confirmed'])
    if ($isConfirming) {
        if (-not [bool]$Opportunity['signature_verified']) {
            $errors.Add("BLOQUEIO: Ativacao negada sem assinatura digital verificada.")
        }
        if (-not [bool]$Opportunity['payment_verified']) {
            $errors.Add("BLOQUEIO: Ativacao negada sem confirmacao oficial de pagamento.")
        }
        if ($null -ne $PaymentStatus) {
            if ($PaymentStatus['status'] -ne 'confirmado_oficial' -or (-not [bool]$PaymentStatus['verified_by_system'])) {
                $errors.Add("BLOQUEIO: Comprovante nao validado ou status '$($PaymentStatus['status'])' nao autoriza ativacao.")
            }
        }
    }

    return [PSCustomObject]@{
        valid  = ($errors.Count -eq 0)
        errors = $errors.ToArray()
    }
}

function Test-BgrCampaignEligibility {
    param(
        [Parameter(Mandatory=$true)][hashtable]$Consent
    )
    if ([bool]$Consent['opt_out_requested']) {
        return [PSCustomObject]@{ eligible = $false; reason = 'opt_out_active' }
    }
    if ($Consent['opt_in_status'] -ne 'granted') {
        return [PSCustomObject]@{ eligible = $false; reason = 'missing_opt_in' }
    }
    if ([string]::IsNullOrWhiteSpace($Consent['legal_basis']) -or $Consent['legal_basis'] -eq 'nenhuma') {
        return [PSCustomObject]@{ eligible = $false; reason = 'missing_legal_basis' }
    }
    return [PSCustomObject]@{ eligible = $true; reason = 'ok' }
}
