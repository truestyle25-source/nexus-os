// NEXUS OS — preferências de APARÊNCIA (tema, densidade e cor principal).
//
// Fonte única de verdade para o que é salvo pelo usuário. A aba
// Configurações grava aqui, e o `ThemeScript`/`ThemeSync` aplicam no
// `<html>` antes da primeira pintura da tela — por isso trocar de tema não
// pisca nem exige recarregar a página.
//
// A paleta em si vive em `app/globals.css` (tokens `--nx-*`), e não aqui:
// este módulo só guarda a ESCOLHA do usuário, nunca a cor resolvida.

export type ThemeName = 'escuro' | 'claro';
export type Densidade = 'confortavel' | 'compacta';

export interface Aparencia {
  theme: ThemeName;
  densidade: Densidade;
  corPrincipal: string;
}

export const APARENCIA_PADRAO: Aparencia = {
  theme: 'escuro',
  densidade: 'confortavel',
  corPrincipal: '#7C3AED',
};

/** Cor principal oficial de cada tema — vale para todos os módulos. */
export const COR_PRINCIPAL_POR_TEMA: Record<ThemeName, string> = {
  escuro: '#7C3AED',
  claro: '#9F8CF5',
};

/** Chave de armazenamento — a mesma que a aba já usava. */
export const CHAVE_APARENCIA = 'nexus_aparencia';

/**
 * Evento de janela disparado quando a aparência muda. A aba dispara; o
 * ThemeSync escuta e re-aplica. O evento `storage` cuida das outras abas
 * do navegador (o `storage` não dispara na aba que escreveu).
 */
export const EVENTO_APARENCIA = 'nexus:aparencia';

/** Cores de accent oferecidas na aba Configurações. */
export const CORES_PRINCIPAIS = [
  '#7C3AED',
  '#9F8CF5',
];

function ehHex(valor: unknown): valor is string {
  return typeof valor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(valor);
}

/** Lê a preferência salva, descartando qualquer valor corrompido.
 * A cor oficial segue o tema (escuro #7C3AED / claro #9F8CF5) para valer
 * em todos os módulos; escolha salva só vale se for um HEX permitido. */
export function lerAparencia(): Aparencia {
  if (typeof window === 'undefined') return APARENCIA_PADRAO;
  try {
    const raw = window.localStorage.getItem(CHAVE_APARENCIA);
    if (!raw) return APARENCIA_PADRAO;
    const salvo = JSON.parse(raw);
    const theme: ThemeName = salvo?.theme === 'claro' ? 'claro' : 'escuro';
    return {
      theme,
      densidade: salvo?.densidade === 'compacta' ? 'compacta' : 'confortavel',
      corPrincipal: ehHex(salvo?.corPrincipal)
        ? salvo.corPrincipal
        : COR_PRINCIPAL_POR_TEMA[theme],
    };
  } catch {
    return APARENCIA_PADRAO;
  }
}

/**
 * Aplica a aparência no documento. É idempotente e segura para rodar no
 * servidor (guarda `typeof document`), porque o mesmo código é injetado
 * como script bloqueante antes da hidratação.
 */
export function aplicarAparencia(ap: Aparencia): void {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  raiz.setAttribute('data-theme', ap.theme);
  raiz.setAttribute('data-densidade', ap.densidade);
  raiz.style.setProperty('--nx-accent', ap.corPrincipal);
  // Faz os controles nativos (select, input, scrollbar) acompanharem o tema.
  raiz.style.colorScheme = ap.theme === 'claro' ? 'light' : 'dark';
}

/** Grava a preferência e a aplica na hora, avisando as outras telas. */
export function salvarAparencia(ap: Aparencia): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAVE_APARENCIA, JSON.stringify(ap));
  } catch {
    /* modo privativo / storage cheio: mantém só em memória */
  }
  aplicarAparencia(ap);
  window.dispatchEvent(new CustomEvent(EVENTO_APARENCIA, { detail: ap }));
}