$ErrorActionPreference = 'Stop'

$relativePath = '.\frontend\app\(dashboard)\ia\page.tsx'
$resolved = Resolve-Path -LiteralPath $relativePath -ErrorAction Stop
$filePath = $resolved.Path

# A versão foi conferida no diagnóstico do usuário. Se o arquivo mudou,
# interrompe antes de preparar ou gravar qualquer alteração.
$expectedHash = 'A09A1EA4671BBD0A69797C0D0FBBBCCBD19BA8C610E26B5CE93E2843ECB531DA'
$initialHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
if ($initialHash -ne $expectedHash) {
    throw "A página IA NEXUS mudou desde a revisão. SHA256 atual: $initialHash. Nenhuma alteração realizada."
}

$bytes = [System.IO.File]::ReadAllBytes($filePath)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$utf8 = [System.Text.UTF8Encoding]::new([bool]$hasBom)
$content = [System.IO.File]::ReadAllText($filePath)
$newline = if ($content.Contains("`r`n")) { "`r`n" } else { "`n" }

function Get-OrdinalCount {
    param([string]$Text, [string]$Value)
    $count = 0
    $offset = 0
    while ($true) {
        $found = $Text.IndexOf($Value, $offset, [System.StringComparison]::Ordinal)
        if ($found -lt 0) { break }
        $count = $count + 1
        $offset = $found + $Value.Length
    }
    return $count
}

# Substitui somente o conteúdo do bloco <style> desta página.
$styleStartMarker = '<style>{`'
$styleEndMarker = '`}</style>'
$styleStartCount = Get-OrdinalCount $content $styleStartMarker
$styleEndCount = Get-OrdinalCount $content $styleEndMarker
if ($styleStartCount -ne 1 -or $styleEndCount -ne 1) {
    throw "Estrutura do CSS local inesperada (início=$styleStartCount, fim=$styleEndCount). Nenhuma alteração realizada."
}
$styleStart = $content.IndexOf($styleStartMarker, [System.StringComparison]::Ordinal) + $styleStartMarker.Length
$styleEnd = $content.IndexOf($styleEndMarker, $styleStart, [System.StringComparison]::Ordinal)
if ($styleEnd -le $styleStart) {
    throw 'Não foi possível delimitar o CSS local. Nenhuma alteração realizada.'
}
$oldCss = $content.Substring($styleStart, $styleEnd - $styleStart)
if (-not $oldCss.Contains('.nexus-root{height:100dvh') -or -not $oldCss.Contains('.voice-mode-overlay')) {
    throw 'O CSS encontrado não corresponde à estrutura revisada da IA NEXUS. Nenhuma alteração realizada.'
}

