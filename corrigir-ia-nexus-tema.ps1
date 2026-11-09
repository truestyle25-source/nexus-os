# NEXUS OS - IA NEXUS: padronizacao de tema claro/escuro
# PowerShell 5.1+ | Executar na raiz do repositorio.
# Altera somente estilos desta pagina; nao altera chamadas de API, voz, estado ou logica.

$ErrorActionPreference = 'Stop'

$repo = (Get-Location).Path
$frontendApp = Join-Path $repo 'frontend\app'
if (-not (Test-Path -LiteralPath $frontendApp -PathType Container)) {
    throw 'Execute este script na raiz do repositorio NEXUS OS (pasta que contem frontend\app).'
}

# Localiza a pagina pelo conteudo exclusivo, sem presumir o nome da rota.
$marcador = 'const shortcuts = ["Quanto vendi hoje?", "Estoque baixo?", "Resumo financeiro"];'
$alvos = @()
foreach ($item in Get-ChildItem -LiteralPath $frontendApp -Filter 'page.tsx' -Recurse -File) {
    $texto = [System.IO.File]::ReadAllText($item.FullName)
    if ($texto.Contains($marcador)) { $alvos += $item.FullName }
}
if ($alvos.Count -ne 1) {
    throw "Localizacao interrompida: esperava encontrar uma pagina IA NEXUS e encontrei $($alvos.Count). Nenhum arquivo foi alterado."
}

$arquivo = $alvos[0]
$conteudo = [System.IO.File]::ReadAllText($arquivo)
$hashInicial = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
$bytesOriginais = [System.IO.File]::ReadAllBytes($arquivo)
$temBom = ($bytesOriginais.Length -ge 3 -and $bytesOriginais[0] -eq 0xEF -and $bytesOriginais[1] -eq 0xBB -and $bytesOriginais[2] -eq 0xBF)
$utf8 = [System.Text.UTF8Encoding]::new($temBom)

$work = $conteudo
$log = New-Object System.Collections.Generic.List[string]

function Replace-Literal {
    param(
        [string]$Text,
        [string]$Before,
        [string]$After,
        [string]$Name,
        [int]$Expected = -1,
        [switch]$Required
    )
    $count = [regex]::Matches($Text, [regex]::Escape($Before)).Count
    if ($Expected -ge 0 -and $count -ne $Expected) {
        throw "Pre-validacao interrompida: '$Name' - esperado $Expected, encontrado $count. Nenhuma gravacao realizada."
    }
    if ($Required -and $count -eq 0) {
        throw "Pre-validacao interrompida: trecho obrigatorio '$Name' nao encontrado. Nenhuma gravacao realizada."
    }
    if ($count -gt 0) { $Text = $Text.Replace($Before, $After) }
    return [pscustomobject]@{ Text = $Text; Count = $count }
}

function Replace-RegexBlock {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Replacement,
        [string]$Name
    )
    $regex = [System.Text.RegularExpressions.Regex]::new($Pattern)
    $matches = $regex.Matches($Text)
    if ($matches.Count -ne 1) {
        throw "Pre-validacao interrompida: bloco '$Name' - esperado 1, encontrado $($matches.Count). Nenhuma gravacao realizada."
    }
    $m = $matches[0]
    $Text = $Text.Remove($m.Index, $m.Length).Insert($m.Index, $Replacement)
    return [pscustomobject]@{ Text = $Text; Count = 1 }
}

