$ErrorActionPreference = 'Stop'

$relativePath = '.\frontend\app\(dashboard)\ia\page.tsx'
if (-not (Test-Path -LiteralPath $relativePath -PathType Leaf)) {
    throw "Arquivo alvo não encontrado: $relativePath"
}
$target = (Resolve-Path -LiteralPath $relativePath).Path
$originalBytes = [System.IO.File]::ReadAllBytes($target)
$originalHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash

# Detecta e preserva BOM e padrão de quebra de linha do arquivo.
$hasBom = ($originalBytes.Length -ge 3 -and $originalBytes[0] -eq 0xEF -and $originalBytes[1] -eq 0xBB -and $originalBytes[2] -eq 0xBF)
$newline = "`n"
if ([System.IO.File]::ReadAllText($target).Contains("`r`n")) { $newline = "`r`n" }
$utf8 = [System.Text.UTF8Encoding]::new($hasBom)
$source = [System.IO.File]::ReadAllText($target)

function Count-Literal([string]$Text, [string]$Value) {
    return [regex]::Matches($Text, [regex]::Escape($Value)).Count
}

function Replace-Required([string]$Text, [string]$Name, [string]$Before, [string]$After, [int]$Expected) {
    $count = Count-Literal $Text $Before
    if ($count -ne $Expected) {
        throw "Pré-validação interrompida: '$Name' — esperado $Expected, encontrado $count. Nenhuma gravação realizada."
    }
    return $Text.Replace($Before, $After)
}

function Replace-Optional([string]$Text, [string]$Name, [string]$Before, [string]$After, [System.Collections.Generic.List[object]]$Log) {
    $count = Count-Literal $Text $Before
    if ($count -gt 0) {
        $Log.Add([pscustomobject]@{ Nome = $Name; Ocorrencias = $count })
        return $Text.Replace($Before, $After)
    }
    return $Text
}

# Confirma a identidade da página e os delimitadores exclusivos do CSS local.
$identityMarker = 'const shortcuts = ["Quanto vendi hoje?", "Estoque baixo?", "Resumo financeiro"];'
if ((Count-Literal $source $identityMarker) -ne 1) {
    throw 'O conteúdo não corresponde à página /ia esperada. Nenhuma gravação realizada.'
}
$styleOpen = '<style>{`'
$styleClose = '`}</style>'
if ((Count-Literal $source $styleOpen) -ne 1 -or (Count-Literal $source $styleClose) -ne 1) {
    throw 'Não foi possível delimitar unicamente o CSS local da IA NEXUS. Nenhuma gravação realizada.'
}
$start = $source.IndexOf($styleOpen, [System.StringComparison]::Ordinal) + $styleOpen.Length
$end = $source.IndexOf($styleClose, $start, [System.StringComparison]::Ordinal)
if ($end -le $start) {
    throw 'Os delimitadores do CSS estão fora de ordem. Nenhuma gravação realizada.'
}
$oldCss = $source.Substring($start, $end - $start)
if (-not $oldCss.Contains('.nexus-root{') -or -not $oldCss.Contains('.voice-mode-overlay{') -or -not $oldCss.Contains('.bubble-ai')) {
    throw 'O CSS encontrado não corresponde à estrutura esperada da IA NEXUS. Nenhuma gravação realizada.'
}