$newCss = @'
        .nexus-root{height:100dvh;width:100%;background:var(--nx-canvas);color:var(--nx-ink);display:flex;font-family:Inter,system-ui;overflow:hidden;position:relative}
        .nexus-bg{position:fixed;inset:0;pointer-events:none;overflow:hidden}
        .nexus-bg-a{position:absolute;top:-128px;left:50%;transform:translateX(-50%);width:900px;height:600px;background:color-mix(in srgb,var(--nx-accent) 12%,transparent);filter:blur(140px);border-radius:999px}
        .nexus-bg-b{position:absolute;bottom:-128px;left:-128px;width:600px;height:600px;background:color-mix(in srgb,var(--nx-accent-2) 10%,transparent);filter:blur(140px);border-radius:999px}
        .sidebar{width:300px;min-width:300px;background:var(--nx-surface);color:var(--nx-ink);border-right:1px solid var(--nx-border);display:flex;flex-direction:column;transition:transform .3s;z-index:20}
        .sidebar.closed{transform:translateX(-100%);position:absolute;left:0;top:0;bottom:0}
        .sidebar-header{padding:20px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between}
        .pill{border-radius:999px;border:1px solid var(--nx-border);background:var(--nx-surface-2);color:var(--nx-ink-2);padding:8px 16px;font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .2s}
        .pill:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.02)}
        .pill:active{transform:scale(0.98)}
        .nav-btn{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--nx-ink-2);font-size:13px;cursor:pointer;text-align:left;transition:all .2s}
        .nav-btn:hover{background:var(--nx-surface-2);color:var(--nx-ink)}
        .nav-btn.active{background:var(--nx-accent);color:var(--nx-ink);font-weight:600}
        .main{flex:1;display:flex;flex-direction:column;position:relative;min-width:0;overflow:hidden;background:transparent}
        .header{height:56px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:color-mix(in srgb,var(--nx-surface) 90%,transparent);backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}
        .icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--nx-border);background:var(--nx-surface-2);display:grid;place-items:center;cursor:pointer;transition:all .2s;color:var(--nx-ink-2)}
        .icon-btn:hover{background:var(--nx-surface-3);transform:scale(1.05);color:var(--nx-ink)}
        .icon-btn:active{transform:scale(0.95)}
        .chat-area{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:0 16px}
        .chat-inner{max-width:760px;margin:0 auto;padding:32px 0}
        .bubble-user{max-width:80%;margin-left:auto;background:var(--nx-accent);color:var(--nx-ink);border-radius:24px;border-bottom-right-radius:8px;padding:14px 18px;font-size:14px;line-height:1.5;animation:pop .2s ease;box-shadow:0 4px 14px color-mix(in srgb,var(--nx-accent) 24%,transparent)}
        .bubble-ai{max-width:80%;background:var(--nx-surface-2);border:1px solid var(--nx-border);border-radius:24px;border-bottom-left-radius:8px;padding:16px 18px;font-size:14px;line-height:1.6;color:var(--nx-ink);animation:pop .2s ease;white-space:pre-wrap}
        .bubble-ai.erro{background:color-mix(in srgb,var(--nx-red) 12%,var(--nx-surface));border-color:color-mix(in srgb,var(--nx-red) 30%,var(--nx-border));color:var(--nx-red)}
        @keyframes pop{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
        .input-wrap{position:relative;flex-shrink:0;left:0;right:0;padding:16px;background:linear-gradient(to top,var(--nx-canvas) 50%,color-mix(in srgb,var(--nx-canvas) 90%,transparent),transparent)}
        .input-pill{max-width:760px;margin:0 auto;height:62px;border-radius:28px;background:var(--nx-surface);border:1px solid var(--nx-border);display:flex;align-items:center;gap:10px;padding:0 10px;box-shadow:var(--nx-shadow-pop)}
        .input-pill:focus-within{border-color:var(--nx-accent)}
        .circle-btn{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .2s;border:none}
        .circle-btn:hover{transform:scale(1.06)}
        .circle-btn:active{transform:scale(0.92)}
        .circle-plus{background:var(--nx-surface-2);color:var(--nx-ink-2)}
        .circle-plus:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
        .circle-mic{background:var(--nx-surface-2);color:var(--nx-ink-2)}
        .circle-mic:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
        .circle-mic.rec{background:color-mix(in srgb,var(--nx-red) 18%,transparent);color:var(--nx-red);box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent);animation:pulse 1.2s infinite}
        @keyframes pulse{0%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--nx-red) 10%,transparent)}100%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}}
        .circle-send{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 30%,transparent)}
        .circle-waves{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 30%,transparent);position:relative}
        .circle-waves:hover{background:var(--nx-accent-2);box-shadow:0 8px 24px color-mix(in srgb,var(--nx-accent-2) 38%,transparent)}
        .chat-input{flex:1;background:transparent;border:none;outline:none;color:var(--nx-ink);font-size:15px;min-width:0}
        .chat-input::placeholder{color:var(--nx-ink-3)}

        /* Modo Voz: mesma hierarquia visual nos temas claro e escuro. */
        .voice-mode-overlay{position:absolute;inset:0;background:radial-gradient(circle at center,var(--nx-surface-2) 0%,var(--nx-surface) 55%,var(--nx-canvas) 100%);z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 20px 40px;animation:fadeIn .3s ease}
        @keyframes fadeIn{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}
        .voice-topbar{width:100%;max-width:800px;display:flex;align-items:center;justify-content:space-between}
        .voice-badge{display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:13px;font-weight:500;color:var(--nx-ink-2)}
        .voice-dot{width:8px;height:8px;border-radius:999px;background:var(--nx-accent-2);box-shadow:0 0 10px color-mix(in srgb,var(--nx-accent-2) 55%,transparent);animation:blink 1.5s infinite}
        .voice-dot.speaking{background:var(--nx-accent);box-shadow:0 0 12px color-mix(in srgb,var(--nx-accent) 60%,transparent)}
        .voice-dot.listening{background:var(--nx-green);box-shadow:0 0 12px color-mix(in srgb,var(--nx-green) 60%,transparent)}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
        .voice-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:680px;padding:20px 0;width:100%}
        .wave-orb-container{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:32px}
        .wave-ring{position:absolute;border-radius:999px;border:2px solid color-mix(in srgb,var(--nx-accent) 25%,transparent);pointer-events:none}
        .wave-ring-1{width:140px;height:140px;animation:wavePulse1 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite}
        .wave-ring-2{width:200px;height:200px;animation:wavePulse2 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite .5s}
        .wave-ring-3{width:260px;height:260px;animation:wavePulse3 2.8s cubic-bezier(0.2,0.8,0.2,1) infinite 1s}
        @keyframes wavePulse1{0%{transform:scale(0.8);opacity:0.8}50%{transform:scale(1.1);opacity:0.3}100%{transform:scale(0.8);opacity:0.8}}
        @keyframes wavePulse2{0%{transform:scale(0.75);opacity:0.5}50%{transform:scale(1.2);opacity:0.15}100%{transform:scale(0.75);opacity:0.5}}
        @keyframes wavePulse3{0%{transform:scale(0.7);opacity:0.3}50%{transform:scale(1.25);opacity:0.05}100%{transform:scale(0.7);opacity:0.3}}
        .wave-core{width:110px;height:110px;border-radius:999px;background:linear-gradient(135deg,var(--nx-accent) 0%,var(--nx-accent-2) 100%);display:grid;place-items:center;color:var(--nx-ink);box-shadow:0 0 50px color-mix(in srgb,var(--nx-accent) 35%,transparent),0 0 90px color-mix(in srgb,var(--nx-accent-2) 22%,transparent);z-index:2;cursor:pointer;transition:all .3s}
        .wave-core.speaking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-red) 100%);box-shadow:0 0 60px color-mix(in srgb,var(--nx-red) 35%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 30%,transparent);animation:speakingBeat 1.2s ease-in-out infinite}
        .wave-core.thinking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);animation:rotateGlow 3s linear infinite}
        .wave-core.listening{box-shadow:0 0 60px color-mix(in srgb,var(--nx-green) 35%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent) 25%,transparent)}
        @keyframes speakingBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
        @keyframes rotateGlow{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}
        .voice-status-title{font-size:22px;font-weight:600;letter-spacing:-0.02em;margin-bottom:12px;color:var(--nx-ink)}
        .voice-transcript-box{max-height:160px;overflow-y:auto;width:100%;padding:14px 20px;border-radius:18px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:15px;line-height:1.6;color:var(--nx-ink-2)}
        .voice-transcript-user{color:var(--nx-accent-ink);font-weight:500;margin-bottom:8px;font-size:14px}
        .voice-transcript-ai{color:var(--nx-ink);font-size:15px}
        .voice-controls{display:flex;align-items:center;gap:24px}
        .voice-btn-subtle{width:50px;height:50px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);display:grid;place-items:center;color:var(--nx-ink-2);cursor:pointer;transition:all .2s}
        .voice-btn-subtle:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.05)}
        .voice-btn-end{width:64px;height:64px;border-radius:999px;background:var(--nx-red);border:none;display:grid;place-items:center;color:var(--nx-ink);cursor:pointer;box-shadow:0 8px 24px color-mix(in srgb,var(--nx-red) 32%,transparent);transition:all .2s}
        .voice-btn-end:hover{transform:scale(1.08);background:color-mix(in srgb,var(--nx-red) 88%,var(--nx-ink));box-shadow:0 12px 30px color-mix(in srgb,var(--nx-red) 42%,transparent)}
        .voice-btn-end:active{transform:scale(0.94)}
        @media(max-width:768px){.sidebar{position:fixed;left:0;top:0;bottom:0;transform:translateX(-100%)}.sidebar.open{transform:translateX(0)}.main{width:100%}.wave-orb-container{width:200px;height:200px}}