# ---------------------------------------------------------------------------
# 1. CSS da IA: substitui o bloco visual inteiro por uma versao baseada em tokens.
# ---------------------------------------------------------------------------
$css = @'
.nexus-root{height:100dvh;width:100%;background:var(--nx-canvas);color:var(--nx-ink);display:flex;font-family:Inter,system-ui,sans-serif;overflow:hidden;position:relative;isolation:isolate}
.nexus-root .nexus-bg{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.nexus-root .nexus-bg-a{position:absolute;top:-128px;left:50%;transform:translateX(-50%);width:900px;height:600px;background:color-mix(in srgb,var(--nx-accent) 12%,transparent);filter:blur(140px);border-radius:999px}
.nexus-root .nexus-bg-b{position:absolute;bottom:-128px;left:-128px;width:600px;height:600px;background:color-mix(in srgb,var(--nx-accent-2) 10%,transparent);filter:blur(140px);border-radius:999px}
.nexus-root .sidebar{width:300px;min-width:300px;background:var(--nx-surface);color:var(--nx-ink);border-right:1px solid var(--nx-border);display:flex;flex-direction:column;transition:transform .3s;z-index:20}
.nexus-root .sidebar.closed{transform:translateX(-100%);position:absolute;left:0;top:0;bottom:0}
.nexus-root .sidebar-header{padding:20px;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between}
.nexus-root .pill{border-radius:999px;border:1px solid var(--nx-border);background:var(--nx-surface-2);color:var(--nx-ink-2);padding:8px 16px;font-size:13px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .2s}
.nexus-root .pill:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.02)}
.nexus-root .pill:active{transform:scale(.98)}
.nexus-root .nav-btn{width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:var(--nx-ink-2);font-size:13px;cursor:pointer;text-align:left;transition:all .2s}
.nexus-root .nav-btn:hover{background:var(--nx-surface-2);color:var(--nx-ink)}
.nexus-root .nav-btn.active{background:var(--nx-accent);color:var(--nx-ink);font-weight:600}
.nexus-root .main{flex:1;display:flex;flex-direction:column;position:relative;min-width:0;overflow:hidden;z-index:1}
.nexus-root .header{height:56px;flex-shrink:0;border-bottom:1px solid var(--nx-border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:color-mix(in srgb,var(--nx-surface) 90%,transparent);backdrop-filter:blur(12px);position:sticky;top:0;z-index:10}
.nexus-root .icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--nx-border);background:var(--nx-surface-2);display:grid;place-items:center;cursor:pointer;transition:all .2s;color:var(--nx-ink-2)}
.nexus-root .icon-btn:hover{background:var(--nx-surface-3);transform:scale(1.05);color:var(--nx-ink)}
.nexus-root .icon-btn:active{transform:scale(.95)}
.nexus-root .chat-area{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:0 16px}
.nexus-root .chat-inner{max-width:760px;margin:0 auto;padding:32px 0}
.nexus-root .bubble-user{max-width:80%;margin-left:auto;background:var(--nx-accent);color:var(--nx-ink);border-radius:24px;border-bottom-right-radius:8px;padding:14px 18px;font-size:14px;line-height:1.5;animation:pop .2s ease;box-shadow:0 4px 14px color-mix(in srgb,var(--nx-accent) 25%,transparent)}
.nexus-root .bubble-ai{max-width:80%;background:var(--nx-surface-2);border:1px solid var(--nx-border);border-radius:24px;border-bottom-left-radius:8px;padding:16px 18px;font-size:14px;line-height:1.6;color:var(--nx-ink);animation:pop .2s ease;white-space:pre-wrap}
.nexus-root .bubble-ai.erro{background:color-mix(in srgb,var(--nx-red) 10%,var(--nx-surface));border-color:color-mix(in srgb,var(--nx-red) 30%,var(--nx-border));color:var(--nx-red)}
@keyframes pop{from{transform:scale(.95);opacity:0}to{transform:scale(1);opacity:1}}
.nexus-root .input-wrap{position:relative;flex-shrink:0;left:0;right:0;padding:16px;background:linear-gradient(to top,var(--nx-canvas) 50%,color-mix(in srgb,var(--nx-canvas) 88%,transparent),transparent)}
.nexus-root .input-pill{max-width:760px;margin:0 auto;height:62px;border-radius:28px;background:var(--nx-surface);border:1px solid var(--nx-border);display:flex;align-items:center;gap:10px;padding:0 10px;box-shadow:var(--nx-shadow-pop)}
.nexus-root .input-pill:focus-within{border-color:var(--nx-accent)}
.nexus-root .circle-btn{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;cursor:pointer;flex-shrink:0;transition:all .2s;border:none}
.nexus-root .circle-btn:hover{transform:scale(1.06)}
.nexus-root .circle-btn:active{transform:scale(.92)}
.nexus-root .circle-plus,.nexus-root .circle-mic{background:var(--nx-surface-2);color:var(--nx-ink-2)}
.nexus-root .circle-plus:hover,.nexus-root .circle-mic:hover{background:var(--nx-surface-3);color:var(--nx-ink)}
.nexus-root .circle-mic.rec{background:color-mix(in srgb,var(--nx-red) 16%,transparent);color:var(--nx-red);box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent);animation:pulse 1.2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--nx-red) 10%,transparent)}100%{box-shadow:0 0 0 2px color-mix(in srgb,var(--nx-red) 40%,transparent)}}
.nexus-root .circle-send,.nexus-root .circle-waves{background:var(--nx-accent);color:var(--nx-ink);box-shadow:0 6px 18px color-mix(in srgb,var(--nx-accent) 30%,transparent)}
.nexus-root .circle-send:hover,.nexus-root .circle-waves:hover{background:var(--nx-accent-2);box-shadow:0 8px 24px color-mix(in srgb,var(--nx-accent) 38%,transparent)}
.nexus-root .chat-input{flex:1;background:transparent;border:none;outline:none;color:var(--nx-ink);font-size:15px;min-width:0}
.nexus-root .chat-input::placeholder{color:var(--nx-ink-3)}