# CSS integral da tela baseado no tema global NEXUS OS.
$css = @'
        .nexus-root{height:100dvh;width:100%;background:var(--nx-canvas);color:var(--nx-ink);display:flex;font-family:Inter,system-ui;overflow:hidden;position:relative}
        .nexus-root .nexus-bg{position:fixed;inset:0;pointer-events:none;overflow:hidden}
        .nexus-root .nexus-bg-a{position:absolute;top:-128px;left:50%;transform:translateX(-50%);width:900px;height:600px;background:color-mix(in srgb,var(--nx-accent) 16%,transparent);filter:blur(140px);border-radius:999px}
        .nexus-root .nexus-bg-b{position:absolute;bottom:-128px;left:-128px;width:600px;height:600px;background:color-mix(in srgb,var(--nx-accent-2) 12%,transparent);filter:blur(140px);border-radius:999px}
        .nexus-root .sidebar{width:300px;min-width:300px;background:var(--nx-surface);color:var(--nx-ink);border-right:1px solid var(--nx-border);display:flex;flex-direction:column;transition:transform .3s;z-index:20}
        .nexus-root .sidebar.closed{transform:translateX(-100%);position:absolute;left:0;top:0;bottom:0}
        .nexus-root .sidebar-header{padding:20px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between}
        .nexus-root .pill{border-radius:999px;border:1px solid var(--nx-border);background:var(--nx-surface-2);color:var(--nx-ink-2);padding:8px 16px;font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .2s}
        .nexus-root .pill:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.02)}
        .nexus-root .pill:active{transform:scale(.98)}
        .nexus-root .nav-btn{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--nx-ink-2);font-size:13px;cursor:pointer;text-align:left;transition:all .2s}
        .nexus-root .nav-btn:hover{background:var(--nx-surface-2);color:var(--nx-ink)}
        .nexus-root .nav-btn.active{background:color-mix(in srgb,var(--nx-accent) 16%,var(--nx-surface-2));border-color:color-mix(in srgb,var(--nx-accent) 24%,var(--nx-border));color:var(--nx-accent-ink);font-weight:600}
        .nexus-root .main{flex:1;display:flex;flex-direction:column;position:relative;min-width:0;overflow:hidden;background:transparent}
        .nexus-root .header{height:56px;flex-shrink:0;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:color-mix(in srgb,var(--nx-surface) 92%,transparent);backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}
        .nexus-root .icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--nx-border);background:var(--nx-surface-2);display:grid;place-items:center;cursor:pointer;transition:all .2s;color:var(--nx-ink-2)}
        .nexus-root .icon-btn:hover{background:var(--nx-surface-3);transform:scale(1.05);color:var(--nx-ink)}
        .nexus-root .icon-btn:active{transform:scale(.95)}
        .nexus-root .chat-area{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:0 16px}
        .nexus-root .chat-inner{max-width:760px;margin:0 auto;padding:32px 0}
        .nexus-root .bubble-user{max-width:80%;margin-left:auto;background:var(--nx-accent);color:var(--nx-ink);border:1px solid color-mix(in srgb,var(--nx-accent) 75%,var(--nx-border));border-radius:24px;border-bottom-right-radius:8px;padding:14px 18px;font-size:14px;line-height:1.5;animation:pop .2s ease;box-shadow:0 4px 14px color-mix(in srgb,var(--nx-accent) 22%,transparent)}
        .nexus-root .bubble-ai{max-width:80%;background:var(--nx-surface-2);border:1px solid var(--nx-border);border-radius:24px;border-bottom-left-radius:8px;padding:16px 18px;font-size:14px;line-height:1.6;color:var(--nx-ink);animation:pop .2s ease;white-space:pre-wrap}
        .nexus-root .bubble-ai.erro{background:color-mix(in srgb,var(--nx-red) 10%,var(--nx-surface));border-color:color-mix(in srgb,var(--nx-red) 30%,var(--nx-border));color:var(--nx-red)}
        @keyframes pop{from{transform:scale(.95);opacity:0}to{transform:scale(1);opacity:1}}
        .nexus-root .input-wrap{position:relative;flex-shrink:0;left:0;right:0;padding:16px;background:linear-gradient(to top,var(--nx-canvas) 50%,color-mix(in srgb,var(--nx-canvas) 90%,transparent),transparent)}
        .nexus-root .input-pill{max-width:760px;margin:0 auto;height:62px;border-radius:28px;background:var(--nx-surface);border:1px solid var(--nx-border);display:flex;align-items:center;gap:10px;padding:0 10px;box-shadow:var(--nx-shadow-pop)}
        .nexus-root .input-pill:focus-within{border-color:var(--nx-accent)}
        .nexus-root .circle-btn{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .2s;border:none}
        .nexus-root .circle-btn:hover{transform:scale(1.06)}
        .nexus-root .circle-btn:active{transform:scale(.92)}
        .nexus-root .circle-plus,.nexus-root .circle-mic{background:var(--nx-surface-2);color:var(--nx-ink-2)}
        .nexus-root .circle-plus:hover,.nexus-root .circle-mic:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
        .nexus-root .circle-mic.rec{background:color-mix(in srgb,var(--nx-red) 16%,var(--nx-surface-2));color:var(--nx-red);box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent);animation:pulse 1.2s infinite}
        @keyframes pulse{0%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--nx-red) 10%,transparent)}100%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}}
        .nexus-root .circle-send,.nexus-root .circle-waves{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 34%,transparent)}
        .nexus-root .circle-waves{position:relative}
        .nexus-root .circle-send:hover,.nexus-root .circle-waves:hover{background:var(--nx-accent-2);box-shadow:0 8px 24px color-mix(in srgb,var(--nx-accent) 42%,transparent)}
        .nexus-root .chat-input{flex:1;background:transparent;border:none;outline:none;color:var(--nx-ink);font-size:15px;min-width:0}
        .nexus-root .chat-input::placeholder{color:var(--nx-ink-3)}
        .nexus-root .voice-mode-overlay{position:absolute;inset:0;background:radial-gradient(circle at center,color-mix(in srgb,var(--nx-surface-2) 90%,var(--nx-canvas)) 0%,var(--nx-canvas) 75%,var(--nx-canvas) 100%);color:var(--nx-ink);z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 20px 40px;animation:fadeIn .3s ease}
        @keyframes fadeIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:scale(1)}}
        .nexus-root .voice-topbar{width:100%;max-width:800px;display:flex;align-items:center;justify-content:space-between}
        .nexus-root .voice-badge{display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:13px;font-weight:500;color:var(--nx-ink-2)}
        .nexus-root .voice-dot{width:8px;height:8px;border-radius:999px;background:var(--nx-accent-2);box-shadow:0 0 10px color-mix(in srgb,var(--nx-accent-2) 65%,transparent);animation:blink 1.5s infinite}
        .nexus-root .voice-dot.speaking{background:var(--nx-accent);box-shadow:0 0 12px color-mix(in srgb,var(--nx-accent) 70%,transparent)}
        .nexus-root .voice-dot.listening{background:var(--nx-green);box-shadow:0 0 12px color-mix(in srgb,var(--nx-green) 70%,transparent)}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        .nexus-root .voice-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:680px;padding:20px 0;width:100%}
        .nexus-root .wave-orb-container{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:32px}
        .nexus-root .wave-ring{position:absolute;border-radius:999px;border:2px solid color-mix(in srgb,var(--nx-accent-2) 26%,transparent);pointer-events:none}
        .nexus-root .wave-ring-1{width:140px;height:140px;animation:wavePulse1 2.8s cubic-bezier(.2,.8,.2,1) infinite}
        .nexus-root .wave-ring-2{width:200px;height:200px;animation:wavePulse2 2.8s cubic-bezier(.2,.8,.2,1) infinite .5s}
        .nexus-root .wave-ring-3{width:260px;height:260px;animation:wavePulse3 2.8s cubic-bezier(.2,.8,.2,1) infinite 1s}
        @keyframes wavePulse1{0%{transform:scale(.8);opacity:.8}50%{transform:scale(1.1);opacity:.3}100%{transform:scale(.8);opacity:.8}}
        @keyframes wavePulse2{0%{transform:scale(.75);opacity:.5}50%{transform:scale(1.2);opacity:.15}100%{transform:scale(.75);opacity:.5}}
        @keyframes wavePulse3{0%{transform:scale(.7);opacity:.3}50%{transform:scale(1.25);opacity:.05}100%{transform:scale(.7);opacity:.3}}
        .nexus-root .wave-core{width:110px;height:110px;border-radius:999px;background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);display:grid;place-items:center;color:var(--nx-ink);box-shadow:0 0 50px color-mix(in srgb,var(--nx-accent) 48%,transparent),0 0 90px color-mix(in srgb,var(--nx-accent-2) 28%,transparent);z-index:2;cursor:pointer;transition:all .3s}
        .nexus-root .wave-core.speaking{background:linear-gradient(135deg,var(--nx-accent) 0%,var(--nx-accent-2) 100%);box-shadow:0 0 60px color-mix(in srgb,var(--nx-accent) 50%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 40%,transparent);animation:speakingBeat 1.2s ease-in-out infinite}
        .nexus-root .wave-core.thinking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);animation:rotateGlow 3s linear infinite}
        .nexus-root .wave-core.listening{box-shadow:0 0 60px color-mix(in srgb,var(--nx-green) 42%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 28%,transparent)}
        @keyframes speakingBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
        @keyframes rotateGlow{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}
        .nexus-root .voice-status-title{font-size:22px;font-weight:600;letter-spacing:-.02em;margin-bottom:12px;color:var(--nx-ink)}
        .nexus-root .voice-transcript-box{max-height:160px;overflow-y:auto;width:100%;padding:14px 20px;border-radius:18px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:15px;line-height:1.6;color:var(--nx-ink-2)}
        .nexus-root .voice-transcript-user{color:var(--nx-accent);font-weight:500;margin-bottom:8px;font-size:14px}
        .nexus-root .voice-transcript-ai{color:var(--nx-ink);font-size:15px}
        .nexus-root .voice-controls{display:flex;align-items:center;gap:24px}
        .nexus-root .voice-btn-subtle{width:50px;height:50px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);display:grid;place-items:center;color:var(--nx-ink-2);cursor:pointer;transition:all .2s}
        .nexus-root .voice-btn-subtle:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.05)}
        .nexus-root .voice-btn-end{width:64px;height:64px;border-radius:999px;background:var(--nx-red);border:none;display:grid;place-items:center;color:var(--nx-ink);cursor:pointer;box-shadow:0 8px 24px color-mix(in srgb,var(--nx-red) 38%,transparent);transition:all .2s}
        .nexus-root .voice-btn-end:hover{transform:scale(1.08);background:var(--nx-red);box-shadow:0 12px 30px color-mix(in srgb,var(--nx-red) 52%,transparent)}
        .nexus-root .voice-btn-end:active{transform:scale(.94)}
        @media(max-width:768px){.nexus-root .sidebar{position:fixed;left:0;top:0;bottom:0;transform:translateX(-100%)}.nexus-root .sidebar.open{transform:translateX(0)}.nexus-root .main{width:100%}.nexus-root .wave-orb-container{width:200px;height:200px}}
