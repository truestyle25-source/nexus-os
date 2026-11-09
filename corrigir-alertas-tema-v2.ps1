$ErrorActionPreference = 'Stop'

$path = '.\frontend\app\(dashboard)\alertas\page.tsx'
$arquivo = (Resolve-Path -LiteralPath $path).Path
$conteudo = [System.IO.File]::ReadAllText($arquivo)
$hashInicial = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
$bytesOriginais = [System.IO.File]::ReadAllBytes($arquivo)
$temBom = ($bytesOriginais.Length -ge 3 -and $bytesOriginais[0] -eq 0xEF -and $bytesOriginais[1] -eq 0xBB -and $bytesOriginais[2] -eq 0xBF)
$utf8 = [System.Text.UTF8Encoding]::new($temBom)

# Cada item identifica um trecho exato e a quantidade esperada nesta versao do arquivo.
# Se o arquivo divergir, o script interrompe antes do backup e da gravacao.
$substituicoes = @(
    # Design system compartilhado
    @{ Nome = 'CARD'; Esperado = 1; Antes = 'rounded-[20px] bg-[var(--nx-surface-3)] border border-white/[0.06] min-w-0'; Depois = 'rounded-[20px] bg-[var(--nx-surface)] border border-[var(--nx-border)] min-w-0' },
    @{ Nome = 'Botao primario'; Esperado = 1; Antes = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-bold text-white bg-[var(--nx-accent)] hover:bg-[var(--nx-accent-2)] active:scale-[0.98] transition-all shadow-[0_8px_24px_rgba(108,92,231,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed'; Depois = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-bold text-[var(--nx-ink)] bg-[var(--nx-accent)] hover:bg-[var(--nx-accent-2)] active:scale-[0.98] transition-all shadow-[var(--nx-shadow-pop)] disabled:opacity-50 disabled:cursor-not-allowed' },
    @{ Nome = 'Botao secundario'; Esperado = 1; Antes = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-semibold text-white/70 bg-white/[0.06] border border-white/[0.06] hover:bg-white/[0.10] hover:text-white active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed'; Depois = 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[12px] text-[12.5px] font-semibold text-[var(--nx-ink-2)] bg-[var(--nx-surface-2)] border border-[var(--nx-border)] hover:bg-[var(--nx-surface-3)] hover:text-[var(--nx-ink)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed' },
    @{ Nome = 'Botao icone'; Esperado = 1; Antes = 'w-8 h-8 rounded-[10px] grid place-items-center text-white/40 border border-transparent hover:text-white hover:bg-white/[0.06] hover:border-white/10 transition'; Depois = 'w-8 h-8 rounded-[10px] grid place-items-center text-[var(--nx-ink-3)] border border-transparent hover:text-[var(--nx-ink)] hover:bg-[var(--nx-surface-2)] hover:border-[var(--nx-border)] transition' },
    @{ Nome = 'Campo FIELD'; Esperado = 1; Antes = 'w-full h-11 px-4 rounded-[12px] bg-[#0D0D14] border border-white/[0.08] text-[13px] text-white placeholder:text-white/25 outline-none transition focus:border-[#6C5CE7]/50 focus:ring-2 focus:ring-[#6C5CE7]/20'; Depois = 'w-full h-11 px-4 rounded-[12px] bg-[var(--nx-surface-2)] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] outline-none transition focus:border-[var(--nx-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--nx-accent)_20%,transparent)]' },
    @{ Nome = 'Rotulos'; Esperado = 1; Antes = 'text-[10px] uppercase tracking-[0.16em] text-white/30 font-bold'; Depois = 'text-[10px] uppercase tracking-[0.16em] text-[var(--nx-ink-3)] font-bold' },

    # Cores semanticas da prioridade baixa e tipo desconhecido
    @{ Nome = 'Chip prioridade baixa'; Esperado = 1; Antes = "chip: 'bg-[var(--nx-surface-2)]/10 border-white/10 text-white/50'"; Depois = "chip: 'bg-[var(--nx-surface-2)] border-[var(--nx-border)] text-[var(--nx-ink-3)]'" },
    @{ Nome = 'Ponto prioridade baixa'; Esperado = 1; Antes = "ponto: 'bg-white/30'"; Depois = "ponto: 'bg-[var(--nx-ink-3)]'" },
    @{ Nome = 'Cor do tipo padrao'; Esperado = 1; Antes = "const TIPO_PADRAO = { label: 'Alerta', icone: AlertTriangle, cor: '#6C5CE7' };"; Depois = "const TIPO_PADRAO = { label: 'Alerta', icone: AlertTriangle, cor: 'var(--nx-accent)' };" },

    # Cores dos tipos de condicao e acao: os valores passam a ser tokens CSS.
    @{ Nome = 'Cores vermelhas das opcoes'; Esperado = 4; Antes = "cor: '#FF5A5F',"; Depois = "cor: 'var(--nx-red)'," },
    @{ Nome = 'Cores amber das opcoes'; Esperado = 4; Antes = "cor: '#FFB020',"; Depois = "cor: 'var(--nx-amber)'," },
    @{ Nome = 'Cores accent das opcoes'; Esperado = 3; Antes = "cor: '#6C5CE7',"; Depois = "cor: 'var(--nx-accent)'," },
    @{ Nome = 'Cor verde das opcoes'; Esperado = 2; Antes = "cor: '#22C55E',"; Depois = "cor: 'var(--nx-green)'," },
    @{ Nome = 'Cor azul do WhatsApp e KPI de nao lidas'; Esperado = 2; Antes = "cor: '#38BDF8',"; Depois = "cor: 'var(--nx-accent)'," },

    # Toasts
    @{ Nome = 'Borda toast sucesso'; Esperado = 1; Antes = "sucesso: { borda: 'border-[#22C55E]/30', barra: 'bg-[#22C55E]', icone: CheckCircle2 }"; Depois = "sucesso: { borda: 'border-[color-mix(in_srgb,var(--nx-green)_30%,var(--nx-border))]', barra: 'bg-[var(--nx-green)]', icone: CheckCircle2 }" },
    @{ Nome = 'Borda toast alerta'; Esperado = 1; Antes = "alerta: { borda: 'border-[#FFB020]/30', barra: 'bg-[#FFB020]', icone: AlertTriangle }"; Depois = "alerta: { borda: 'border-[color-mix(in_srgb,var(--nx-amber)_30%,var(--nx-border))]', barra: 'bg-[var(--nx-amber)]', icone: AlertTriangle }" },
    @{ Nome = 'Borda toast erro'; Esperado = 1; Antes = "erro: { borda: 'border-[#FF5A5F]/35', barra: 'bg-[#FF5A5F]', icone: X }"; Depois = "erro: { borda: 'border-[color-mix(in_srgb,var(--nx-red)_35%,var(--nx-border))]', barra: 'bg-[var(--nx-red)]', icone: X }" },
    @{ Nome = 'Cartao toast'; Esperado = 1; Antes = 'nx-toast relative overflow-hidden text-left rounded-[14px] border ${estilo.borda} bg-[#151528] shadow-[0_16px_40px_rgba(0,0,0,0.55)] px-4 py-3'; Depois = 'nx-toast relative overflow-hidden text-left rounded-[14px] border ${estilo.borda} bg-[var(--nx-surface)] shadow-[var(--nx-shadow-pop)] px-4 py-3' },
    @{ Nome = 'Icone toast'; Esperado = 1; Antes = 'w-4 h-4 shrink-0 mt-[1px] text-white/70'; Depois = 'w-4 h-4 shrink-0 mt-[1px] text-[var(--nx-ink-2)]' },
    @{ Nome = 'Texto toast'; Esperado = 1; Antes = 'text-[12.5px] text-white/90 leading-snug flex-1'; Depois = 'text-[12.5px] text-[var(--nx-ink)] leading-snug flex-1' },

    # Modal: painel, cabecalho, controles, selecoes e preview
    @{ Nome = 'Fundo do modal'; Esperado = 1; Antes = 'nx-modal relative w-full max-w-[660px] max-h-[88vh] rounded-[24px] bg-[#151528] border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden'; Depois = 'nx-modal relative w-full max-w-[660px] max-h-[88vh] rounded-[24px] bg-[var(--nx-surface)] border border-[var(--nx-border)] shadow-2xl flex flex-col overflow-hidden' },
    @{ Nome = 'Titulo modal regra'; Esperado = 1; Antes = 'text-[17px] font-bold text-white tracking-tight mt-1.5'; Depois = 'text-[17px] font-bold text-[var(--nx-ink)] tracking-tight mt-1.5' },
    @{ Nome = 'Descricao modal regra'; Esperado = 1; Antes = 'text-[12.5px] text-white/50 mt-1'; Depois = 'text-[12.5px] text-[var(--nx-ink-2)] mt-1' },
    @{ Nome = 'Paineis SE e ENTAO'; Esperado = 2; Antes = 'rounded-2xl bg-[#0D0D14] border border-white/[0.07] p-4 space-y-4'; Depois = 'rounded-2xl bg-[var(--nx-surface-2)] border border-[var(--nx-border)] p-4 space-y-4' },
    @{ Nome = 'Pildoras SE no modal e preview'; Esperado = 2; Antes = 'px-2.5 py-1 rounded-full bg-white text-[#0D0D14] font-bold text-[10px] tracking-[0.16em]'; Depois = 'px-2.5 py-1 rounded-full bg-[var(--nx-accent)] text-[var(--nx-ink)] font-bold text-[10px] tracking-[0.16em]' },
    @{ Nome = 'Descricao SE e ENTAO'; Esperado = 2; Antes = 'text-[12px] text-white/50'; Depois = 'text-[12px] text-[var(--nx-ink-2)]' },
    @{ Nome = 'Cartoes de selecao ativa'; Esperado = 3; Antes = "'bg-[#6C5CE7]/15 border-[#6C5CE7]/40'"; Depois = "'bg-[color-mix(in_srgb,var(--nx-accent)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-accent)_40%,var(--nx-border))]'" },
    @{ Nome = 'Cartoes de selecao inativa das condicoes e acoes'; Esperado = 2; Antes = "'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/15'"; Depois = "'bg-[var(--nx-surface)] border-[var(--nx-border)] hover:bg-[var(--nx-surface-3)] hover:border-[var(--nx-border-strong)]'" },
    @{ Nome = 'Fundo dinamico dos icones das opcoes'; Esperado = 2; Antes = 'backgroundColor: `${op.cor}${ativo ? ''22'' : ''14''}`,'; Depois = 'backgroundColor: `color-mix(in srgb, ${op.cor} ${ativo ? 14 : 8}%, transparent)`,' },
    @{ Nome = 'Borda dinamica dos icones das opcoes'; Esperado = 2; Antes = 'borderColor: `${op.cor}${ativo ? ''55'' : ''30''}`,'; Depois = 'borderColor: `color-mix(in srgb, ${op.cor} ${ativo ? 35 : 20}%, var(--nx-border))`,' },
    @{ Nome = 'Descricoes das opcoes SE e ENTAO'; Esperado = 2; Antes = 'block text-[10.5px] text-white/40 mt-0.5 leading-snug'; Depois = 'block text-[10.5px] text-[var(--nx-ink-3)] mt-0.5 leading-snug' },
    @{ Nome = 'Check da opcao selecionada'; Esperado = 2; Antes = 'w-4 h-4 shrink-0 mt-1 text-[#A99CFF]'; Depois = 'w-4 h-4 shrink-0 mt-1 text-[var(--nx-accent)]' },
    @{ Nome = 'Rotulo parametro'; Esperado = 1; Antes = 'text-[11px] text-white/50 font-medium'; Depois = 'text-[11px] text-[var(--nx-ink-2)] font-medium' },
    @{ Nome = 'Campo numerico do parametro'; Esperado = 1; Antes = 'w-24 h-10 px-3 rounded-xl bg-[#0D0D14] border border-white/[0.08] text-[13px] text-white outline-none focus:border-[#6C5CE7]/50'; Depois = 'w-24 h-10 px-3 rounded-xl bg-[var(--nx-surface)] border border-[var(--nx-border)] text-[13px] text-[var(--nx-ink)] outline-none focus:border-[var(--nx-accent)]' },
    @{ Nome = 'Texto auxiliar de parametro e detalhes'; Esperado = 3; Antes = 'text-[11px] text-white/40'; Depois = 'text-[11px] text-[var(--nx-ink-3)]' },
    @{ Nome = 'Pildoras ENTAO no modal e preview'; Esperado = 2; Antes = 'px-2.5 py-1 rounded-full bg-[#6C5CE7] text-white font-bold text-[10px] tracking-[0.16em]'; Depois = 'px-2.5 py-1 rounded-full bg-[var(--nx-accent)] text-[var(--nx-ink)] font-bold text-[10px] tracking-[0.16em]' },
    @{ Nome = 'Contagem de acoes'; Esperado = 1; Antes = 'ml-auto text-[11px] text-white/40'; Depois = 'ml-auto text-[11px] text-[var(--nx-ink-3)]' },
    @{ Nome = 'Severidade inativa'; Esperado = 1; Antes = "'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'"; Depois = "'bg-[var(--nx-surface)] border-[var(--nx-border)] hover:bg-[var(--nx-surface-3)]'" },
    @{ Nome = 'Rotulo severidade'; Esperado = 1; Antes = 'text-[12px] font-semibold text-white'; Depois = 'text-[12px] font-semibold text-[var(--nx-ink)]' },
    @{ Nome = 'Descricao severidade'; Esperado = 1; Antes = 'text-[10.5px] text-white/40 text-center leading-tight'; Depois = 'text-[10.5px] text-[var(--nx-ink-3)] text-center leading-tight' },
    @{ Nome = 'Preview da regra'; Esperado = 1; Antes = 'rounded-2xl bg-gradient-to-br from-[#1A1A2E] to-[#12121F] border border-white/[0.08] p-4 space-y-3'; Depois = 'rounded-2xl bg-[var(--nx-surface-2)] border border-[var(--nx-border)] p-4 space-y-3' },
    @{ Nome = 'Chip condicao no preview'; Esperado = 1; Antes = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12121F] border border-white/10 text-[11.5px] font-medium text-white/80'; Depois = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--nx-surface)] border border-[var(--nx-border)] text-[11.5px] font-medium text-[var(--nx-ink-2)]' },
    @{ Nome = 'Seta do preview'; Esperado = 1; Antes = 'w-3.5 h-3.5 text-white/20'; Depois = 'w-3.5 h-3.5 text-[var(--nx-ink-3)]' },
    @{ Nome = 'Texto sem acao no preview'; Esperado = 1; Antes = 'text-[11.5px] text-white/30'; Depois = 'text-[11.5px] text-[var(--nx-ink-3)]' },
    @{ Nome = 'Chip acao no preview'; Esperado = 2; Antes = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#12121F] border border-white/10 text-[11.5px] font-medium'; Depois = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--nx-surface)] border border-[var(--nx-border)] text-[11.5px] font-medium' },
    @{ Nome = 'Texto explicativo do preview'; Esperado = 1; Antes = 'text-[10.5px] text-white/35 leading-relaxed'; Depois = 'text-[10.5px] text-[var(--nx-ink-3)] leading-relaxed' },
    @{ Nome = 'Endpoint explicado no preview'; Esperado = 1; Antes = 'className="text-white/50"'; Depois = 'className="text-[var(--nx-ink-2)]"' },
    @{ Nome = 'Erro do formulario'; Esperado = 1; Antes = 'rounded-xl bg-[#FF5A5F]/10 border border-[#FF5A5F]/25 p-3 text-[12px] text-[#FF8A8E] flex items-start gap-2'; Depois = 'rounded-xl bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)] border border-[color-mix(in_srgb,var(--nx-red)_25%,var(--nx-border))] p-3 text-[12px] text-[var(--nx-red)] flex items-start gap-2' },
    @{ Nome = 'Rodape do modal'; Esperado = 1; Antes = 'flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-white/[0.06] bg-[#0D0D14]/80 backdrop-blur-xl'; Depois = 'flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-[var(--nx-border)] bg-[var(--nx-surface-2)]' },
    @{ Nome = 'Texto do rodape do modal'; Esperado = 1; Antes = 'text-[11px] text-white/35'; Depois = 'text-[11px] text-[var(--nx-ink-3)]' },

    # Estado de carregamento e raiz da pagina
    @{ Nome = 'Skeleton de carregamento'; Esperado = 1; Antes = 'rounded-2xl bg-[#12121F] border border-white/[0.06] animate-pulse'; Depois = 'rounded-2xl bg-[var(--nx-surface-2)] border border-[var(--nx-border)] animate-pulse' },
    @{ Nome = 'Fundo principal da pagina'; Esperado = 1; Antes = 'min-h-full bg-[#0D0D14] text-white font-[''Inter'',sans-serif] -m-6 lg:-m-6'; Depois = 'min-h-full bg-[var(--nx-canvas)] text-[var(--nx-ink)] font-[''Inter'',sans-serif] -m-6 lg:-m-6' },

    # Faixas de erro e sucesso do backend
    @{ Nome = 'Aviso de erro da pagina'; Esperado = 1; Antes = 'rounded-2xl border border-[#FF5A5F]/25 bg-[#FF5A5F]/10 px-4 py-3 text-[12.5px] text-[#FF8A8E] flex items-start gap-2.5'; Depois = 'rounded-2xl border border-[color-mix(in_srgb,var(--nx-red)_25%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)] px-4 py-3 text-[12.5px] text-[var(--nx-red)] flex items-start gap-2.5' },
    @{ Nome = 'Aviso de sucesso da pagina'; Esperado = 1; Antes = 'rounded-2xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-4 py-3 text-[12.5px] text-[#6EE7A0] flex items-start gap-2.5'; Depois = 'rounded-2xl border border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)] px-4 py-3 text-[12.5px] text-[var(--nx-green)] flex items-start gap-2.5' },

    # KPIs e barra de acoes
    @{ Nome = 'Valor KPI'; Esperado = 1; Antes = 'text-[26px] font-black text-white mt-2 leading-none'; Depois = 'text-[26px] font-black text-[var(--nx-ink)] mt-2 leading-none' },
    @{ Nome = 'Descricao KPI'; Esperado = 1; Antes = 'text-[11px] text-white/40 mt-1.5'; Depois = 'text-[11px] text-[var(--nx-ink-3)] mt-1.5' },
    @{ Nome = 'Busca icon'; Esperado = 1; Antes = 'w-4 h-4 text-white/30 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none'; Depois = 'w-4 h-4 text-[var(--nx-ink-3)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none' },

    # Cabecalhos dos paineis e filtros de alertas
    @{ Nome = 'Divisorias dos paineis'; Esperado = 4; Antes = 'border-b border-white/[0.06]'; Depois = 'border-b border-[var(--nx-border)]' },
    @{ Nome = 'Titulos dos paineis, cards e opcoes'; Esperado = 8; Antes = 'text-[12.5px] font-semibold text-white'; Depois = 'text-[12.5px] font-semibold text-[var(--nx-ink)]' },
    @{ Nome = 'Fundo do filtro de abas'; Esperado = 1; Antes = 'p-1 rounded-full bg-[#0D0D14] border border-white/[0.07]'; Depois = 'p-1 rounded-full bg-[var(--nx-surface-2)] border border-[var(--nx-border)]' },
    @{ Nome = 'Aba ativa de alertas'; Esperado = 1; Antes = "'bg-white text-[#0D0D14]'"; Depois = "'bg-[var(--nx-accent)] text-[var(--nx-ink)]'" },
    @{ Nome = 'Aba inativa de alertas'; Esperado = 1; Antes = "'text-white/50 hover:text-white hover:bg-white/[0.06]'"; Depois = "'text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:bg-[var(--nx-surface-3)]'" },
    @{ Nome = 'Estado vazio de alertas notificacoes e regras'; Esperado = 3; Antes = 'rounded-2xl bg-[#0D0D14] border border-dashed border-white/10 px-5 py-9 text-center'; Depois = 'rounded-2xl bg-[var(--nx-surface-2)] border border-dashed border-[var(--nx-border)] px-5 py-9 text-center' },
    @{ Nome = 'Fundo do icone de erro vazio'; Esperado = 1; Antes = "'bg-[#FF5A5F]/10'"; Depois = "'bg-[color-mix(in_srgb,var(--nx-red)_10%,transparent)]'" },
    @{ Nome = 'Fundo do icone de sucesso vazio'; Esperado = 1; Antes = "'bg-[#22C55E]/10'"; Depois = "'bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)]'" },
    @{ Nome = 'Icone de erro vazio'; Esperado = 1; Antes = 'w-5 h-5 text-[#FF5A5F]'; Depois = 'w-5 h-5 text-[var(--nx-red)]' },
    @{ Nome = 'Icone de sucesso vazio'; Esperado = 1; Antes = 'w-5 h-5 text-[#22C55E]'; Depois = 'w-5 h-5 text-[var(--nx-green)]' },
    @{ Nome = 'Titulo dos estados vazios'; Esperado = 3; Antes = 'text-[12.5px] font-medium text-white/60 mt-3'; Depois = 'text-[12.5px] font-medium text-[var(--nx-ink)] mt-3' },
    @{ Nome = 'Textos secundarios 11px nos estados vazios e preview'; Esperado = 4; Antes = 'text-[11px] text-white/30'; Depois = 'text-[11px] text-[var(--nx-ink-3)]' },

    # Cards de alerta e regra
    @{ Nome = 'Cartoes de alerta e regra'; Esperado = 2; Antes = 'px-4 py-3.5 rounded-xl bg-[#0D0D14] border border-white/[0.06] flex items-start gap-3.5 transition hover:border-white/[0.12]'; Depois = 'px-4 py-3.5 rounded-xl bg-[var(--nx-surface-2)] border border-[var(--nx-border)] flex items-start gap-3.5 transition hover:border-[var(--nx-border-strong)]' },
    @{ Nome = 'Badge alerta resolvido'; Esperado = 1; Antes = 'px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.06] text-[9.5px] font-bold tracking-[0.12em] text-white/50'; Depois = 'px-2.5 py-1 rounded-full border border-[var(--nx-border)] bg-[var(--nx-surface-3)] text-[9.5px] font-bold tracking-[0.12em] text-[var(--nx-ink-3)]' },
    @{ Nome = 'Descricao alerta e notificacao'; Esperado = 2; Antes = 'text-[11.5px] text-white/50 mt-1 leading-relaxed'; Depois = 'text-[11.5px] text-[var(--nx-ink-2)] mt-1 leading-relaxed' },
    @{ Nome = 'Metadados alerta e regra'; Esperado = 2; Antes = 'flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-white/40'; Depois = 'flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10.5px] text-[var(--nx-ink-3)]' },

    # Notificacoes
    @{ Nome = 'Badge notificacoes nao lidas'; Esperado = 1; Antes = 'px-2.5 py-1 rounded-full bg-[#38BDF8]/10 border border-[#38BDF8]/25 text-[#38BDF8] text-[10px] font-bold tracking-[0.12em]'; Depois = 'px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--nx-accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--nx-accent)_25%,var(--nx-border))] text-[var(--nx-accent-ink)] text-[10px] font-bold tracking-[0.12em]' },
    @{ Nome = 'Icone vazio notificacoes'; Esperado = 1; Antes = 'w-11 h-11 rounded-full bg-white/[0.06] grid place-items-center mx-auto'; Depois = 'w-11 h-11 rounded-full bg-[var(--nx-surface-3)] grid place-items-center mx-auto' },
    @{ Nome = 'Icone Bell vazio'; Esperado = 1; Antes = 'w-5 h-5 text-white/30'; Depois = 'w-5 h-5 text-[var(--nx-ink-3)]' },
    @{ Nome = 'Linha do tempo notificacoes'; Esperado = 1; Antes = 'before:bg-white/[0.08]'; Depois = 'before:bg-[var(--nx-border)]' },
    @{ Nome = 'Marcador notificado lido'; Esperado = 1; Antes = 'absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[#12121F]'; Depois = 'absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[var(--nx-surface)]' },
    @{ Nome = 'Ponto da notificacao lida'; Esperado = 1; Antes = "'bg-white/20'"; Depois = "'bg-[var(--nx-border-strong)]'" },
    @{ Nome = 'Titulo notificacao lida'; Esperado = 1; Antes = "'font-medium text-white/50'"; Depois = "'font-medium text-[var(--nx-ink-3)]'" },
    @{ Nome = 'Titulo notificacao nao lida'; Esperado = 1; Antes = "'font-semibold text-white'"; Depois = "'font-semibold text-[var(--nx-ink)]'" },
    @{ Nome = 'Tipo notificacao com link'; Esperado = 1; Antes = 'px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-medium text-white/50 hover:text-white hover:border-white/20 transition'; Depois = 'px-2.5 py-0.5 rounded-full bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[10px] font-medium text-[var(--nx-ink-2)] hover:text-[var(--nx-ink)] hover:border-[var(--nx-border-strong)] transition' },
    @{ Nome = 'Tipo notificacao sem link'; Esperado = 1; Antes = 'className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10px] font-medium text-white/50"'; Depois = 'className="px-2.5 py-0.5 rounded-full bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[10px] font-medium text-[var(--nx-ink-2)]"' },
    @{ Nome = 'Horario notificacao'; Esperado = 1; Antes = 'inline-flex items-center gap-1.5 text-[10.5px] text-white/40 mt-1.5'; Depois = 'inline-flex items-center gap-1.5 text-[10.5px] text-[var(--nx-ink-3)] mt-1.5' },

    # Regras de automacao
    @{ Nome = 'Botao nova regra no painel'; Esperado = 1; Antes = 'h-8 px-3 rounded-[10px] inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white bg-[#6C5CE7] hover:bg-[#7A6EF0] active:scale-[0.98] transition'; Depois = 'h-8 px-3 rounded-[10px] inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--nx-ink)] bg-[var(--nx-accent)] hover:bg-[var(--nx-accent-2)] active:scale-[0.98] transition' },
    @{ Nome = 'Icone vazio regras'; Esperado = 1; Antes = 'w-11 h-11 rounded-full bg-[#6C5CE7]/15 grid place-items-center mx-auto'; Depois = 'w-11 h-11 rounded-full bg-[color-mix(in_srgb,var(--nx-accent)_15%,transparent)] grid place-items-center mx-auto' },
    @{ Nome = 'Icone Workflow vazio'; Esperado = 1; Antes = 'w-5 h-5 text-[#A99CFF]'; Depois = 'w-5 h-5 text-[var(--nx-accent)]' },
    @{ Nome = 'Regra ativa'; Esperado = 1; Antes = "'bg-[#22C55E]/10 border-[#22C55E]/25 text-[#22C55E]'"; Depois = "'bg-[color-mix(in_srgb,var(--nx-green)_10%,transparent)] border-[color-mix(in_srgb,var(--nx-green)_25%,var(--nx-border))] text-[var(--nx-green)]'" },
    @{ Nome = 'Regra inativa'; Esperado = 1; Antes = "'bg-white/[0.06] border-white/10 text-white/40'"; Depois = "'bg-[var(--nx-surface-3)] border-[var(--nx-border)] text-[var(--nx-ink-3)]'" },
    @{ Nome = 'Pildora SE das regras'; Esperado = 1; Antes = 'px-2 py-0.5 rounded-full bg-white text-[#0D0D14] font-bold text-[9px] tracking-[0.12em]'; Depois = 'px-2 py-0.5 rounded-full bg-[var(--nx-accent)] text-[var(--nx-ink)] font-bold text-[9px] tracking-[0.12em]' },
    @{ Nome = 'Texto condicao das regras'; Esperado = 1; Antes = 'text-[11px] text-white/60'; Depois = 'text-[11px] text-[var(--nx-ink-2)]' },
    @{ Nome = 'Seta das regras'; Esperado = 1; Antes = 'w-3 h-3 text-white/20'; Depois = 'w-3 h-3 text-[var(--nx-ink-3)]' },
    @{ Nome = 'Pildora ENTAO das regras'; Esperado = 1; Antes = 'px-2 py-0.5 rounded-full bg-[#6C5CE7] text-white font-bold text-[9px] tracking-[0.12em]'; Depois = 'px-2 py-0.5 rounded-full bg-[var(--nx-accent)] text-[var(--nx-ink)] font-bold text-[9px] tracking-[0.12em]' },
    @{ Nome = 'Chips das acoes de regras'; Esperado = 1; Antes = 'px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[10.5px] font-medium text-white/60'; Depois = 'px-2 py-0.5 rounded-full bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[10.5px] font-medium text-[var(--nx-ink-2)]' },
    @{ Nome = 'Origem da regra'; Esperado = 1; Antes = 'px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-[9.5px] font-medium'; Depois = 'px-2 py-0.5 rounded-full bg-[var(--nx-surface-3)] border border-[var(--nx-border)] text-[9.5px] font-medium text-[var(--nx-ink-2)]' },
    @{ Nome = 'Fundo dinamico dos KPIs'; Esperado = 1; Antes = 'backgroundColor: `${kpi.cor}1A`,'; Depois = 'backgroundColor: `color-mix(in srgb, ${kpi.cor} 10%, transparent)`,' },
    @{ Nome = 'Borda dinamica dos KPIs'; Esperado = 1; Antes = 'borderColor: `${kpi.cor}33`,'; Depois = 'borderColor: `color-mix(in srgb, ${kpi.cor} 22%, var(--nx-border))`,' },
    @{ Nome = 'Fundo dinamico do icone de alerta'; Esperado = 1; Antes = 'backgroundColor: `${meta.cor}1A`,'; Depois = 'backgroundColor: `color-mix(in srgb, ${meta.cor} 10%, transparent)`,' },
    @{ Nome = 'Fundo dinamico do icone da regra'; Esperado = 1; Antes = 'backgroundColor: `${cor}1A`,'; Depois = 'backgroundColor: `color-mix(in srgb, ${cor} 10%, transparent)`,' },
    @{ Nome = 'Borda dinamica do icone de alerta'; Esperado = 1; Antes = 'borderColor: `${meta.cor}33`,'; Depois = 'borderColor: `color-mix(in srgb, ${meta.cor} 22%, var(--nx-border))`,' },
    @{ Nome = 'Borda dinamica do icone da regra'; Esperado = 1; Antes = 'borderColor: `${cor}33`,'; Depois = 'borderColor: `color-mix(in srgb, ${cor} 22%, var(--nx-border))`,' },
    @{ Nome = 'Cor alternativa da regra'; Esperado = 1; Antes = "const cor = opcao?.cor ?? '#6C5CE7';"; Depois = "const cor = opcao?.cor ?? 'var(--nx-accent)';" },
    @{ Nome = 'Fundos dinamicos dos icones SE e ENTAO'; Esperado = 2; Antes = 'backgroundColor: `${op.cor}${ativo ? ''22'' : ''14''}`,'; Depois = 'backgroundColor: `color-mix(in srgb, ${op.cor} ${ativo ? 14 : 8}%, transparent)`,' },
    @{ Nome = 'Bordas dinamicas dos icones SE e ENTAO'; Esperado = 2; Antes = 'borderColor: `${op.cor}${ativo ? ''55'' : ''30''}`,'; Depois = 'borderColor: `color-mix(in srgb, ${op.cor} ${ativo ? 35 : 20}%, var(--nx-border))`,' }
)

# Validar cada trecho e sua multiplicidade, sem alterar arquivo algum.
$falhas = @()
foreach ($item in $substituicoes) {
    $quantidade = [regex]::Matches($conteudo, [regex]::Escape($item.Antes)).Count
    if ($quantidade -ne $item.Esperado) {
        $falhas += "- $($item.Nome): esperado $($item.Esperado), encontrado $quantidade"
    }
}

if ($falhas.Count -gt 0) {
    Write-Host 'PRE-VALIDACAO INTERROMPIDA. NENHUMA ALTERACAO FOI FEITA.' -ForegroundColor Red
    $falhas | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    throw 'Revise os trechos divergentes antes de gerar uma nova versao do script.'
}

# Calcular tudo em memoria; nenhuma escrita ocorre nesta etapa.
$novoConteudo = $conteudo
foreach ($item in $substituicoes) {
    $novoConteudo = $novoConteudo.Replace($item.Antes, $item.Depois)
}

if ($novoConteudo -eq $conteudo) { throw 'Nenhuma diferenca foi produzida. Arquivo preservado.' }

$hashAtual = (Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash
if ($hashAtual -ne $hashInicial) { throw 'O arquivo foi alterado durante a preparacao. Nenhuma gravacao realizada.' }

# A auditoria de cores ignora somente as vias impressas (DANFE, comprovante PIX e boleto),
# que devem permanecer como papel branco com texto preto. O restante da pagina e auditado.
$inicioPapel = $novoConteudo.IndexOf('function DanfeModal(')
$marcadorDrawer = $novoConteudo.IndexOf('9. DRAWER DE DETALHE')
if ($inicioPapel -lt 0 -or $marcadorDrawer -lt 0 -or $marcadorDrawer -le $inicioPapel) {
    throw 'Auditoria interrompida: nao foi possivel delimitar com seguranca os documentos de impressao. Nenhuma gravacao realizada.'
}
$fimPapel = $novoConteudo.LastIndexOf('/*', $marcadorDrawer)
if ($fimPapel -lt $inicioPapel) {
    throw 'Auditoria interrompida: marcador final dos documentos de impressao nao encontrado. Nenhuma gravacao realizada.'
}
$conteudoAuditavel = $novoConteudo.Substring(0, $inicioPapel) + $novoConteudo.Substring($fimPapel)

# Verificacoes de seguranca do resultado em memoria.
$legadosCriticos = @(
    'bg-[#0D0D14]', 'bg-[#12121F]', 'bg-[#151528]', 'bg-[#0D0D14]/80',
    'from-[#1A1A2E]', 'to-[#12121F]', 'text-white/30', 'text-white/40',
    'text-white/50', 'text-white/60', 'text-white/70', 'text-white/80',
    'text-white/90', 'border-white/[0.06]', 'border-white/[0.07]',
    'border-white/[0.08]', 'border-white/[0.10]', 'bg-white/[0.03]',
    'bg-white/[0.06]', 'hover:bg-white/[0.06]', 'bg-[#6C5CE7]',
    'bg-[#FF5A5F]', 'bg-[#22C55E]', 'bg-[#FFB020]'
)
$restantes = @()
foreach ($legado in $legadosCriticos) {
    if ($conteudoAuditavel.Contains($legado)) { $restantes += $legado }
}
if ($restantes.Count -gt 0) {
    $restantesUnicos = $restantes | Sort-Object -Unique
    throw "Auditoria final interrompida: ainda existem cores fixas: $($restantesUnicos -join ', '). Nenhuma gravacao realizada."
}
$classesFixas = [regex]::Matches($conteudoAuditavel, '(?<![A-Za-z0-9_-])(?:bg|text|border|ring|from|to)-\[#(?:[0-9A-Fa-f]{3,8})\]|(?:bg|text|border)-white(?:/[^\s"'']+)?')
if ($classesFixas.Count -gt 0) {
    $amostras = @($classesFixas | ForEach-Object { $_.Value } | Sort-Object -Unique)
    throw "Auditoria final interrompida: ainda existem classes de cor fixa: $($amostras -join ', '). Nenhuma gravacao realizada."
}
$coresHexRestantes = [regex]::Matches($conteudoAuditavel, "(?i)cor:\s*'#[0-9a-f]{3,8}'")
if ($coresHexRestantes.Count -gt 0) {
    throw 'Auditoria final interrompida: ainda existem cores hexadecimais em metadados dinamicos. Nenhuma gravacao realizada.'
}

# Backup integral e gravacao transacional.
$carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$pastaBackup = Join-Path (Get-Location) "backup-alertas-tema-$carimbo"
New-Item -ItemType Directory -Path $pastaBackup | Out-Null
$backup = Join-Path $pastaBackup 'page.tsx'
Copy-Item -LiteralPath $arquivo -Destination $backup

try {
    [System.IO.File]::WriteAllText($arquivo, $novoConteudo, $utf8)
    $verificacao = [System.IO.File]::ReadAllText($arquivo)
    if ($verificacao -ne $novoConteudo) { throw 'O conteudo gravado difere do conteudo preparado.' }
    foreach ($item in $substituicoes) {
        if (-not $verificacao.Contains($item.Depois)) { throw "Falha apos gravacao em '$($item.Nome)'." }
    }
    $inicioPapelVerificado = $verificacao.IndexOf('function DanfeModal(')
    $marcadorDrawerVerificado = $verificacao.IndexOf('9. DRAWER DE DETALHE')
    $fimPapelVerificado = if ($marcadorDrawerVerificado -ge 0) { $verificacao.LastIndexOf('/*', $marcadorDrawerVerificado) } else { -1 }
    if ($inicioPapelVerificado -lt 0 -or $fimPapelVerificado -le $inicioPapelVerificado) {
        throw 'Nao foi possivel repetir a delimitacao das vias impressas apos gravacao.'
    }
    $conteudoAuditavelVerificado = $verificacao.Substring(0, $inicioPapelVerificado) + $verificacao.Substring($fimPapelVerificado)
    foreach ($legado in $legadosCriticos) {
        if ($conteudoAuditavelVerificado.Contains($legado)) { throw "Cor fixa remanescente apos gravacao: $legado" }
    }
}
catch {
    Copy-Item -LiteralPath $backup -Destination $arquivo -Force
    throw "Gravacao revertida pelo backup. Motivo: $($_.Exception.Message)"
}

Write-Host "`nPADRONIZACAO VISUAL DE ALERTAS APLICADA E VERIFICADA." -ForegroundColor Green
Write-Host "Grupos de substituicao: $($substituicoes.Count)" -ForegroundColor Cyan
Write-Host "Backup: $backup" -ForegroundColor Cyan
Write-Host "`nValidacao Git:" -ForegroundColor Yellow
git diff --check -- $path
if ($LASTEXITCODE -ne 0) { Copy-Item -LiteralPath $backup -Destination $arquivo -Force; throw 'Git diff --check falhou. Arquivo restaurado pelo backup.' }
Write-Host "`nConcluido. Endpoints, estados, calculos e regras SE/ENTAO foram preservados." -ForegroundColor Green