/* Modo Voz */
.nexus-root .voice-mode-overlay{position:absolute;inset:0;background:radial-gradient(circle at center,var(--nx-surface-2) 0%,var(--nx-canvas) 75%);z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:24px 20px 40px;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:scale(.98)}to{opacity:1;transform:scale(1)}}
.nexus-root .voice-topbar{width:100%;max-width:800px;display:flex;align-items:center;justify-content:space-between}
.nexus-root .voice-badge{display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:13px;font-weight:500;color:var(--nx-ink-2)}
.nexus-root .voice-dot{width:8px;height:8px;border-radius:999px;background:var(--nx-accent-2);box-shadow:0 0 10px var(--nx-accent-2);animation:blink 1.5s infinite}
.nexus-root .voice-dot.speaking{background:var(--nx-accent);box-shadow:0 0 12px var(--nx-accent)}
.nexus-root .voice-dot.listening{background:var(--nx-green);box-shadow:0 0 12px var(--nx-green)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.nexus-root .voice-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:680px;padding:20px 0;width:100%}
.nexus-root .wave-orb-container{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center;margin-bottom:32px}
.nexus-root .wave-ring{position:absolute;border-radius:999px;border:2px solid color-mix(in srgb,var(--nx-accent) 28%,transparent);pointer-events:none}
.nexus-root .wave-ring-1{width:140px;height:140px;animation:wavePulse1 2.8s cubic-bezier(.2,.8,.2,1) infinite}
.nexus-root .wave-ring-2{width:200px;height:200px;animation:wavePulse2 2.8s cubic-bezier(.2,.8,.2,1) infinite .5s}
.nexus-root .wave-ring-3{width:260px;height:260px;animation:wavePulse3 2.8s cubic-bezier(.2,.8,.2,1) infinite 1s}
@keyframes wavePulse1{0%{transform:scale(.8);opacity:.8}50%{transform:scale(1.1);opacity:.3}100%{transform:scale(.8);opacity:.8}}
@keyframes wavePulse2{0%{transform:scale(.75);opacity:.5}50%{transform:scale(1.2);opacity:.15}100%{transform:scale(.75);opacity:.5}}
@keyframes wavePulse3{0%{transform:scale(.7);opacity:.3}50%{transform:scale(1.25);opacity:.05}100%{transform:scale(.7);opacity:.3}}
.nexus-root .wave-core{width:110px;height:110px;border-radius:999px;background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);display:grid;place-items:center;color:var(--nx-ink);box-shadow:0 0 50px color-mix(in srgb,var(--nx-accent) 38%,transparent),0 0 90px color-mix(in srgb,var(--nx-accent-2) 24%,transparent);z-index:2;cursor:pointer;transition:all .3s}
.nexus-root .wave-core.speaking{background:linear-gradient(135deg,var(--nx-accent) 0%,var(--nx-accent-2) 100%);box-shadow:0 0 60px color-mix(in srgb,var(--nx-accent) 40%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 30%,transparent);animation:speakingBeat 1.2s ease-in-out infinite}
.nexus-root .wave-core.thinking{background:linear-gradient(135deg,var(--nx-accent-2) 0%,var(--nx-accent) 100%);animation:rotateGlow 3s linear infinite}
.nexus-root .wave-core.listening{box-shadow:0 0 60px color-mix(in srgb,var(--nx-green) 35%,transparent),0 0 100px color-mix(in srgb,var(--nx-accent-2) 22%,transparent)}
@keyframes speakingBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes rotateGlow{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}
.nexus-root .voice-status-title{font-size:22px;font-weight:600;letter-spacing:-.02em;margin-bottom:12px;color:var(--nx-ink)}
.nexus-root .voice-transcript-box{max-height:160px;overflow-y:auto;width:100%;padding:14px 20px;border-radius:18px;background:var(--nx-surface-2);border:1px solid var(--nx-border);font-size:15px;line-height:1.6;color:var(--nx-ink-2)}
.nexus-root .voice-transcript-user{color:var(--nx-accent-ink);font-weight:500;margin-bottom:8px;font-size:14px}
.nexus-root .voice-transcript-ai{color:var(--nx-ink);font-size:15px}
.nexus-root .voice-controls{display:flex;align-items:center;gap:24px}
.nexus-root .voice-btn-subtle{width:50px;height:50px;border-radius:999px;background:var(--nx-surface-2);border:1px solid var(--nx-border);display:grid;place-items:center;color:var(--nx-ink-2);cursor:pointer;transition:all .2s}
.nexus-root .voice-btn-subtle:hover{background:var(--nx-surface-3);color:var(--nx-ink);transform:scale(1.05)}
.nexus-root .voice-btn-end{width:64px;height:64px;border-radius:999px;background:var(--nx-red);border:none;display:grid;place-items:center;color:var(--nx-ink);cursor:pointer;box-shadow:0 8px 24px color-mix(in srgb,var(--nx-red) 30%,transparent);transition:all .2s}
.nexus-root .voice-btn-end:hover{transform:scale(1.08);background:var(--nx-red);box-shadow:0 12px 30px color-mix(in srgb,var(--nx-red) 42%,transparent)}
.nexus-root .voice-btn-end:active{transform:scale(.94)}
@media(max-width:768px){
  .nexus-root .sidebar{position:fixed;left:0;top:0;bottom:0;transform:translateX(-100%)}
  .nexus-root .sidebar.open{transform:translateX(0)}
  .nexus-root .main{width:100%}
  .nexus-root .wave-orb-container{width:200px;height:200px}
}
@media(prefers-reduced-motion:reduce){
  .nexus-root .wave-ring,.nexus-root .voice-dot,.nexus-root .circle-mic.rec,.nexus-root .wave-core.speaking,.nexus-root .wave-core.thinking{animation:none!important}
}
'@

$styleBlock = '<style>{`' + [Environment]::NewLine + $css + [Environment]::NewLine + '      `}</style>'
$r = Replace-RegexBlock -Text $work -Pattern '(?s)<style>\{`(?<css>.*?)`\}</style>' -Replacement $styleBlock -Name 'CSS principal da IA'
$work = $r.Text; $log.Add("CSS principal: $($r.Count) bloco substituido")