'@
$css = $css -replace "`r`n|`n|`r", $newline
$source = $source.Substring(0, $start) + $css + $source.Substring($end)

# Agora tratamos somente o JSX/TypeScript restante, sem tocar no CSS recém-substituído.
$endStyleNow = $source.IndexOf($styleClose, $start, [System.StringComparison]::Ordinal)
$tsxStart = $endStyleNow + $styleClose.Length
$prefix = $source.Substring(0, $tsxStart)
$tsx = $source.Substring($tsxStart)
$log = New-Object 'System.Collections.Generic.List[object]'

# Conversão das combinações hex + alpha para color-mix com tokens do tema.
$tsx = Replace-Required $tsx 'Fundo dos ícones SE/ENTÃO' 'backgroundColor: `${op.cor}${ativo ? ''22'' : ''14''}`,' 'backgroundColor: `color-mix(in srgb, ${op.cor} ${ativo ? 14 : 8}%, transparent)`,' 2
$tsx = Replace-Required $tsx 'Borda dos ícones SE/ENTÃO' 'borderColor: `${op.cor}${ativo ? ''55'' : ''30''}`,' 'borderColor: `color-mix(in srgb, ${op.cor} ${ativo ? 42 : 24}%, var(--nx-border))`,' 2
$tsx = Replace-Required $tsx 'Fundo dos ícones KPI' 'backgroundColor: `${kpi.cor}1A`,' 'backgroundColor: `color-mix(in srgb, ${kpi.cor} 12%, transparent)`,' 1
$tsx = Replace-Required $tsx 'Borda dos ícones KPI' 'borderColor: `${kpi.cor}33`,' 'borderColor: `color-mix(in srgb, ${kpi.cor} 28%, var(--nx-border))`,' 1
$tsx = Replace-Required $tsx 'Fundo dos ícones de alerta' 'backgroundColor: `${meta.cor}1A`,' 'backgroundColor: `color-mix(in srgb, ${meta.cor} 12%, transparent)`,' 1
$tsx = Replace-Required $tsx 'Borda dos ícones de alerta' 'borderColor: `${meta.cor}33`,' 'borderColor: `color-mix(in srgb, ${meta.cor} 28%, var(--nx-border))`,' 1
$tsx = Replace-Required $tsx 'Fundo dos ícones de regra' 'backgroundColor: `${cor}1A`,' 'backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,' 1
$tsx = Replace-Required $tsx 'Borda dos ícones de regra' 'borderColor: `${cor}33`,' 'borderColor: `color-mix(in srgb, ${cor} 28%, var(--nx-border))`,' 1

