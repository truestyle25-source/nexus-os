# NEXUS OS - IA NEXUS: padronizacao de tema claro/escuro
# PowerShell 5.1+ | Executar na raiz do repositorio.
# Esta versao foi escrita para a pagina IA NEXUS de 947 linhas, sem constantes CARD/BTN/NIVEL que nao existem nela.
# Altera somente CSS e valores visuais; preserva Gemini, TTS, reconhecimento de voz, APIs e estado.

$ErrorActionPreference = 'Stop'

$repo = (Get-Location).Path
$frontendApp = Join-Path $repo 'frontend\app'
if (-not (Test-Path -LiteralPath $frontendApp -PathType Container)) {
    throw 'Execute na raiz do repositorio NEXUS OS (pasta que contem frontend\app).'
}

# Localiza a pagina pelo marcador exclusivo, sem depender de nomes presumidos.
$marcador = 'const shortcuts = ["Quanto vendi hoje?", "Estoque baixo?", "Resumo financeiro"];'
$alvos = @()
foreach ($item in Get-ChildItem -LiteralPath $frontendApp -Filter 'page.tsx' -Recurse -File) {
    $texto = [System.IO.File]::ReadAllText($item.FullName)
    if ($texto.Contains($marcador)) { $alvos += $item.FullName }
}
if ($alvos.Count -ne 1) {
    throw "Localizacao interrompida: esperava uma pagina IA NEXUS e encontrei $($alvos.Count). Nenhum arquivo alterado."
}

$arquivo = $alvos[0]
$hashInicial = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
$bytesOriginais = [System.IO.File]::ReadAllBytes($arquivo)
$temBom = ($bytesOriginais.Length -ge 3 -and $bytesOriginais[0] -eq 0xEF -and $bytesOriginais[1] -eq 0xBB -and $bytesOriginais[2] -eq 0xBF)
$utf8 = [System.Text.UTF8Encoding]::new($temBom)
$conteudoOriginal = [System.IO.File]::ReadAllText($arquivo)
$lineEnding = if ($conteudoOriginal.Contains("`r`n")) { "`r`n" } else { "`n" }
$work = [regex]::Replace($conteudoOriginal, '\r\n?', "`n")

# Confirma a estrutura real desta pagina antes de substituir o CSS.
$stylePattern = '(?s)<style>\{`.*?`}</style>'
$styleMatches = [regex]::Matches($work, $stylePattern)
if ($styleMatches.Count -ne 1) {
    throw "Pre-validacao interrompida: bloco CSS da IA - esperado 1, encontrado $($styleMatches.Count). Nenhuma gravacao realizada."
}
$cssAntigoAnchor = '.nexus-root{height:100dvh;width:100%;background:#08080a;color:#fafafa;display:flex;'
if (-not $work.Contains($cssAntigoAnchor)) {
    throw 'Pre-validacao interrompida: CSS atual nao corresponde a versao revisada. Nenhuma gravacao realizada.'
}

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

# O bloco abaixo substitui apenas o conteudo do <style> da pagina IA NEXUS.
$styleReplacement = '<style>{`' + "`n" + $css + "`n" + '      `}</style>'
$styleMatch = $styleMatches[0]
$work = $work.Remove($styleMatch.Index, $styleMatch.Length).Insert($styleMatch.Index, $styleReplacement)