# ---------------------------------------------------------------------------
# 2. Constantes de design system.
# ---------------------------------------------------------------------------
$constOps = @(
    @{ Name='CARD'; Pattern='(?m)^const CARD = .*;$'; New="const CARD = 'rounded-[20px] bg-[var(--nx-surface)] border border-[var(--nx-border)] min-w-0';" },
    @{ Name='BTN_PRIMARIO'; Pattern='(?m)^const BTN_PRIMARIO = .*;$'; New="const BTN_PRIMARIO = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-bold text-[var(--nx-ink)] bg-[var(--nx-accent)] hover:bg-[var(--nx-accent-2)] active:scale-[0.98] transition-all shadow-[var(--nx-shadow-pop)] disabled:opacity-50 disabled:cursor-not-allowed';" },
    @{ Name='BTN_SECUNDARIO'; Pattern='(?m)^const BTN_SECUNDARIO = .*;$'; New="const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-semibold text-[var(--nx-ink-2)] bg-[var(--nx-surface-2)] border border-[var(--nx-border)] hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed';" },
    @{ Name='BTN_ICONO'; Pattern='(?m)^const BTN_ICONO = .*;$'; New="const BTN_ICONO = 'w-8 h-8 rounded-[10px] grid place-items-center text-[var(--nx-ink-3)] border border-transparent hover:text-[var(--nx-ink)] hover:bg-[var(--nx-surface-2)] hover:border-[var(--nx-border)] transition';" },
    @{ Name='FIELD'; Pattern='(?m)^const FIELD = .*;$'; New="const FIELD = 'w-full h-11 px-4 rounded-[12px] bg-[var(--nx-surface-2)] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] outline-none transition focus:border-[var(--nx-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nx-accent)_20%,transparent)]';" },
    @{ Name='ROTULO'; Pattern='(?m)^const ROTULO = .*;$'; New="const ROTULO = 'text-[10px] uppercase tracking-[0.16em] text-[var(--nx-ink-3)] font-bold';" }
)
foreach ($op in $constOps) {
    $r = Replace-RegexBlock -Text $work -Pattern $op.Pattern -Replacement $op.New -Name $op.Name
    $work = $r.Text; $log.Add("Constante $($op.Name): substituida")
}

# Niveis e toasts passam a usar cores semanticas (inclusive baixa prioridade).
$nivelNovo = @'
const NIVEL: Record<Prioridade, { label: string; chip: string; ponto: string }> = {
  CRITICA: {
    label: 'CRÍTICO',
    chip: 'bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)] border-[color-mix(in_srgb,var(--nx-red)_25%,var(--nx-border))] text-[var(--nx-red)]',
    ponto: 'bg-[var(--nx-red)]',
  },
  ALTA: {
    label: 'ALTO',
    chip: 'bg-[color-mix(in_srgb,var(--nx-amber)_10%,transparent)] border-[color-mix(in_srgb,var(--nx-amber)_25%,var(--nx-border))] text-[var(--nx-amber)]',
    ponto: 'bg-[var(--nx-amber)]',
  },
  MEDIA: {
    label: 'MÉDIO',
    chip: 'bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)] border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))] text-[var(--nx-green)]',
    ponto: 'bg-[var(--nx-green)]',
  },
  BAIXA: {
    label: 'BAIXO',
    chip: 'bg-[var(--nx-surface-2)] border-[var(--nx-border)] text-[var(--nx-ink-3)]',
    ponto: 'bg-[var(--nx-ink-3)]',
  },
};
'@
$r = Replace-RegexBlock -Text $work -Pattern '(?s)const NIVEL: Record<Prioridade, \{ label: string; chip: string; ponto: string \}> = \{.*?\r?\n\};' -Replacement $nivelNovo -Name 'NIVEL'
$work = $r.Text; $log.Add('NIVEL: substituido')

$tipoPadraoNovo = "const TIPO_PADRAO = { label: 'Alerta', icone: AlertTriangle, cor: 'var(--nx-accent)' };"
$r = Replace-RegexBlock -Text $work -Pattern '(?m)^const TIPO_PADRAO = .*;$' -Replacement $tipoPadraoNovo -Name 'TIPO_PADRAO'
$work = $r.Text; $log.Add('TIPO_PADRAO: substituido')

$toastNovo = @'
const TOAST_ESTILO: Record<ToastTipo, { borda: string; barra: string; icone: Icone }> = {
  sucesso: { borda: 'border-[color-mix(in_srgb,var(--nx-green)_30%,var(--nx-border))]', barra: 'bg-[var(--nx-green)]', icone: CheckCircle2 },
  alerta: { borda: 'border-[color-mix(in_srgb,var(--nx-amber)_30%,var(--nx-border))]', barra: 'bg-[var(--nx-amber)]', icone: AlertTriangle },
  erro: { borda: 'border-[color-mix(in_srgb,var(--nx-red)_35%,var(--nx-border))]', barra: 'bg-[var(--nx-red)]', icone: X },
};
'@
$r = Replace-RegexBlock -Text $work -Pattern '(?s)const TOAST_ESTILO: Record<ToastTipo, \{ borda: string; barra: string; icone: Icone \}> = \{.*?\r?\n\};' -Replacement $toastNovo -Name 'TOAST_ESTILO'
$work = $r.Text; $log.Add('TOAST_ESTILO: substituido')