# Tokens semânticos para todas as cores HEX restantes no JSX.
$hexMap = @(
    '#FF5A5F|var(--nx-red)'
    '#FF8A8E|var(--nx-red)'
    '#ef4444|var(--nx-red)'
    '#dc2626|var(--nx-red)'
    '#f87171|var(--nx-red)'
    '#FFB020|var(--nx-amber)'
    '#22C55E|var(--nx-green)'
    '#38BDF8|var(--nx-accent-2)'
    '#60a5fa|var(--nx-accent-2)'
    '#93c5fd|var(--nx-accent-2)'
    '#A99CFF|var(--nx-accent-2)'
    '#6C5CE7|var(--nx-accent)'
    '#6c5ce7|var(--nx-accent)'
    '#7c3aed|var(--nx-accent)'
    '#7A6EF0|var(--nx-accent-2)'
    '#2563eb|var(--nx-accent)'
    '#1d4ed8|var(--nx-accent-2)'
    '#3b82f6|var(--nx-accent-2)'
    '#8b5cf6|var(--nx-accent)'
    '#ec4899|var(--nx-accent-2)'
    '#6366f1|var(--nx-accent-2)'
    '#0D0D14|var(--nx-surface-3)'
    '#12121F|var(--nx-surface-3)'
    '#151528|var(--nx-surface)'
    '#1A1A2E|var(--nx-surface-2)'
    '#1c1c1f|var(--nx-surface-2)'
    '#242429|var(--nx-surface-3)'
    '#1e1e22|var(--nx-surface-2)'
    '#18181b|var(--nx-surface)'
    '#f4f4f5|var(--nx-ink)'
    '#fafafa|var(--nx-ink)'
    '#d4d4d8|var(--nx-ink-2)'
    '#e4e4e7|var(--nx-ink-2)'
    '#a1a1aa|var(--nx-ink-3)'
    '#71717a|var(--nx-ink-3)'
)
foreach ($entry in $hexMap) {
    $pair = $entry -split '\|', 2
    $tsx = Replace-Optional $tsx ("Cor HEX " + $pair[0]) $pair[0] $pair[1] $log
}