# Substituicoes visuais literais. Min/Max permitem variacoes limitadas sem
# tornar a validacao permissiva; cada ocorrencia e registrada antes da gravacao.
$ops = @(
    # Estilos inline do logo, botoes, busca e recentes
    @{ Name='Fundos dos simbolos e botao Nova conversa'; Before='background: "white"'; After='background: "var(--nx-accent)"'; Min=2; Max=4 },
    @{ Name='Texto dos simbolos e botao Nova conversa'; Before='color: "black"'; After='color: "var(--nx-ink)"'; Min=2; Max=4 },
    @{ Name='Texto branco do campo de busca lateral'; Before='color: "white"'; After='color: "var(--nx-ink)"'; Min=1; Max=2 },
    @{ Name='Rotulos secundarios inline'; Before='color: "#a1a1aa"'; After='color: "var(--nx-ink-3)"'; Min=1; Max=3 },
    @{ Name='Textos e icones discretos inline'; Before='color: "#71717a"'; After='color: "var(--nx-ink-3)"'; Min=3; Max=7 },
    @{ Name='Fundo do campo de busca e badge Gemini'; Before='background: "#1c1c1f"'; After='background: "var(--nx-surface-2)"'; Min=1; Max=3 },
    @{ Name='Fundo dos estados vazios e itens recentes'; Before='background: "#1a1a1d"'; After='background: "var(--nx-surface-2)"'; Min=2; Max=4 },
    @{ Name='Borda do campo de busca inline'; Before='border: "1px solid rgba(255,255,255,.08)"'; After='border: "1px solid var(--nx-border)"'; Min=1; Max=1 },
    @{ Name='Borda dos itens recentes inline'; Before='border: "1px solid rgba(255,255,255,.06)"'; After='border: "1px solid var(--nx-border)"'; Min=1; Max=1 },
    @{ Name='Bordas tracejadas dos estados vazios'; Before='border: "1px dashed rgba(255,255,255,.12)"'; After='border: "1px dashed var(--nx-border-strong)"'; Min=2; Max=2 },

    # Seletor do Modo Voz no cabecalho
    @{ Name='Fundo condicional do seletor de voz'; Before='background: isVoiceMode ? "rgba(239,68,68,.15)" : "rgba(37,99,235,.15)"'; After='background: isVoiceMode ? "color-mix(in srgb,var(--nx-red) 15%,transparent)" : "color-mix(in srgb,var(--nx-accent) 15%,transparent)"'; Min=1; Max=1 },
    @{ Name='Borda condicional do seletor de voz'; Before='borderColor: isVoiceMode ? "rgba(239,68,68,.3)" : "rgba(37,99,235,.3)"'; After='borderColor: isVoiceMode ? "color-mix(in srgb,var(--nx-red) 30%,var(--nx-border))" : "color-mix(in srgb,var(--nx-accent) 30%,var(--nx-border))"'; Min=1; Max=1 },
    @{ Name='Texto condicional do seletor de voz'; Before='color: isVoiceMode ? "#f87171" : "#60a5fa"'; After='color: isVoiceMode ? "var(--nx-red)" : "var(--nx-accent-ink)"'; Min=1; Max=1 },
    @{ Name='Icones de envio e ondas'; Before='color="white"'; After='color="var(--nx-ink)"'; Min=2; Max=2 },

    # Paleta semantica das opcoes SE/ENTAO
    @{ Name='Vermelho semantico'; Before="'#FF5A5F'"; After="'var(--nx-red)'"; Min=3; Max=3 },
    @{ Name='Ambar semantico'; Before="'#FFB020'"; After="'var(--nx-amber)'"; Min=3; Max=3 },
    @{ Name='Acento semantico'; Before="'#6C5CE7'"; After="'var(--nx-accent)'"; Min=2; Max=2 },
    @{ Name='Verde semantico'; Before="'#22C55E'"; After="'var(--nx-green)'"; Min=2; Max=2 },
    @{ Name='Azul secundario semantico'; Before="'#38BDF8'"; After="'var(--nx-accent-2)'"; Min=1; Max=1 },
    @{ Name='Texto de acento nos indicadores selecionados'; Before='text-[#A99CFF]'; After='text-[var(--nx-accent-ink)]'; Min=2; Max=2 },

    # Cores dinamicas dos icones: converte sufixos hex para color-mix.
    @{ Name='Fundo dos icones SE/ENTAO'; Before='`${op.cor}${ativo ? ''22'' : ''14''}`'; After='`color-mix(in srgb, ${op.cor} ${ativo ? ''14%'' : ''8%''}, transparent)`'; Min=2; Max=2 },
    @{ Name='Borda dos icones SE/ENTAO'; Before='`${op.cor}${ativo ? ''55'' : ''30''}`'; After='`color-mix(in srgb, ${op.cor} ${ativo ? ''40%'' : ''24%''}, var(--nx-border))`'; Min=2; Max=2 },
    @{ Name='Fundo dos icones KPI'; Before='`${kpi.cor}1A`'; After='`color-mix(in srgb, ${kpi.cor} 10%, transparent)`'; Min=1; Max=1 },
    @{ Name='Borda dos icones KPI'; Before='`${kpi.cor}33`'; After='`color-mix(in srgb, ${kpi.cor} 25%, var(--nx-border))`'; Min=1; Max=1 },
    @{ Name='Fundo dos icones de alerta'; Before='`${meta.cor}1A`'; After='`color-mix(in srgb, ${meta.cor} 10%, transparent)`'; Min=1; Max=1 },
    @{ Name='Borda dos icones de alerta'; Before='`${meta.cor}33`'; After='`color-mix(in srgb, ${meta.cor} 25%, var(--nx-border))`'; Min=1; Max=1 },
    @{ Name='Fundo dos icones de regra'; Before='`${cor}1A`'; After='`color-mix(in srgb, ${cor} 10%, transparent)`'; Min=1; Max=1 },
    @{ Name='Borda dos icones de regra'; Before='`${cor}33`'; After='`color-mix(in srgb, ${cor} 25%, var(--nx-border))`'; Min=1; Max=1 }
)