# ---------------------------------------------------------------------------
# 3. Estilos inline dinamicos: hex + alpha vira color-mix, compativel com tokens.
# ---------------------------------------------------------------------------
$dynamicOps = @(
    @{ Name='Fundo dos icones de opcoes SE/ENTAO'; Before='`${op.cor}${ativo ? ''22'' : ''14''}`'; After='`color-mix(in srgb, ${op.cor} ${ativo ? ''14%'' : ''8%''}, transparent)`'; Expected=2 },
    @{ Name='Borda dos icones de opcoes SE/ENTAO'; Before='`${op.cor}${ativo ? ''55'' : ''30''}`'; After='`color-mix(in srgb, ${op.cor} ${ativo ? ''40%'' : ''24%''}, var(--nx-border))`'; Expected=2 },
    @{ Name='Fundo dos icones KPI'; Before='`${kpi.cor}1A`'; After='`color-mix(in srgb, ${kpi.cor} 10%, transparent)`'; Expected=1 },
    @{ Name='Borda dos icones KPI'; Before='`${kpi.cor}33`'; After='`color-mix(in srgb, ${kpi.cor} 25%, var(--nx-border))`'; Expected=1 },
    @{ Name='Fundo dos icones de alerta'; Before='`${meta.cor}1A`'; After='`color-mix(in srgb, ${meta.cor} 10%, transparent)`'; Expected=1 },
    @{ Name='Borda dos icones de alerta'; Before='`${meta.cor}33`'; After='`color-mix(in srgb, ${meta.cor} 25%, var(--nx-border))`'; Expected=1 },
    @{ Name='Fundo dos icones de regra'; Before='`${cor}1A`'; After='`color-mix(in srgb, ${cor} 10%, transparent)`'; Expected=1 },
    @{ Name='Borda dos icones de regra'; Before='`${cor}33`'; After='`color-mix(in srgb, ${cor} 25%, var(--nx-border))`'; Expected=1 },
    @{ Name='Fallback de cor de regra'; Before="const cor = opcao?.cor ?? '#6C5CE7';"; After="const cor = opcao?.cor ?? 'var(--nx-accent)';"; Expected=1 }
)
foreach ($op in $dynamicOps) {
    $r = Replace-Literal -Text $work -Before $op.Before -After $op.After -Name $op.Name -Expected $op.Expected -Required
    $work = $r.Text; $log.Add("$($op.Name): $($r.Count) ocorrencia(s)")
}

# Paleta das definicoes de tipos, opcoes de SE/ENTAO e KPIs.
$colorStringOps = @(
    @{ Before="'#FF5A5F'"; After="'var(--nx-red)'"; Name='Vermelho semantico' },
    @{ Before="'#FFB020'"; After="'var(--nx-amber)'"; Name='Ambar semantico' },
    @{ Before="'#6C5CE7'"; After="'var(--nx-accent)'"; Name='Acento semantico' },
    @{ Before="'#22C55E'"; After="'var(--nx-green)'"; Name='Verde semantico' },
    @{ Before="'#38BDF8'"; After="'var(--nx-accent-2)'"; Name='Azul semantico' }
)
foreach ($op in $colorStringOps) {
    $r = Replace-Literal -Text $work -Before $op.Before -After $op.After -Name $op.Name
    $work = $r.Text; if ($r.Count -gt 0) { $log.Add("$($op.Name): $($r.Count) valor(es)") }
}