'@
$newCss = $newCss.Trim() -replace "`r?`n", $newline

# Substituições inline: os trechos e as quantidades foram conferidos na
# versão identificada pelo SHA256 acima. Não usa substituições genéricas.
$replacements = @(
    @{ Name = 'Marca NEXUS - fundo dos dois logotipos'; Before = 'background: "white",'; After = 'background: "var(--nx-accent)",'; Expected = 2 },
    @{ Name = 'Marca NEXUS - texto dos dois logotipos'; Before = 'color: "black",'; After = 'color: "var(--nx-ink)",'; Expected = 2 },
    @{ Name = 'Botão Nova conversa'; Before = 'style={{ width: "100%", justifyContent: "center", background: "white", color: "black", fontWeight: 600, borderRadius: 12 }}'; After = 'style={{ width: "100%", justifyContent: "center", background: "var(--nx-accent)", color: "var(--nx-ink)", fontWeight: 600, borderRadius: 12 }}'; Expected = 1 },
    @{ Name = 'Textos auxiliares secundários'; Before = '"#71717a"'; After = '"var(--nx-ink-3)"'; Expected = 5 },
    @{ Name = 'Rótulos de navegação e provedor'; Before = '"#a1a1aa"'; After = '"var(--nx-ink-3)"'; Expected = 3 },
    @{ Name = 'Superfície dos campos e badge Gemini'; Before = '"#1c1c1f"'; After = '"var(--nx-surface-2)"'; Expected = 2 },
    @{ Name = 'Borda do campo de busca'; Before = '"1px solid rgba(255,255,255,.08)"'; After = '"1px solid var(--nx-border)"'; Expected = 1 },
    @{ Name = 'Cartões de recentes e estados vazios'; Before = '"#1a1a1d"'; After = '"var(--nx-surface-2)"'; Expected = 3 },
    @{ Name = 'Borda tracejada dos estados vazios'; Before = '"1px dashed rgba(255,255,255,.12)"'; After = '"1px dashed var(--nx-border-strong)"'; Expected = 2 },
    @{ Name = 'Borda dos cartões recentes'; Before = '"1px solid rgba(255,255,255,.06)"'; After = '"1px solid var(--nx-border)"'; Expected = 1 },
    @{ Name = 'Texto do campo de busca da sessão'; Before = 'color: "white",'; After = 'color: "var(--nx-ink)",'; Expected = 1 },
    @{ Name = 'Modo Voz - superfície dinâmica'; Before = 'background: isVoiceMode ? "rgba(239,68,68,.15)" : "rgba(37,99,235,.15)",'; After = 'background: isVoiceMode ? "color-mix(in srgb, var(--nx-red) 15%, transparent)" : "color-mix(in srgb, var(--nx-accent) 15%, transparent)",'; Expected = 1 },
    @{ Name = 'Modo Voz - borda dinâmica'; Before = 'borderColor: isVoiceMode ? "rgba(239,68,68,.3)" : "rgba(37,99,235,.3)",'; After = 'borderColor: isVoiceMode ? "color-mix(in srgb, var(--nx-red) 30%, transparent)" : "color-mix(in srgb, var(--nx-accent) 30%, transparent)",'; Expected = 1 },
    @{ Name = 'Modo Voz - texto dinâmico'; Before = 'color: isVoiceMode ? "#f87171" : "#60a5fa",'; After = 'color: isVoiceMode ? "var(--nx-red)" : "var(--nx-accent-ink)",'; Expected = 1 },
    @{ Name = 'Ícone do botão enviar'; Before = 'color="white"'; After = 'color="var(--nx-ink)"'; Expected = 2 }
)