# Cores inline de botões/identidade e ícones.
$tsx = Replace-Required $tsx 'Fundos dos monogramas e botão nova conversa' 'background: "white"' 'background: "var(--nx-accent)"' 3
$tsx = Replace-Required $tsx 'Texto dos monogramas e botão nova conversa' 'color: "black"' 'color: "var(--nx-ink)"' 3
$tsx = Replace-Required $tsx 'Ícones de enviar e ondas' 'color="white"' 'color="var(--nx-ink)"' 2

# Botões/abas de destaque que antes usavam branco e preto fixos.
$tsx = Replace-Required $tsx 'Pílulas SE do modal e preview' 'bg-white text-[var(--nx-surface-3)]' 'bg-[var(--nx-accent)] text-[var(--nx-ink)]' 2

# Cores inline translúcidas do seletor Modo Voz.
$tsx = Replace-Required $tsx 'Fundo do modo voz ativo' 'rgba(239,68,68,.15)' 'color-mix(in srgb, var(--nx-red) 15%, transparent)' 1
$tsx = Replace-Required $tsx 'Fundo do modo voz inativo' 'rgba(37,99,235,.15)' 'color-mix(in srgb, var(--nx-accent) 15%, transparent)' 1
$tsx = Replace-Required $tsx 'Borda do modo voz ativo' 'rgba(239,68,68,.3)' 'color-mix(in srgb, var(--nx-red) 30%, transparent)' 1
$tsx = Replace-Required $tsx 'Borda do modo voz inativo' 'rgba(37,99,235,.3)' 'color-mix(in srgb, var(--nx-accent) 30%, transparent)' 1