# ---------------------------------------------------------------------------
# 4. Classes Tailwind hardcoded: superfícies, texto, bordas e feedbacks.
# ---------------------------------------------------------------------------
$classOps = @(
    @{ Before='min-h-full bg-[#0D0D14] text-white font-[''Inter'',sans-serif] -m-6 lg:-m-6'; After='min-h-full bg-[var(--nx-canvas)] text-[var(--nx-ink)] font-[''Inter'',sans-serif] -m-6 lg:-m-6'; Name='Fundo principal da IA' },
    @{ Before='bg-[#0D0D14]/80'; After='bg-[color-mix(in_srgb,var(--nx-surface-2)_80%,transparent)]'; Name='Rodape do modal' },
    @{ Before='bg-[#0D0D14]'; After='bg-[var(--nx-surface-2)]'; Name='Superficie escura D0D0' },
    @{ Before='bg-[#12121F]'; After='bg-[var(--nx-surface-2)]'; Name='Superficie escura 12121F' },
    @{ Before='bg-[#151528]'; After='bg-[var(--nx-surface)]'; Name='Superficie escura 151528' },
    @{ Before='border-[#12121F]'; After='border-[var(--nx-surface-2)]'; Name='Borda do marcador de notificacao' },
    @{ Before='bg-white/20'; After='bg-[var(--nx-border-strong)]'; Name='Indicador de notificacao lida' },
    @{ Before='focus:border-[#6C5CE7]/50'; After='focus:border-[var(--nx-accent)]'; Name='Foco do parametro da regra' },
    @{ Before='shadow-[0_16px_40px_rgba(0,0,0,0.55)]'; After='shadow-[var(--nx-shadow-pop)]'; Name='Sombra do toast' },
    @{ Before='bg-[#6C5CE7]/15'; After='bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)]'; Name='Acento suave' },
    @{ Before='border-[#6C5CE7]/40'; After='border-[color-mix(in_srgb,var(--nx-accent)_40%,var(--nx-border))]'; Name='Borda de selecao' },
    @{ Before='bg-[#6C5CE7]'; After='bg-[var(--nx-accent)]'; Name='Fundo de destaque' },
    @{ Before='hover:bg-[#7A6EF0]'; After='hover:bg-[var(--nx-accent-2)]'; Name='Hover de destaque' },
    @{ Before='text-[#0D0D14]'; After='text-[var(--nx-ink)]'; Name='Texto sobre destaque' },
    @{ Before='text-[#A99CFF]'; After='text-[var(--nx-accent-ink)]'; Name='Texto de acento' },
    @{ Before='bg-[#FF5A5F]/10'; After='bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)]'; Name='Fundo de erro' },
    @{ Before='border-[#FF5A5F]/25'; After='border-[color-mix(in_srgb,var(--nx-red)_25%,var(--nx-border))]'; Name='Borda de erro' },
    @{ Before='text-[#FF8A8E]'; After='text-[var(--nx-red)]'; Name='Texto de erro' },
    @{ Before='text-[#FF5A5F]'; After='text-[var(--nx-red)]'; Name='Icone de erro' },
    @{ Before='bg-[#22C55E]/10'; After='bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)]'; Name='Fundo de sucesso' },
    @{ Before='border-[#22C55E]/25'; After='border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))]'; Name='Borda de sucesso' },
    @{ Before='text-[#6EE7A0]'; After='text-[var(--nx-green)]'; Name='Texto de sucesso' },
    @{ Before='text-[#22C55E]'; After='text-[var(--nx-green)]'; Name='Icone de sucesso' },
    @{ Before='bg-[#38BDF8]/10'; After='bg-[color-mix(in_srgb,var(--nx-accent-2)_10%,transparent)]'; Name='Fundo de informacao' },
    @{ Before='border-[#38BDF8]/25'; After='border-[color-mix(in_srgb,var(--nx-accent-2)_25%,var(--nx-border))]'; Name='Borda de informacao' },
    @{ Before='text-[#38BDF8]'; After='text-[var(--nx-accent-ink)]'; Name='Texto de informacao' },
    @{ Before='rounded-2xl bg-gradient-to-br from-[#1A1A2E] to-[#12121F] border border-white/[0.08] p-4 space-y-3'; After='rounded-2xl bg-[var(--nx-surface-2)] border border-[var(--nx-border)] p-4 space-y-3'; Name='Preview da regra' },
    @{ Before='bg-[#12121F] border border-white/10 text-[11.5px] font-medium text-white/80'; After='bg-[var(--nx-surface)] border border-[var(--nx-border)] text-[11.5px] font-medium text-[var(--nx-ink-2)]'; Name='Pill de condicao no preview' },
    @{ Before='bg-[#12121F] border border-white/10 text-[11.5px] font-medium'; After='bg-[var(--nx-surface)] border border-[var(--nx-border)] text-[11.5px] font-medium'; Name='Pill de acao no preview' },
    @{ Before='bg-white/[0.03]'; After='bg-[var(--nx-surface-2)]'; Name='Superficie discreta 03' },
    @{ Before='bg-white/[0.06]'; After='bg-[var(--nx-surface-2)]'; Name='Superficie discreta 06' },
    @{ Before='bg-white/[0.08]'; After='bg-[var(--nx-surface-2)]'; Name='Superficie discreta 08' },
    @{ Before='bg-white/[0.10]'; After='bg-[var(--nx-surface-3)]'; Name='Superficie discreta 10' },
    @{ Before='bg-white/10'; After='bg-[var(--nx-surface-3)]'; Name='Superficie discreta 10 sem bracket' },
    @{ Before='hover:bg-white/[0.06]'; After='hover:bg-[var(--nx-surface-3)]'; Name='Hover discreto 06' },
    @{ Before='hover:bg-white/[0.10]'; After='hover:bg-[var(--nx-surface-3)]'; Name='Hover discreto 10' },
    @{ Before='hover:bg-white/10'; After='hover:bg-[var(--nx-surface-3)]'; Name='Hover discreto sem bracket' },
    @{ Before='border-white/[0.06]'; After='border-[var(--nx-border)]'; Name='Borda discreta 06' },
    @{ Before='border-white/[0.07]'; After='border-[var(--nx-border)]'; Name='Borda discreta 07' },
    @{ Before='border-white/[0.08]'; After='border-[var(--nx-border)]'; Name='Borda discreta 08' },
    @{ Before='border-white/[0.12]'; After='border-[var(--nx-border-strong)]'; Name='Borda discreta 12' },
    @{ Before='border-white/10'; After='border-[var(--nx-border)]'; Name='Borda discreta 10' },
    @{ Before='border-white/15'; After='border-[var(--nx-border-strong)]'; Name='Borda discreta 15' },
    @{ Before='border-white/20'; After='border-[var(--nx-border-strong)]'; Name='Borda discreta 20' },
    @{ Before='hover:border-white/[0.12]'; After='hover:border-[var(--nx-border-strong)]'; Name='Hover borda discreta 12' },
    @{ Before='hover:border-white/15'; After='hover:border-[var(--nx-border-strong)]'; Name='Hover borda discreta 15' },
    @{ Before='hover:border-white/20'; After='hover:border-[var(--nx-border-strong)]'; Name='Hover borda discreta 20' }
)
foreach ($op in ($classOps | Sort-Object { $_.Before.Length } -Descending)) {
    $r = Replace-Literal -Text $work -Before $op.Before -After $op.After -Name $op.Name
    $work = $r.Text; if ($r.Count -gt 0) { $log.Add("$($op.Name): $($r.Count)") }
}