# Pré-validação completa de todas as ocorrências, antes de alterar em memória.
$failures = New-Object System.Collections.Generic.List[string]
foreach ($item in $replacements) {
    $found = Get-OrdinalCount $content $item.Before
    if ($found -ne $item.Expected) {
        $failures.Add("$($item.Name): esperado $($item.Expected), encontrado $found")
    }
}
if ($failures.Count -gt 0) {
    Write-Host 'PRE-VALIDACAO INTERROMPIDA. NENHUMA ALTERACAO FOI FEITA.' -ForegroundColor Red
    foreach ($failure in $failures) { Write-Host "- $failure" -ForegroundColor Yellow }
    throw 'Revise as divergências antes de qualquer gravação.'
}

# Monta o resultado somente em memória.
$newContent = $content.Substring(0, $styleStart) + $newline + $newCss + $newline + $content.Substring($styleEnd + $styleEndMarker.Length)
foreach ($item in $replacements) {
    $newContent = $newContent.Replace($item.Before, $item.After)
}

if ($newContent -eq $content) { throw 'Nenhuma alteração foi produzida. Arquivo preservado.' }

# Verificações estruturais do CSS novo e dos tokens necessários.
$requiredCss = @(
    '.nexus-root{height:100dvh;width:100%;background:var(--nx-canvas)',
    '.sidebar{width:300px;min-width:300px;background:var(--nx-surface)',
    '.bubble-user{max-width:80%;margin-left:auto;background:var(--nx-accent)',
    '.voice-mode-overlay{position:absolute;inset:0;background:radial-gradient',
    '.voice-transcript-box{max-height:160px',
    '.voice-btn-end{width:64px;height:64px;border-radius:999px;background:var(--nx-red)'
)
foreach ($required in $requiredCss) {
    if (-not $newContent.Contains($required)) {
        throw "Validação interna falhou: regra CSS ausente: $required. Nenhum arquivo gravado."
    }
}