# Utilitários Tailwind com branco/preto fixos são convertidos para superfícies e textos semânticos.
$classMap = @(
    'text-white/90|text-[var(--nx-ink)]'
    'text-white/80|text-[var(--nx-ink)]'
    'text-white/70|text-[var(--nx-ink-2)]'
    'text-white/60|text-[var(--nx-ink-2)]'
    'text-white/50|text-[var(--nx-ink-2)]'
    'text-white/40|text-[var(--nx-ink-3)]'
    'text-white/35|text-[var(--nx-ink-3)]'
    'text-white/30|text-[var(--nx-ink-3)]'
    'text-white/25|text-[var(--nx-ink-3)]'
    'text-white/20|text-[var(--nx-ink-3)]'
    'hover:text-white|hover:text-[var(--nx-ink)]'
    'text-white|text-[var(--nx-ink)]'
    'bg-white/[0.03]|bg-[var(--nx-surface-2)]'
    'bg-white/[0.06]|bg-[var(--nx-surface-2)]'
    'bg-white/[0.08]|bg-[var(--nx-surface-2)]'
    'bg-white/[0.10]|bg-[var(--nx-surface-3)]'
    'bg-white/[0.16]|bg-[var(--nx-surface-3)]'
    'hover:bg-white/[0.06]|hover:bg-[var(--nx-surface-3)]'
    'hover:bg-white/[0.10]|hover:bg-[var(--nx-surface-3)]'
    'hover:bg-white/10|hover:bg-[var(--nx-surface-3)]'
    'hover:bg-white/15|hover:bg-[var(--nx-surface-3)]'
    'border-white/[0.06]|border-[var(--nx-border)]'
    'border-white/[0.07]|border-[var(--nx-border)]'
    'border-white/[0.08]|border-[var(--nx-border)]'
    'border-white/10|border-[var(--nx-border)]'
    'border-white/15|border-[var(--nx-border-strong)]'
    'border-white/20|border-[var(--nx-border-strong)]'
    'hover:border-white/15|hover:border-[var(--nx-border-strong)]'
    'hover:border-white/20|hover:border-[var(--nx-border-strong)]'
    'bg-white|bg-[var(--nx-surface-2)]'
    'text-black|text-[var(--nx-ink)]'
)
foreach ($entry in $classMap) {
    $pair = $entry -split '\|', 2
    $tsx = Replace-Optional $tsx ("Classe " + $pair[0]) $pair[0] $pair[1] $log
}

# Inline surfaces and borders in the sidebar search/recent list.
$inlineMap = @(
    'background: "#1c1c1f"|background: "var(--nx-surface-2)"'
    'background: "#1a1a1d"|background: "var(--nx-surface-2)"'
    'border: "1px dashed rgba(255,255,255,.12)"|border: "1px dashed var(--nx-border)"'
    'border: "1px solid rgba(255,255,255,.08)"|border: "1px solid var(--nx-border)"'
    'border: "1px solid rgba(255,255,255,.06)"|border: "1px solid var(--nx-border)"'
)
foreach ($entry in $inlineMap) {
    $pair = $entry -split '\|', 2
    $tsx = Replace-Optional $tsx ("Estilo inline " + $pair[0]) $pair[0] $pair[1] $log
}

$updated = $prefix + $tsx