# Textos com opacidade branca: preservar hierarquia usando os tres niveis de tinta.
$textToneOps = @(
    @{ Before='text-white/90'; After='text-[var(--nx-ink)]' },
    @{ Before='text-white/85'; After='text-[var(--nx-ink)]' },
    @{ Before='text-white/80'; After='text-[var(--nx-ink)]' },
    @{ Before='text-white/70'; After='text-[var(--nx-ink-2)]' },
    @{ Before='text-white/60'; After='text-[var(--nx-ink-2)]' },
    @{ Before='text-white/50'; After='text-[var(--nx-ink-2)]' },
    @{ Before='text-white/40'; After='text-[var(--nx-ink-3)]' },
    @{ Before='text-white/35'; After='text-[var(--nx-ink-3)]' },
    @{ Before='text-white/30'; After='text-[var(--nx-ink-3)]' },
    @{ Before='text-white/25'; After='text-[var(--nx-ink-3)]' },
    @{ Before='text-white/20'; After='text-[var(--nx-ink-3)]' }
)
foreach ($op in $textToneOps) {
    $r = Replace-Literal -Text $work -Before $op.Before -After $op.After -Name $op.Before
    $work = $r.Text; if ($r.Count -gt 0) { $log.Add("$($op.Before): $($r.Count)") }
}

# Classes semanticas sem variantes de opacidade.
$standaloneRegexOps = @(
    @{ Pattern='(?<![A-Za-z0-9_-])text-white(?![A-Za-z0-9_/-])'; Replacement='text-[var(--nx-ink)]'; Name='text-white sem opacidade' },
    @{ Pattern='(?<![A-Za-z0-9_-])text-black(?![A-Za-z0-9_/-])'; Replacement='text-[var(--nx-ink)]'; Name='text-black' },
    @{ Pattern='(?<![A-Za-z0-9_-])bg-white(?![A-Za-z0-9_/-])'; Replacement='bg-[var(--nx-accent)]'; Name='bg-white' },
    @{ Pattern='(?<![A-Za-z0-9_-])hover:text-white(?![A-Za-z0-9_/-])'; Replacement='hover:text-[var(--nx-ink)]'; Name='hover:text-white' }
)
foreach ($op in $standaloneRegexOps) {
    $regex = [regex]::new($op.Pattern)
    $count = $regex.Matches($work).Count
    if ($count -gt 0) { $work = $regex.Replace($work, $op.Replacement) }
    $log.Add("$($op.Name): $count")
}

# ---------------------------------------------------------------------------
# 5. Estilos inline do JSX (logo, busca, recentes e seletor do Modo Voz).
# ---------------------------------------------------------------------------
$inlineOps = @(
    @{ Before='background: "white"'; After='background: "var(--nx-accent)"'; Name='Fundo dos simbolos e botao de nova conversa' },
    @{ Before='color: "black"'; After='color: "var(--nx-ink)"'; Name='Texto dos simbolos e botao de nova conversa' },
    @{ Before='color: "#a1a1aa"'; After='color: "var(--nx-ink-3)"'; Name='Rotulos secundarias inline' },
    @{ Before='color: "#71717a"'; After='color: "var(--nx-ink-3)"'; Name='Icones e textos discretos inline' },
    @{ Before='background: "#1c1c1f"'; After='background: "var(--nx-surface-2)"'; Name='Campo de busca lateral inline' },
    @{ Before='background: "#1a1a1d"'; After='background: "var(--nx-surface-2)"'; Name='Cartoes de recentes inline' },
    @{ Before='border: "1px solid rgba(255,255,255,.08)"'; After='border: "1px solid var(--nx-border)"'; Name='Borda do campo de busca inline' },
    @{ Before='border: "1px solid rgba(255,255,255,.06)"'; After='border: "1px solid var(--nx-border)"'; Name='Borda dos itens recentes inline' },
    @{ Before='border: "1px dashed rgba(255,255,255,.12)"'; After='border: "1px dashed var(--nx-border-strong)"'; Name='Borda do estado vazio inline' },
    @{ Before='background: isVoiceMode ? "rgba(239,68,68,.15)" : "rgba(37,99,235,.15)"'; After='background: isVoiceMode ? "color-mix(in srgb,var(--nx-red) 15%,transparent)" : "color-mix(in srgb,var(--nx-accent) 15%,transparent)"'; Name='Fundo do seletor de Modo Voz' },
    @{ Before='borderColor: isVoiceMode ? "rgba(239,68,68,.3)" : "rgba(37,99,235,.3)"'; After='borderColor: isVoiceMode ? "color-mix(in srgb,var(--nx-red) 30%,var(--nx-border))" : "color-mix(in srgb,var(--nx-accent) 30%,var(--nx-border))"'; Name='Borda do seletor de Modo Voz' },
    @{ Before='color: isVoiceMode ? "#f87171" : "#60a5fa"'; After='color: isVoiceMode ? "var(--nx-red)" : "var(--nx-accent-ink)"'; Name='Texto do seletor de Modo Voz' },
    @{ Before='color="#fff"'; After='color="var(--nx-ink)"'; Name='Icone de envio' },
    @{ Before='color="white"'; After='color="var(--nx-ink)"'; Name='Icone do botao de voz' }
)
foreach ($op in $inlineOps) {
    $r = Replace-Literal -Text $work -Before $op.Before -After $op.After -Name $op.Name
    $work = $r.Text; if ($r.Count -gt 0) { $log.Add("$($op.Name): $($r.Count)") }
}

