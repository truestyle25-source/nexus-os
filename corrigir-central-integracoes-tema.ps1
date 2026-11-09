$ErrorActionPreference = 'Stop'

# Central de Integracoes - padronizacao visual com tokens globais NEXUS OS.
# Escopo: somente frontend/app/(dashboard)/central-integracoes/page.tsx.
# APIs, credenciais, payloads, estados e regras de negocio nao sao editados.

$relativePath = '.\frontend\app\(dashboard)\central-integracoes\page.tsx'
if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
    throw 'Arquivo da Central de Integracoes nao encontrado na raiz do repositorio.'
}
$file = (Resolve-Path -LiteralPath $relativePath).Path
$originalBytes = [System.IO.File]::ReadAllBytes($file)
$originalHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
$content = [System.IO.File]::ReadAllText($file)

# Confirma que estamos na pagina enviada, nao em Configuracoes ou outra tela.
$anchors = @(
    @{ Name = 'Rota da Central'; Text = 'rota /central-integracoes' },
    @{ Name = 'Catalogo de vendors'; Text = 'const VENDORS: Vendor[] = [' },
    @{ Name = 'Catalogo de escopos'; Text = 'const ESCOPOS: Escopo[] = [' },
    @{ Name = 'Modal Mercado Livre'; Text = 'MercadoLivreDadosModal' },
    @{ Name = 'Card KPI'; Text = 'function KpiCard({' },
    @{ Name = 'Endpoint de integracoes'; Text = "api.get('/integracoes')" },
    @{ Name = 'Endpoint de chaves publicas'; Text = "api.get('/api-publica/chaves')" }
)
foreach ($anchor in $anchors) {
    $count = [regex]::Matches($content, [regex]::Escape($anchor.Text)).Count
    if ($count -lt 1) {
        throw "Pre-validacao interrompida: nao encontrei o marcador '$($anchor.Name)'. Nenhuma gravacao realizada."
    }
}