# Auditoria estática: nenhum hexadecimal, rgba fixo ou classe branca/preta de interface pode restar.
$remaining = New-Object 'System.Collections.Generic.List[string]'
$checks = @(
    @{ Nome = 'cor hexadecimal'; Pattern = '#[0-9A-Fa-f]{3,8}\b' },
    @{ Nome = 'rgba/rgb fixo'; Pattern = 'rgba?\s*\(' },
    @{ Nome = 'texto branco fixo'; Pattern = 'text-white(?:/\d+)?' },
    @{ Nome = 'fundo branco fixo'; Pattern = 'bg-white(?:/[^\s"'']+)?' },
    @{ Nome = 'borda branca fixa'; Pattern = 'border-white(?:/[^\s"'']+)?' },
    @{ Nome = 'cor inline branca/preta'; Pattern = '(?:background|color)\s*:\s*["''](?:white|black)["'']|color="white"' }
)
foreach ($check in $checks) {
    if ([regex]::IsMatch($updated, $check.Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $remaining.Add($check.Nome)
    }
}
if ($remaining.Count -gt 0) {
    throw ("Auditoria interrompida: ainda há estilos fixos: " + ($remaining -join ', ') + '. Nenhuma gravação realizada.')
}

# Conferir que a lógica funcional não foi tocada e que o CSS novo está presente.
foreach ($marker in @('/ia/perguntar','/api/v1/tts','SpeechRecognition','recognitionRef.current.start()','recognitionRef.current.stop()','className="nexus-root"','--nx-canvas','--nx-surface','--nx-accent')) {
    if (-not $updated.Contains($marker)) {
        throw "Verificação estrutural falhou: marcador '$marker' ausente. Nenhuma gravação realizada."
    }
}
foreach ($marker in @('handleSendMessage','enterVoiceMode','exitVoiceMode','handleFile')) {
    if (-not $updated.Contains($marker)) {
        throw "Verificação funcional falhou: '$marker' ausente. Nenhuma gravação realizada."
    }
}

# Defesa contra edição concorrente: hash ainda precisa ser idêntico ao lido no começo.
$hashAtual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
if ($hashAtual -ne $originalHash) {
    throw 'O arquivo mudou durante a preparação. Nenhuma gravação realizada.'
}
if ($updated -eq $source) {
    throw 'Nenhuma alteração visual foi preparada. Arquivo preservado.'
}

# Backup criado somente depois de toda a pré-validação.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Get-Location) "backup-ia-nexus-tema-$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
$backup = Join-Path $backupDir 'page.tsx'
Copy-Item -LiteralPath $target -Destination $backup

try {
    [System.IO.File]::WriteAllText($target, $updated, $utf8)
    $written = [System.IO.File]::ReadAllText($target)

    if (-not $written.Contains('--nx-canvas') -or -not $written.Contains('color-mix(in srgb,var(--nx-red)')) {
        throw 'A verificação pós-gravação não encontrou os tokens esperados.'
    }
    if ([regex]::IsMatch($written, '#[0-9A-Fa-f]{3,8}\b|rgba?\s*\(', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        throw 'A auditoria pós-gravação encontrou cores literais não tokenizadas.'
    }
    if (-not $written.Contains('/ia/perguntar') -or -not $written.Contains('/api/v1/tts') -or -not $written.Contains('SpeechRecognition')) {
        throw 'A verificação pós-gravação detectou perda de integração funcional.'
    }
}
catch {
    Copy-Item -LiteralPath $backup -Destination $target -Force
    throw "A gravação foi revertida pelo backup. Motivo: $($_.Exception.Message)"
}

Write-Host "`nPADRONIZAÇÃO VISUAL DA IA NEXUS APLICADA E VERIFICADA." -ForegroundColor Green
Write-Host "Arquivo: $target" -ForegroundColor Cyan
Write-Host "SHA256 anterior: $originalHash" -ForegroundColor DarkGray
Write-Host "Backup: $backup" -ForegroundColor Cyan
Write-Host "CSS da tela substituído por tokens globais do tema." -ForegroundColor Green
Write-Host "Transformações adicionais registradas: $($log.Count)" -ForegroundColor Green
Write-Host "Ocorrências transformadas em mapeamentos adicionais: $(($log | Measure-Object -Property Ocorrencias -Sum).Sum)" -ForegroundColor Green
Write-Host "Gemini, endpoint TTS e reconhecimento de voz preservados." -ForegroundColor Green
Write-Host "`nValidando whitespace com Git..." -ForegroundColor Yellow
git diff --check -- $relativePath
if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $backup -Destination $target -Force
    throw 'Git diff --check encontrou problemas. Arquivo restaurado pelo backup.'
}
Write-Host 'Git diff --check: sem apontamentos.' -ForegroundColor Green