# Validar que os marcadores funcionais continuam presentes e que a pagina foi preservada.
foreach ($obrigatorio in @(
    'api.post("/ia/perguntar"',
    'api/v1/tts',
    'recognitionRef.current',
    'handleSendMessage(transcript, "modo_voz")',
    'handleSendMessage(transcript, "audio")',
    'const SE_OPTIONS',
    'const ACAO_OPTIONS',
    'router.push("/")'
)) {
    if (-not $work.Contains($obrigatorio)) {
        throw "Auditoria funcional interrompida: marcador '$obrigatorio' nao foi preservado. Nenhuma gravacao realizada."
    }
}

if ($work -eq $conteudo) { throw 'Nenhuma alteracao visual foi produzida. Arquivo preservado.' }

# Auditoria final: nenhum hexadecimal/rgba fixo deve restar nesta pagina de interface.
$problemas = New-Object System.Collections.Generic.List[string]
if ([regex]::IsMatch($work, '#[0-9A-Fa-f]{3,8}\b')) { $problemas.Add('Ainda existe cor hexadecimal fixa.') }
if ([regex]::IsMatch($work, '\brgba?\s*\(')) { $problemas.Add('Ainda existe cor RGB/RGBA fixa.') }
if ($work.Contains('text-white/') -or $work.Contains('border-white/') -or $work.Contains('bg-white/')) { $problemas.Add('Ainda existe classe com branco fixo.') }
if ($work.Contains('bg-[#') -or $work.Contains('text-[#') -or $work.Contains('border-[#')) { $problemas.Add('Ainda existe classe Tailwind com cor hexadecimal fixa.') }
if ($problemas.Count -gt 0) {
    throw ("Auditoria visual interrompida. Nenhuma gravacao realizada:`n- " + ($problemas -join "`n- "))
}

# Evita sobrescrever edicoes paralelas realizadas enquanto o script preparava a mudanca.
$hashAtual = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
if ($hashAtual -ne $hashInicial) {
    throw 'O arquivo mudou durante a preparacao. Nenhuma gravacao realizada.'
}

# Backup integral, depois de toda a pre-validacao.
$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$pastaBackup = Join-Path $repo "backup-ia-nexus-tema-$carimbo"
New-Item -ItemType Directory -Path $pastaBackup | Out-Null
$backup = Join-Path $pastaBackup 'page.tsx'
Copy-Item -LiteralPath $arquivo -Destination $backup

try {
    [System.IO.File]::WriteAllText($arquivo, $work, $utf8)
    $verificacao = [System.IO.File]::ReadAllText($arquivo)

    foreach ($obrigatorio in @(
        'var(--nx-canvas)',
        'var(--nx-surface)',
        'var(--nx-ink)',
        'color-mix(in srgb',
        'api.post("/ia/perguntar"',
        'api/v1/tts',
        'recognitionRef.current'
    )) {
        if (-not $verificacao.Contains($obrigatorio)) {
            throw "Verificacao pos-gravacao falhou: '$obrigatorio' nao encontrado."
        }
    }
    if ([regex]::IsMatch($verificacao, '#[0-9A-Fa-f]{3,8}\b') -or [regex]::IsMatch($verificacao, '\brgba?\s*\(')) {
        throw 'Verificacao pos-gravacao encontrou cor fixa residual.'
    }

    $relativo = $arquivo.Substring($repo.Length).TrimStart('\','/')
    git diff --check -- $relativo
    if ($LASTEXITCODE -ne 0) { throw 'O Git encontrou problemas de whitespace.' }
}
catch {
    Copy-Item -LiteralPath $backup -Destination $arquivo -Force
    throw "Gravacao revertida automaticamente pelo backup. Motivo: $($_.Exception.Message)"
}

Write-Host "`nPADRONIZACAO VISUAL DA IA NEXUS APLICADA E VERIFICADA." -ForegroundColor Green
Write-Host "Arquivo: $arquivo" -ForegroundColor Cyan
Write-Host "Transformacoes registradas: $($log.Count)" -ForegroundColor Cyan
foreach ($linha in $log) { Write-Host "- $linha" }
Write-Host "Backup: $backup" -ForegroundColor Cyan

Write-Host "`nValidacao Git: concluida sem apontamentos." -ForegroundColor Yellow
Write-Host 'Concluido. APIs, estados, Gemini/TTS, reconhecimento de voz e logica foram preservados.' -ForegroundColor Green