# Regras literais, revistas para os elementos que existem nesta pagina.
# Minimum=1 significa que o trecho precisa existir; a contagem real e registrada.
$rules = @(
    # Tons translucidos e classes especiais precisam vir antes dos tokens hexadecimais.
    @{ Name='Fundo do filtro sticky'; Before='bg-[#0F0F14]/90'; After='bg-[color-mix(in_srgb,var(--nx-canvas)_90%,transparent)]'; Minimum=1 },
    @{ Name='Fundo de evento translucido'; Before='bg-[#12121A]/60'; After='bg-[color-mix(in_srgb,var(--nx-surface-2)_60%,transparent)]'; Minimum=1 },
    @{ Name='Sombra do modal de chave'; Before='shadow-[0_20px_80px_rgba(0,0,0,0.6)]'; After='shadow-[var(--nx-shadow-pop)]'; Minimum=1 },
    @{ Name='Sombra do toast'; Before='shadow-[0_8px_30px_rgba(0,0,0,0.5)]'; After='shadow-[var(--nx-shadow-pop)]'; Minimum=1 },
    @{ Name='Divisoria de tabela translucida'; Before='border-[#2A2A35]/60'; After='border-[color-mix(in_srgb,var(--nx-border)_60%,transparent)]'; Minimum=1 },
    @{ Name='Fundo de badge de escopo'; Before='bg-[#2A2A35]'; After='bg-[var(--nx-surface-3)]'; Minimum=1 },
    @{ Name='Texto de indisponibilidade'; Before='text-[#2A2A35]'; After='text-[var(--nx-ink-3)]'; Minimum=1 },
    @{ Name='Fundo de escopo selecionado'; Before='bg-[#7C3AED]/10'; After='bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)]'; Minimum=1 },
    @{ Name='Borda de escopo selecionado'; Before='border-[#7C3AED]/30'; After='border-[color-mix(in_srgb,var(--nx-accent)_30%,var(--nx-border))]'; Minimum=1 },
    @{ Name='Fundo de escopo de leitura'; Before='bg-[#7C3AED]/15'; After='bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)]'; Minimum=1 },

    # Estados semanticos: sucesso, atencao e erro continuam semanticamente distintos.
    @{ Name='Fundo sucesso suave'; Before='bg-emerald-500/10'; After='bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)]'; Minimum=1 },
    @{ Name='Borda sucesso suave'; Before='border-emerald-500/20'; After='border-[color-mix(in_srgb,var(--nx-green)_20%,var(--nx-border))]'; Minimum=1 },
    @{ Name='Fundo alerta suave'; Before='bg-amber-500/10'; After='bg-[color-mix(in_srgb,var(--nx-amber)_10%,transparent)]'; Minimum=1 },
    @{ Name='Borda alerta suave'; Before='border-amber-500/20'; After='border-[color-mix(in_srgb,var(--nx-amber)_20%,var(--nx-border))]'; Minimum=1 },
    @{ Name='Fundo erro suave'; Before='bg-red-500/10'; After='bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)]'; Minimum=1 },
    @{ Name='Borda erro suave'; Before='border-red-500/30'; After='border-[color-mix(in_srgb,var(--nx-red)_30%,var(--nx-border))]'; Minimum=1 },
    @{ Name='Hover de borda de erro'; Before='hover:border-red-500/40'; After='hover:border-[color-mix(in_srgb,var(--nx-red)_40%,var(--nx-border))]'; Minimum=1 },
    @{ Name='Hover de texto de erro'; Before='hover:text-red-300'; After='hover:text-[var(--nx-red)]'; Minimum=1 },
    @{ Name='Texto de erro'; Before='text-red-300'; After='text-[var(--nx-red)]'; Minimum=1 },
    @{ Name='Texto de sucesso claro'; Before='text-emerald-300'; After='text-[var(--nx-green)]'; Minimum=1 },
    @{ Name='Texto de sucesso forte'; Before='text-emerald-400'; After='text-[var(--nx-green)]'; Minimum=1 },
    @{ Name='Ponto de sucesso claro'; Before='bg-emerald-400'; After='bg-[var(--nx-green)]'; Minimum=1 },
    @{ Name='Ponto de sucesso'; Before='bg-emerald-500'; After='bg-[var(--nx-green)]'; Minimum=1 },
    @{ Name='Ponto de alerta'; Before='bg-amber-500'; After='bg-[var(--nx-amber)]'; Minimum=1 },
    @{ Name='Texto de alerta 200 70'; Before='text-amber-200/70'; After='text-[var(--nx-amber)]'; Minimum=1 },
    @{ Name='Texto de alerta 200 80'; Before='text-amber-200/80'; After='text-[var(--nx-amber)]'; Minimum=1 },
    @{ Name='Texto de alerta 300 70'; Before='text-amber-300/70'; After='text-[var(--nx-amber)]'; Minimum=1 },
    @{ Name='Texto de alerta 300'; Before='text-amber-300'; After='text-[var(--nx-amber)]'; Minimum=1 },
    @{ Name='Texto de alerta 400'; Before='text-amber-400'; After='text-[var(--nx-amber)]'; Minimum=1 },

    # Neutros do Tailwind para os tokens semanticos do Layout Mestre.
    @{ Name='Texto zinc 100'; Before='text-zinc-100'; After='text-[var(--nx-ink)]'; Minimum=1 },
    @{ Name='Texto zinc 200'; Before='text-zinc-200'; After='text-[var(--nx-ink)]'; Minimum=1 },
    @{ Name='Texto zinc 300'; Before='text-zinc-300'; After='text-[var(--nx-ink-2)]'; Minimum=1 },
    @{ Name='Texto zinc 400'; Before='text-zinc-400'; After='text-[var(--nx-ink-2)]'; Minimum=1 },
    @{ Name='Texto zinc 500'; Before='text-zinc-500'; After='text-[var(--nx-ink-3)]'; Minimum=1 },
    @{ Name='Texto zinc 600'; Before='text-zinc-600'; After='text-[var(--nx-ink-3)]'; Minimum=1 },
    @{ Name='Placeholder zinc'; Before='placeholder-zinc-500'; After='placeholder:text-[var(--nx-ink-3)]'; Minimum=1 },
    @{ Name='Fundo zinc 800'; Before='bg-zinc-800'; After='bg-[var(--nx-surface-3)]'; Minimum=1 },
    @{ Name='Borda zinc 700'; Before='border-zinc-700'; After='border-[var(--nx-border)]'; Minimum=1 },
    @{ Name='Ponto zinc 600'; Before='bg-zinc-600'; After='bg-[var(--nx-ink-3)]'; Minimum=1 },

    # Superficies e bordas fixas encontradas na pagina.
    @{ Name='Fundo canvas'; Before='#0F0F14'; After='var(--nx-canvas)'; Minimum=1 },
    @{ Name='Fundo surface'; Before='#1A1A23'; After='var(--nx-surface)'; Minimum=1 },
    @{ Name='Fundo surface 2'; Before='#12121A'; After='var(--nx-surface-2)'; Minimum=1 },
    @{ Name='Borda neutra'; Before='#2A2A35'; After='var(--nx-border)'; Minimum=1 },
    @{ Name='Borda forte'; Before='#3A3A4A'; After='var(--nx-border-strong)'; Minimum=1 },
    @{ Name='Borda canvas'; Before='#1E1E28'; After='var(--nx-border)'; Minimum=1 },

    # Acento da marca e tons usados nos botoes, icones e KPIs.
    @{ Name='Acento principal'; Before='#7C3AED'; After='var(--nx-accent)'; Minimum=1 },
    @{ Name='Acento secundario'; Before='#6B4FE0'; After='var(--nx-accent-2)'; Minimum=1 },
    @{ Name='Acento claro'; Before='#A78BFA'; After='var(--nx-accent-2)'; Minimum=1 },
    @{ Name='Verde KPI inline'; Before='#10b981'; After='var(--nx-green)'; Minimum=1 },
    @{ Name='Ambar KPI inline'; Before='#f59e0b'; After='var(--nx-amber)'; Minimum=1 },
    @{ Name='Neutro KPI inline'; Before='#71717a'; After='var(--nx-ink-3)'; Minimum=1 },

    # Branco/preto usados em superficies, texto e botoes passam a acompanhar o tema.
    @{ Name='Fundo branco de destaque'; Before='bg-white'; After='bg-[var(--nx-accent)]'; Minimum=1 },
    @{ Name='Borda branca de destaque'; Before='border-white'; After='border-[var(--nx-accent)]'; Minimum=1 },
    @{ Name='Texto branco fixo'; Before='text-white'; After='text-[var(--nx-ink)]'; Minimum=1 },
    @{ Name='Texto preto fixo'; Before='text-black'; After='text-[var(--nx-ink)]'; Minimum=1 },

    # Estilos inline dos logotipos e botoes de destaque.
    @{ Name='Fundo inline branco'; Before='background: "white"'; After='background: "var(--nx-accent)"'; Minimum=1 },
    @{ Name='Texto inline preto'; Before='color: "black"'; After='color: "var(--nx-ink)"'; Minimum=1 }
)

