$ErrorActionPreference = 'Stop'

# Execute este script na raiz do repositório NEXUS OS.
$relativePath = '.\frontend\app\(dashboard)\fiscal\page.tsx'
if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
    throw "Arquivo não encontrado: $relativePath. Execute o script na raiz do repositório."
}

$filePath = (Resolve-Path -LiteralPath $relativePath).Path
$initialHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
$originalBytes = [System.IO.File]::ReadAllBytes($filePath)
$hasBom = (
    $originalBytes.Length -ge 3 -and
    $originalBytes[0] -eq 0xEF -and
    $originalBytes[1] -eq 0xBB -and
    $originalBytes[2] -eq 0xBF
)
$utf8 = [System.Text.UTF8Encoding]::new($hasBom)
$content = [System.IO.File]::ReadAllText($filePath)

# Cada entrada usa um trecho específico do JSX. Os prefixos ? / : isolam
# classes condicionais e evitam atingir botões ou badges com aparência semelhante.
$changes = @(
    @{ Name = 'Botão Dashboard'; Count = 1; Before = 'className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-white/10 bg-[#1c1c2e] px-3 text-[12px] text-white/60 transition-all hover:bg-white/[0.06] hover:text-white"'; After = 'className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[12px] text-[var(--nx-ink-2)] transition-all hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]"' },
    @{ Name = 'Kicker Gestão'; Count = 1; Before = 'className="mt-4 text-[11px] uppercase tracking-[0.18em] text-white/40"'; After = 'className="mt-4 text-[11px] uppercase tracking-[0.18em] text-[var(--nx-ink-3)]"' },
    @{ Name = 'Título Fiscal Brasil'; Count = 1; Before = 'className="mt-1 text-[26px] font-black leading-tight tracking-tight text-white sm:text-[32px]"'; After = 'className="mt-1 text-[26px] font-black leading-tight tracking-tight text-[var(--nx-ink)] sm:text-[32px]"' },
    @{ Name = 'Descrição do cabeçalho'; Count = 1; Before = 'className="mt-2 max-w-3xl text-[14px] leading-6 text-white/60"'; After = 'className="mt-2 max-w-3xl text-[14px] leading-6 text-[var(--nx-ink-2)]"' },

    @{ Name = 'Ícone verde do valor fiscal'; Count = 1; Before = '<ArrowUpRight className="h-3 w-3 text-[#22c55e]" />'; After = '<ArrowUpRight className="h-3 w-3 text-[var(--nx-green)]" />' },
    @{ Name = 'Ícone verde de conclusão'; Count = 1; Before = '<CheckCircle2 className="h-3 w-3 text-[#22c55e]" />'; After = '<CheckCircle2 className="h-3 w-3 text-[var(--nx-green)]" />' },
    @{ Name = 'Ícone âmbar de pendências'; Count = 1; Before = '<ArrowDownRight className="h-3 w-3 text-[#eab308]" />'; After = '<ArrowDownRight className="h-3 w-3 text-[var(--nx-amber)]" />' },

    @{ Name = 'Indicador de integração conectada'; Count = 1; Before = "? 'animate-pulse bg-[#7c5cfc] shadow-[0_0_20px_rgba(124,92,252,0.3)]'"; After = "? 'animate-pulse bg-[var(--nx-accent)]'" },
    @{ Name = 'Indicador de integração desconectada'; Count = 1; Before = ": 'bg-white/20'"; After = ": 'bg-[var(--nx-border-strong)]'" },
    @{ Name = 'Badge de integração conectada'; Count = 1; Before = "? 'border border-[#eab308]/30 bg-[#eab308]/10 text-[#eab308]'"; After = "? 'border border-[color-mix(in_srgb,var(--nx-amber)_30%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-amber)_10%,transparent)] text-[var(--nx-amber)]'" },
    @{ Name = 'Badge de integração inativa'; Count = 1; Before = ": 'border border-white/10 bg-white/[0.06] text-white/50'"; After = ": 'border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-3)]'" },
    @{ Name = 'Descrição do status fiscal'; Count = 1; Before = 'className="mt-0.5 text-[12px] text-white/50"'; After = 'className="mt-0.5 text-[12px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Identificação do provedor'; Count = 1; Before = 'className="inline-flex h-8 items-center rounded-full border border-white/10 bg-[#24243a] px-3 text-[12px] text-white/60"'; After = 'className="inline-flex h-8 items-center rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[12px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Ícones da chave fiscal e da pesquisa'; Count = 2; Before = 'className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40"'; After = 'className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--nx-ink-3)]"' },
    @{ Name = 'Campo de credenciais'; Count = 1; Before = 'className="h-9 w-full rounded-[10px] border border-white/10 bg-[#24243a] pl-9 pr-3 font-mono text-[12px] tracking-wide text-white/70 outline-none"'; After = 'className="h-9 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] pl-9 pr-3 font-mono text-[12px] tracking-wide text-[var(--nx-ink-2)] outline-none"' },
    @{ Name = 'Aviso do certificado'; Count = 1; Before = 'className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/10 bg-[#24243a] px-3 text-[12px] text-white/60"'; After = 'className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[12px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Ícone do certificado'; Count = 1; Before = 'className="h-3.5 w-3.5 text-white/40"'; After = 'className="h-3.5 w-3.5 text-[var(--nx-ink-3)]"' },
    @{ Name = 'Informações laterais da integração'; Count = 1; Before = 'className="flex items-center gap-3 text-[11.5px] text-white/40"'; After = 'className="flex items-center gap-3 text-[11.5px] text-[var(--nx-ink-3)]"' },
    @{ Name = 'Botão Atualizar status'; Count = 1; Before = 'className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 text-[12px] text-white/70 transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"'; After = 'className="flex h-9 items-center gap-2 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-4 text-[12px] text-[var(--nx-ink-2)] transition-colors hover:bg-[var(--nx-surface-3)] disabled:cursor-wait disabled:opacity-50"' },
    @{ Name = 'Botão de integração indisponível conectado'; Count = 1; Before = "? 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/10'"; After = "? 'border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] hover:bg-[var(--nx-surface-3)]'" },
    @{ Name = 'Botão de integração indisponível desconectado'; Count = 1; Before = ": 'bg-white text-black hover:bg-white/90'"; After = ": 'border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] hover:bg-[var(--nx-surface-3)]'" },

    @{ Name = 'Aba ativa'; Count = 1; Before = "? 'bg-white text-black'"; After = "? 'bg-[var(--nx-accent)] text-[var(--nx-ink)]'" },
    @{ Name = 'Aba inativa'; Count = 1; Before = ": 'border border-white/10 bg-[#1c1c2e] text-white/60 hover:text-white/80'"; After = ": 'border border-[var(--nx-border)] bg-[var(--nx-surface-2)] text-[var(--nx-ink-2)] hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]'" },
    @{ Name = 'Contador da aba ativa'; Count = 1; Before = "? 'bg-black/10 text-black'"; After = "? 'bg-[color-mix(in_srgb,var(--nx-accent)_20%,transparent)] text-[var(--nx-ink)]'" },
    @{ Name = 'Contador da aba inativa'; Count = 1; Before = ": 'bg-white/[0.06] text-white/50'"; After = ": 'bg-[var(--nx-surface-3)] text-[var(--nx-ink-3)]'" },

    @{ Name = 'Card principal de documentos'; Count = 1; Before = 'className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#1c1c2e] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"'; After = 'className="overflow-hidden rounded-[24px] border border-[var(--nx-border)] bg-[var(--nx-surface)] shadow-[var(--nx-shadow-pop)]"' },
    @{ Name = 'Barra de ferramentas dos documentos'; Count = 1; Before = 'className="flex min-h-14 flex-col gap-3 border-b border-white/[0.06] bg-[#1c1c2e]/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"'; After = 'className="flex min-h-14 flex-col gap-3 border-b border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"' },
    @{ Name = 'Campo de pesquisa'; Count = 1; Before = 'className="h-9 w-full rounded-full border border-white/10 bg-[#24243a] pl-9 pr-3 text-[12px] text-white outline-none transition-colors placeholder:text-white/35 focus:border-[#7c5cfc]/60"'; After = 'className="h-9 w-full rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface)] pl-9 pr-3 text-[12px] text-[var(--nx-ink)] outline-none transition-colors placeholder:text-[var(--nx-ink-3)] focus:border-[var(--nx-accent)]"' },
    @{ Name = 'Botão Limpar filtros'; Count = 1; Before = 'className="h-8 shrink-0 rounded-full px-3 text-[12px] font-medium text-white/50 transition-all hover:bg-white/[0.06] hover:text-white"'; After = 'className="h-8 shrink-0 rounded-full px-3 text-[12px] font-medium text-[var(--nx-ink-3)] transition-all hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)]"' },
    @{ Name = 'Badge de documentos selecionados'; Count = 1; Before = 'className="rounded-full border border-[#7c5cfc]/30 bg-[#7c5cfc]/10 px-2.5 py-1 text-[11px] font-medium text-[#a78bfa]"'; After = 'className="rounded-full border border-[color-mix(in_srgb,var(--nx-accent)_25%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--nx-accent-ink)]"' },
    @{ Name = 'Botão Baixar XML'; Count = 1; Before = 'className="flex h-8 items-center gap-1.5 rounded-full bg-[#7c5cfc]/15 px-3 text-[12px] font-medium text-[#7c5cfc] transition-all hover:bg-[#7c5cfc]/25"'; After = 'className="flex h-8 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] px-3 text-[12px] font-medium text-[var(--nx-accent-ink)] transition-all hover:bg-[color-mix(in_srgb,var(--nx-accent)_25%,transparent)]"' },
    @{ Name = 'Botão Gerar relatório'; Count = 1; Before = 'className="flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white/70 transition-all hover:bg-white/10"'; After = 'className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[12px] font-medium text-[var(--nx-ink-2)] transition-all hover:bg-[var(--nx-surface-3)]"' },
    @{ Name = 'Botão Limpar filtros do estado vazio'; Count = 1; Before = 'className="flex h-9 items-center gap-2 rounded-full bg-white px-5 text-[12px] font-semibold text-black transition-all hover:bg-white/90"'; After = 'className="flex h-9 items-center gap-2 rounded-full bg-[var(--nx-accent)] px-5 text-[12px] font-semibold text-[var(--nx-ink)] transition-all hover:brightness-105"' },

    @{ Name = 'Painel de conformidade'; Count = 1; Before = 'className="mt-6 flex gap-3 rounded-[16px] border border-white/[0.06] bg-[#0f0f1a] px-5 py-4"'; After = 'className="mt-6 flex gap-3 rounded-[16px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-5 py-4"' },
    @{ Name = 'Ícone do painel de conformidade'; Count = 1; Before = 'className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[#7c5cfc]/20 bg-[#7c5cfc]/10 text-[#7c5cfc]"'; After = 'className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[color-mix(in_srgb,var(--nx-accent)_20%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] text-[var(--nx-accent-ink)]"' },
    @{ Name = 'Texto do painel de conformidade'; Count = 1; Before = 'className="text-[11.5px] leading-relaxed text-white/40"'; After = 'className="text-[11.5px] leading-relaxed text-[var(--nx-ink-2)]"' },
    @{ Name = 'Título do painel de conformidade'; Count = 1; Before = '<strong className="text-white/60">Fiscal Brasil</strong>'; After = '<strong className="text-[var(--nx-ink)]">Fiscal Brasil</strong>' },
    @{ Name = 'Toast'; Count = 1; Before = 'className="fiscal-toast fixed bottom-6 right-6 z-[60] flex h-11 max-w-[calc(100vw-48px)] items-center gap-2 rounded-full bg-white px-4 text-[12px] font-medium text-black shadow-[0_12px_40px_rgba(0,0,0,0.4)]"'; After = 'className="fiscal-toast fixed bottom-6 right-6 z-[60] flex h-11 max-w-[calc(100vw-48px)] items-center gap-2 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface)] px-4 text-[12px] font-medium text-[var(--nx-ink)] shadow-[var(--nx-shadow-pop)]"' },
    @{ Name = 'Indicador do toast'; Count = 1; Before = 'className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#7c5cfc]"'; After = 'className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--nx-accent)]"' },

    @{ Name = 'Texto dos cabeçalhos da tabela'; Count = 1; Before = "const CABECALHO_CLASS = 'px-5 py-3 text-left text-[11px] uppercase tracking-[0.14em] text-white/40';"; After = "const CABECALHO_CLASS = 'px-5 py-3 text-left text-[11px] uppercase tracking-[0.14em] text-[var(--nx-ink-3)]';" },
    @{ Name = 'Identificadores dos documentos'; Count = 3; Before = 'className="font-mono text-[12.5px] tracking-wide text-white"'; After = 'className="font-mono text-[12.5px] tracking-wide text-[var(--nx-ink)]"' },
    @{ Name = 'Subtítulos dos identificadores'; Count = 3; Before = 'className="text-[11px] text-white/40"'; After = 'className="text-[11px] text-[var(--nx-ink-3)]"' },
    @{ Name = 'Bordas dos cabeçalhos das tabelas'; Count = 2; Before = '<thead className="border-b border-white/[0.06]">'; After = '<thead className="border-b border-[var(--nx-border)]">' },
    @{ Name = 'Divisórias dos corpos das tabelas'; Count = 2; Before = '<tbody className="divide-y divide-white/[0.04]">'; After = '<tbody className="divide-y divide-[var(--nx-border)]">' },
    @{ Name = 'Realce das linhas das tabelas'; Count = 2; Before = 'className="cursor-pointer transition-colors hover:bg-white/[0.02]"'; After = 'className="cursor-pointer transition-colors hover:bg-[var(--nx-surface-2)]"' },
    @{ Name = 'Nome do cliente'; Count = 1; Before = 'className="max-w-[220px] truncate text-[12.5px] text-white/85"'; After = 'className="max-w-[220px] truncate text-[12.5px] text-[var(--nx-ink)]"' },
    @{ Name = 'Documento do cliente'; Count = 1; Before = 'className="font-mono text-[11px] text-white/40"'; After = 'className="font-mono text-[11px] text-[var(--nx-ink-3)]"' },
    @{ Name = 'Datas e períodos da tabela'; Count = 3; Before = 'className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/70"'; After = 'className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Tipos e origens da tabela'; Count = 3; Before = 'className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-white/60"'; After = 'className="whitespace-nowrap px-5 py-4 align-middle text-[12.5px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Valor do documento na tabela'; Count = 1; Before = 'className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] font-semibold text-white"'; After = 'className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] font-semibold text-[var(--nx-ink)]"' },
    @{ Name = 'Ícone do relatório'; Count = 1; Before = 'className="h-3.5 w-3.5 shrink-0 text-[#7c5cfc]"'; After = 'className="h-3.5 w-3.5 shrink-0 text-[var(--nx-accent)]"' },
    @{ Name = 'Nome do relatório'; Count = 1; Before = 'className="text-[12.5px] text-white/85"'; After = 'className="text-[12.5px] text-[var(--nx-ink)]"' },
    @{ Name = 'Formato do relatório'; Count = 1; Before = 'className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70"'; After = 'className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-2.5 py-1 text-[11px] text-[var(--nx-ink-2)]"' },
    @{ Name = 'Tamanho do relatório'; Count = 1; Before = 'className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] text-white/60"'; After = 'className="whitespace-nowrap px-5 py-4 text-right align-middle text-[12.5px] text-[var(--nx-ink-2)]"' }
)

