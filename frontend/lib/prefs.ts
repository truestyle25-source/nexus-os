// NEXUS OS — leitura das preferências de idioma/região.
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// `format.ts` é chamado milhares de vezes por render (uma vez por célula de
// tabela, por KPI, por linha de gráfico). Ler e parsear o localStorage em cada
// chamada mostraria no perf profiler. Então o objeto é lido UMA vez e fica em
// cache; o cache só é invalidado quando alguém realmente muda a preferência
// (`invalidarPrefs`, chamado pela aba Configurações e pelo evento `storage`).
//
// Isto também centraliza o parse: se o storage estiver corrompido, cai no
// padrão em vez de estourar a tela inteira.

export type Prefs = {
  idioma: string;
  moeda: string;
  fuso: string;
  formatoData: string;
  formatoHora: string;
};

export const CHAVE_PREFS = 'nexus_prefs';

export const PREFS_PADRAO: Prefs = {
  idioma: 'pt-BR',
  moeda: 'BRL',
  fuso: 'America/Sao_Paulo',
  formatoData: 'DD/MM/AAAA',
  formatoHora: '24h',
};

const IDIOMAS = ['pt-BR', 'en-US', 'es-ES'];
const MOEDAS = ['BRL', 'USD', 'EUR'];
const FORMATOS_DATA = ['DD/MM/AAAA', 'MM/DD/AAAA', 'AAAA-MM-DD'];
const FORMATOS_HORA = ['24h', '12h'];

function umDos(valor: unknown, permitidos: string[], padrao: string): string {
  return typeof valor === 'string' && permitidos.includes(valor) ? valor : padrao;
}

/** Sanitiza qualquer objeto vindo do storage, descartando o que não faz sentido. */
export function normalizarPrefs(bruto: unknown): Prefs {
  const o = (bruto ?? {}) as Record<string, unknown>;
  return {
    idioma: umDos(o.idioma, IDIOMAS, PREFS_PADRAO.idioma),
    moeda: umDos(o.moeda, MOEDAS, PREFS_PADRAO.moeda),
    fuso: typeof o.fuso === 'string' && o.fuso ? o.fuso : PREFS_PADRAO.fuso,
    formatoData: umDos(o.formatoData, FORMATOS_DATA, PREFS_PADRAO.formatoData),
    formatoHora: umDos(o.formatoHora, FORMATOS_HORA, PREFS_PADRAO.formatoHora),
  };
}

let cache: Prefs | null = null;

/** Lê do localStorage na primeira vez; depois devolve o cache. */
export function lerPrefs(): Prefs {
  if (cache) return cache;
  if (typeof window === 'undefined') return PREFS_PADRAO;
  try {
    const raw = window.localStorage.getItem(CHAVE_PREFS);
    cache = raw ? normalizarPrefs(JSON.parse(raw)) : PREFS_PADRAO;
  } catch {
    cache = PREFS_PADRAO;
  }
  return cache;
}

/**
 * Evento disparado quando a preferência muda NESTA aba. Quem quiser repintar a
 * interface (o ThemeSync do layout raiz) escuta aqui; o evento `storage` cuida
 * das outras abas.
 */
export const EVENTO_PREFS = 'nexus:prefs';

/** Grava a preferência, atualiza o cache e avisa os assinantes. */
export function gravarPrefs(novas: Prefs): void {
  const limpas = normalizarPrefs(novas);
  cache = limpas;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAVE_PREFS, JSON.stringify(limpas));
  } catch {
    /* modo privativo: mantém só em memória */
  }
  window.dispatchEvent(new CustomEvent(EVENTO_PREFS, { detail: limpas }));
}

/**
 * Faz o próximo `lerPrefs()` voltar ao disco.
 *
 * Use logo depois de gravar por fora desta página (ex.: um script de
 * instalação, ou o botão "restaurar padrão"). O `gravarPrefs` já atualiza o
 * cache sozinho, então o normal é não precisar chamar isto.
 */
export function invalidarPrefs(): void {
  cache = null;
}

/**
 * Mantém o cache coerente quando OUTRA aba do navegador salva a preferência —
 * o evento `storage` só dispara nas outras abas, nunca na que escreveu.
 */
function aoMudarStorage(evento: StorageEvent): void {
  if (evento.key === null || evento.key === CHAVE_PREFS) cache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', aoMudarStorage);
}