# Pre-validacao integral antes de qualquer substituicao.
$divergencias = New-Object System.Collections.Generic.List[string]
$contagens = New-Object System.Collections.Generic.List[object]
foreach ($rule in $rules) {
    $found = [regex]::Matches($content, [regex]::Escape($rule.Before)).Count
    $contagens.Add([pscustomobject]@{ Nome = $rule.Name; Ocorrencias = $found })
    if ($found -lt $rule.Minimum) {
        $divergencias.Add("$($rule.Name): minimo $($rule.Minimum), encontrado $found")
    }
}
if ($divergencias.Count -gt 0) {
    Write-Host 'PRE-VALIDACAO INTERROMPIDA. NENHUMA ALTERACAO FOI FEITA.' -ForegroundColor Red
    $divergencias | ForEach-Object { Write-Host "- $_" -ForegroundColor Yellow }
    throw 'Revise os trechos divergentes antes de gravar.'
}

# Aplicar somente na copia em memoria.
$newContent = $content
foreach ($rule in $rules) {
    $newContent = $newContent.Replace($rule.Before, $rule.After)
}
if ($newContent -eq $content) { throw 'Nenhuma alteracao foi produzida.' }

# Auditoria de restos: a lista cobre as cores fixas identificadas na revisao dupla.
$forbidden = @(
    '#0F0F14', '#1A1A23', '#12121A', '#2A2A35', '#3A3A4A', '#1E1E28',
    '#7C3AED', '#6B4FE0', '#A78BFA', '#10b981', '#f59e0b', '#71717a',
    'text-zinc-100', 'text-zinc-200', 'text-zinc-300', 'text-zinc-400', 'text-zinc-500', 'text-zinc-600',
    'placeholder-zinc-500', 'bg-zinc-800', 'border-zinc-700', 'bg-zinc-600',
    'bg-emerald-500', 'bg-emerald-400', 'text-emerald-300', 'text-emerald-400',
    'bg-amber-500', 'text-amber-200', 'text-amber-300', 'text-amber-400',
    'bg-red-500', 'text-red-300', 'border-red-500', 'bg-white', 'text-white', 'text-black'
)
$restos = New-Object System.Collections.Generic.List[string]
foreach ($token in $forbidden) {
    if ($newContent.Contains($token)) { $restos.Add($token) }
}
if ($restos.Count -gt 0) {
    Write-Host 'AUDITORIA INTERROMPIDA. CORES FIXAS AINDA PRESENTES:' -ForegroundColor Red
    $restos | ForEach-Object { Write-Host "- $_" -ForegroundColor Yellow }
    throw 'Nenhuma gravacao realizada: a auditoria encontrou cores fixas restantes.'
}