# Pré-validação completa: apresenta todos os desvios de uma vez e não grava nada.
$problemas = @()
foreach ($change in $changes) {
    $found = [regex]::Matches($content, [regex]::Escape($change.Before)).Count
    if ($found -ne $change.Count) {
        $problemas += "- $($change.Name): esperado $($change.Count), encontrado $found"
    }
}

if ($problemas.Count -gt 0) {
    Write-Host "Pré-validação interrompida. Nenhuma alteração foi feita:" -ForegroundColor Red
    $problemas | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    throw 'O arquivo atual difere dos trechos revisados. Envie os desvios antes de aplicar qualquer alteração.'
}

# Aplicar em memória e conferir que todos os trechos antigos foram removidos.
$newContent = $content
foreach ($change in $changes) {
    $newContent = $newContent.Replace($change.Before, $change.After)
}

foreach ($change in $changes) {
    if ($newContent.Contains($change.Before)) {
        throw "Preparação interrompida: sobrou o trecho antigo de '$($change.Name)'. Nenhuma gravação realizada."
    }
}

# Os textos brancos fixos devem desaparecer da interface; os documentos em papel
# continuam com fundo branco e texto preto e não são modificados por este script.
if ($newContent.Contains('text-white')) {
    throw 'Ainda há classes text-white fora do conjunto revisado. Nenhuma gravação realizada.'
}
foreach ($fixedBackground in @('bg-[#1c1c2e]', 'bg-[#24243a]', 'bg-[#0f0f1a]')) {
    if ($newContent.Contains($fixedBackground)) {
        throw "Ainda há fundo fixo '$fixedBackground'. Nenhuma gravação realizada."
    }
}