$divergencias = New-Object System.Collections.Generic.List[string]
foreach ($op in $ops) {
    $count = [regex]::Matches($work, [regex]::Escape($op.Before)).Count
    $op.Count = $count
    if ($count -lt $op.Min -or $count -gt $op.Max) {
        $divergencias.Add("$($op.Name): esperado $($op.Min)-$($op.Max), encontrado $count")
    }
}
if ($divergencias.Count -gt 0) {
    Write-Host 'PRE-VALIDACAO INTERROMPIDA. NENHUMA ALTERACAO FOI FEITA.' -ForegroundColor Red
    foreach ($item in $divergencias) { Write-Host "- $item" -ForegroundColor Yellow }
    throw 'Revise as divergencias antes de qualquer gravacao.'
}

# Aplica em memoria somente depois de todos os grupos passarem na pre-validacao.
$log = New-Object System.Collections.Generic.List[string]
foreach ($op in $ops) {
    $work = $work.Replace($op.Before, $op.After)
    $log.Add("$($op.Name): $($op.Count)")
}

# Auditoria dos marcadores de funcionamento: apenas confirmacao, sem alteracao.
$marcadoresFuncionais = @(
    '"/ia/perguntar"',
    '/api/v1/tts',
    'recognitionRef.current',
    'handleSendMessage(transcript, "modo_voz")',
    'handleSendMessage(transcript, "audio")',
    'const [isVoiceMode, setIsVoiceMode] = useState(false);',
    'const [voiceStatus, setVoiceStatus]',
    'currentAudioRef',
    'SpeechRecognition',
    'router.push("/")'
)
foreach ($marker in $marcadoresFuncionais) {
    if (-not $work.Contains($marker)) {
        throw "Auditoria funcional interrompida: marcador '$marker' nao foi preservado. Nenhuma gravacao realizada."
    }
}

if ($work -eq [regex]::Replace($conteudoOriginal, '\r\n?', "`n")) {
    throw 'Nenhuma alteracao visual foi produzida. Arquivo preservado.'
}

# Auditoria final: nenhuma cor hexadecimal ou RGB fixa deve restar na pagina.
$problemas = New-Object System.Collections.Generic.List[string]
if ([regex]::IsMatch($work, '#[0-9A-Fa-f]{3,8}\b')) { $problemas.Add('Ainda existe cor hexadecimal fixa.') }
if ([regex]::IsMatch($work, '(?i)\brgba?\s*\(')) { $problemas.Add('Ainda existe cor RGB/RGBA fixa.') }
if ($work.Contains('background: "white"') -or $work.Contains('color: "black"') -or $work.Contains('color="white"')) {
    $problemas.Add('Ainda existe valor visual inline branco/preto fixo.')
}
if ($problemas.Count -gt 0) {
    throw ("Auditoria visual interrompida. Nenhuma gravacao realizada:`n- " + ($problemas -join "`n- "))
}

# Confirma que o arquivo local nao mudou durante a preparacao.
$hashAtual = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
if ($hashAtual -ne $hashInicial) {
    throw 'O arquivo mudou durante a preparacao. Nenhuma gravacao realizada.'
}

# Backup integral so depois de todas as pre-validacoes.
$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$pastaBackup = Join-Path $repo "backup-ia-nexus-tema-$carimbo"
New-Item -ItemType Directory -Path $pastaBackup | Out-Null
$backup = Join-Path $pastaBackup 'page.tsx'
Copy-Item -LiteralPath $arquivo -Destination $backup

try {
    $conteudoGravacao = if ($lineEnding -eq "`r`n") { $work.Replace("`n", "`r`n") } else { $work }
    [System.IO.File]::WriteAllText($arquivo, $conteudoGravacao, $utf8)

    $verificacao = [System.IO.File]::ReadAllText($arquivo)
    $verificacao = [regex]::Replace($verificacao, '\r\n?', "`n")
    foreach ($marker in @('var(--nx-canvas)', 'var(--nx-surface)', 'var(--nx-ink)', 'color-mix(in srgb', '/api/v1/tts', 'recognitionRef.current')) {
        if (-not $verificacao.Contains($marker)) { throw "Verificacao pos-gravacao falhou: '$marker' nao encontrado." }
    }
    if ([regex]::IsMatch($verificacao, '#[0-9A-Fa-f]{3,8}\b') -or [regex]::IsMatch($verificacao, '(?i)\brgba?\s*\(')) {
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
Write-Host "Grupos de substituicao: $($ops.Count)" -ForegroundColor Cyan
foreach ($item in $log) { Write-Host "- $item" }
Write-Host "Backup: $backup" -ForegroundColor Cyan
Write-Host "`nValidacao Git: concluida sem apontamentos." -ForegroundColor Yellow
Write-Host 'Concluido. Gemini, TTS, reconhecimento de voz, APIs e logica foram preservados.' -ForegroundColor Green