# Confirma que lógica e integrações importantes permanecem byte-a-byte no conteúdo.
$protectedMarkers = @(
    'api.post<{ resposta?: string; text?: string; fallback?: boolean }>("/ia/perguntar"',
    'fetch(`${baseUrl}/api/v1/tts`',
    'const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;',
    'recognitionRef.current = rec;',
    'router.push("/");',
    'setMessages((p) => [...p, userMsg]);'
)
foreach ($marker in $protectedMarkers) {
    if (-not $newContent.Contains($marker)) {
        throw "Validação de preservação falhou: marcador funcional ausente: $marker. Nenhum arquivo gravado."
    }
}

# Auditoria de resíduos de cores antigas somente nas áreas que devem acompanhar o tema.
$cssNewStart = $newContent.IndexOf($styleStartMarker, [System.StringComparison]::Ordinal) + $styleStartMarker.Length
$cssNewEnd = $newContent.IndexOf($styleEndMarker, $cssNewStart, [System.StringComparison]::Ordinal)
$cssFinal = $newContent.Substring($cssNewStart, $cssNewEnd - $cssNewStart)
$forbiddenCss = @('#08080a','#111113','#1c1c1f','#242429','#1e1e22','#18181b','#0D0D14','#12121F','#050507','#09090c','#141420','#7c3aed','#2563eb','#3b82f6','#8b5cf6','#a855f7','#ec4899','#f87171','#60a5fa','#71717a','#a1a1aa')
$remaining = @()
foreach ($color in $forbiddenCss) {
    if ($cssFinal.Contains($color)) { $remaining += $color }
}
if ($remaining.Count -gt 0) {
    throw "Auditoria CSS encontrou cores fixas não convertidas: $($remaining -join ', '). Nenhum arquivo gravado."
}

# Detecta alterações concorrentes antes de criar o backup.
$currentHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
if ($currentHash -ne $initialHash) {
    throw 'O arquivo mudou durante a preparação. Nenhuma gravação realizada.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Get-Location) "backup-ia-nexus-tema-$timestamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir 'page.tsx'
Copy-Item -LiteralPath $filePath -Destination $backupPath

try {
    [System.IO.File]::WriteAllText($filePath, $newContent, $utf8)
    $written = [System.IO.File]::ReadAllText($filePath)

    foreach ($item in $replacements) {
        $found = Get-OrdinalCount $written $item.After
        if ($found -lt $item.Expected) {
            throw "Pós-validação falhou em '$($item.Name)': esperado pelo menos $($item.Expected), encontrado $found."
        }
    }
    foreach ($required in $requiredCss) {
        if (-not $written.Contains($required)) { throw "Pós-validação falhou: regra CSS ausente: $required." }
    }
    foreach ($marker in $protectedMarkers) {
        if (-not $written.Contains($marker)) { throw "Pós-validação falhou: marcador funcional ausente: $marker." }
    }

    $writtenCssStart = $written.IndexOf($styleStartMarker, [System.StringComparison]::Ordinal) + $styleStartMarker.Length
    $writtenCssEnd = $written.IndexOf($styleEndMarker, $writtenCssStart, [System.StringComparison]::Ordinal)
    $writtenCss = $written.Substring($writtenCssStart, $writtenCssEnd - $writtenCssStart)
    foreach ($color in $forbiddenCss) {
        if ($writtenCss.Contains($color)) { throw "Pós-validação encontrou cor fixa residual: $color." }
    }

    git diff --check -- $relativePath
    if ($LASTEXITCODE -ne 0) {
        throw 'Git diff --check encontrou problemas de whitespace.'
    }
}
catch {
    Copy-Item -LiteralPath $backupPath -Destination $filePath -Force
    throw "Alteração revertida pelo backup. Motivo: $($_.Exception.Message)"
}

Write-Host "`nPADRONIZAÇÃO VISUAL DA IA NEXUS APLICADA E VERIFICADA." -ForegroundColor Green
Write-Host "Bloco CSS substituído: 1" -ForegroundColor Cyan
Write-Host "Substituições JSX específicas: $($replacements.Count)" -ForegroundColor Cyan
Write-Host "Backup: $backupPath" -ForegroundColor Cyan
Write-Host 'Gemini, TTS, reconhecimento de voz, chamadas de API e navegação preservados.' -ForegroundColor Green
Write-Host "`nValidação Git: aprovada." -ForegroundColor Green
Write-Host "`nConcluído. Teste /ia nos temas claro e escuro, incluindo o Modo Voz." -ForegroundColor Green