if ($newContent -eq $content) {
    throw 'Nenhuma alteração foi preparada. Arquivo preservado.'
}

# Confirmar que ninguém alterou o arquivo desde a leitura inicial.
$currentHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
if ($currentHash -ne $initialHash) {
    throw 'O arquivo mudou durante a preparação. Nenhuma gravação realizada.'
}

# Backup integral, criado somente após todas as verificações.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupFolder = Join-Path (Get-Location) "backup-fiscal-tema-$stamp"
New-Item -ItemType Directory -Path $backupFolder | Out-Null
$backupPath = Join-Path $backupFolder 'page.tsx'
Copy-Item -LiteralPath $filePath -Destination $backupPath

try {
    [System.IO.File]::WriteAllText($filePath, $newContent, $utf8)
    $writtenContent = [System.IO.File]::ReadAllText($filePath)

    foreach ($change in $changes) {
        if ($writtenContent.Contains($change.Before)) {
            throw "Verificação pós-gravação falhou em '$($change.Name)'."
        }
        if (-not $writtenContent.Contains($change.After)) {
            throw "Trecho novo não encontrado após a gravação: '$($change.Name)'."
        }
    }

    if ($writtenContent.Contains('text-white') -or
        $writtenContent.Contains('bg-[#1c1c2e]') -or
        $writtenContent.Contains('bg-[#24243a]') -or
        $writtenContent.Contains('bg-[#0f0f1a]')) {
        throw 'A verificação final encontrou cores fixas que deveriam ter sido removidas.'
    }
}
catch {
    Copy-Item -LiteralPath $backupPath -Destination $filePath -Force
    throw "A gravação foi revertida pelo backup. Motivo: $($_.Exception.Message)"
}

Write-Host "`nPADRONIZAÇÃO VISUAL APLICADA E VERIFICADA." -ForegroundColor Green
Write-Host "Substituições revisadas: $($changes.Count)" -ForegroundColor Cyan
Write-Host "Backup: $backupPath" -ForegroundColor Cyan

if (Get-Command git -ErrorAction SilentlyContinue) {
    git diff --check -- $relativePath
    if ($LASTEXITCODE -ne 0) {
        Copy-Item -LiteralPath $backupPath -Destination $filePath -Force
        throw 'git diff --check encontrou problemas; arquivo restaurado pelo backup.'
    }
}

Write-Host 'Concluído. Regras de negócio e documentos oficiais de impressão foram preservados.' -ForegroundColor Green