# Garantir que a estrutura e os pontos de negocio continuam presentes.
$postAnchors = @(
    "api.get('/integracoes')",
    "api.get('/api-publica/chaves')",
    "'/integracoes/mercadolivre/conectar'",
    "'/integracoes/shopee/conectar'",
    "api.post('/api-publica/chaves'",
    'api.post(`/api-publica/chaves/${id}/revogar`',
    'MercadoLivreDadosModal onClose=',
    'const ESCOPOS_ACEITOS = ESCOPOS.filter((e) => e.modo === ''leitura'').map((e) => e.id);'
)
foreach ($anchor in $postAnchors) {
    if (-not $newContent.Contains($anchor)) {
        throw "Auditoria estrutural interrompida: marcador de funcionalidade ausente: $anchor"
    }
}

# Preservar BOM e formato de quebra de linha; o Replace nao muda CRLF/LF.
$hasBom = (
    $originalBytes.Length -ge 3 -and
    $originalBytes[0] -eq 0xEF -and
    $originalBytes[1] -eq 0xBB -and
    $originalBytes[2] -eq 0xBF
)
$encoding = [System.Text.UTF8Encoding]::new($hasBom)

# Verificar se ninguem alterou o arquivo durante a preparacao.
$currentHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
if ($currentHash -ne $originalHash) {
    throw 'O arquivo mudou durante a revisao. Nenhuma gravacao realizada.'
}

# Backup somente depois de TODAS as pre-validacoes e auditorias em memoria.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupDir = Join-Path (Get-Location) "backup-central-integracoes-tema-$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
$backup = Join-Path $backupDir 'page.tsx'
Copy-Item -LiteralPath $file -Destination $backup

try {
    [System.IO.File]::WriteAllText($file, $newContent, $encoding)
    $written = [System.IO.File]::ReadAllText($file)

    foreach ($rule in $rules) {
        if (-not $written.Contains($rule.After)) {
            throw "Verificacao pos-gravacao falhou: $($rule.Name)."
        }
        if ($written.Contains($rule.Before)) {
            throw "Trecho antigo ainda presente apos gravacao: $($rule.Name)."
        }
    }
    foreach ($anchor in $postAnchors) {
        if (-not $written.Contains($anchor)) {
            throw "Verificacao funcional pos-gravacao falhou: $anchor"
        }
    }
    foreach ($token in $forbidden) {
        if ($written.Contains($token)) {
            throw "Cor fixa restante apos gravacao: $token"
        }
    }
}
catch {
    Copy-Item -LiteralPath $backup -Destination $file -Force
    throw "Falha pos-gravacao. Arquivo restaurado pelo backup. Detalhe: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'PADRONIZACAO VISUAL DA CENTRAL DE INTEGRACOES APLICADA E VERIFICADA.' -ForegroundColor Green
Write-Host "Regras revisadas: $($rules.Count)" -ForegroundColor Cyan
Write-Host "Ocorrencias substituidas: $(($contagens | Measure-Object -Property Ocorrencias -Sum).Sum)" -ForegroundColor Cyan
Write-Host "Backup: $backup" -ForegroundColor Cyan
Write-Host 'APIs, endpoints, credenciais, estados e regras de negocio foram preservados.' -ForegroundColor Green

Write-Host ''
Write-Host 'Validacao Git:' -ForegroundColor Yellow
git diff --check -- $relativePath
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $backup -Destination $file -Force
    throw 'Git diff --check encontrou problema. Arquivo restaurado pelo backup.'
}
