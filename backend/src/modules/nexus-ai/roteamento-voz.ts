/**
 * Roteamento rápido para o MODO VOZ (sem chamar o modelo).
 *
 * Por voz, esperar o NEXUS BRAIN consultar especialistas leva dezenas de segundos. Quando a
 * pergunta é claramente de UMA área (vendas, estoque, financeiro ou compras), ela vai direto ao
 * especialista daquela área — mesmo motor, mesmas ferramentas, mesma verificação de números.
 * Perguntas que cruzam áreas ("por que o lucro caiu?") ou ambíguas continuam no BRAIN.
 * O especialista só é usado se o usuário tiver a permissão mínima dele.
 */
import { temPermissao } from '../../lib/permissoes.js';
import { agente as buscarAgente } from './agentes/registro.js';

const AREAS: { agente: string; termos: RegExp }[] = [
  { agente: 'comercial', termos: /\b(vend(a|as|i|eu|emos|eram|edor|edores)|faturament\w*|faturei|ticket|clientes?|margem|pre[cç]o de venda|curva abc|mais vendid\w*)\b/i },
  { agente: 'estoque', termos: /\b(estoques?|saldos?|repor|reposi[cç][aã]o|ruptur\w*|parad[oa]s?|m[ií]nimo|invent[aá]rio|validade|falt(a|ando|ar)|ficha t[eé]cnica|kit)\b/i },
  { agente: 'financeiro', termos: /\b(caixa|fluxo|contas?|despesas?|receitas?|lucro|preju[ií]zo|resultado|dre|pagar|receber|vencid\w*|financeir\w*)\b/i },
  { agente: 'compras', termos: /\b(compras?|comprei|fornecedor(es)?|pedidos? de compra|cota[cç][aã]o|recebimento)\b/i },
];

/** Perguntas que pedem explicação de causa costumam precisar de mais de uma área. */
const CRUZA_AREAS = /\b(por ?qu[eê]|motivo|causa|explique|compar(e|ar|ando) .* com)\b/i;

/** Área única da pergunta, ou null (várias áreas, nenhuma ou pede causa). */
export function areaUnica(pergunta: string): string | null {
  if (CRUZA_AREAS.test(pergunta)) return null;
  const achadas = AREAS.filter((a) => a.termos.test(pergunta)).map((a) => a.agente);
  // "margem" e "lucro" aparecem juntos em perguntas comerciais e financeiras: na dúvida, BRAIN.
  return achadas.length === 1 ? achadas[0] : null;
}

/** Agente para uma pergunta por voz: o especialista da área (se permitido) ou o BRAIN. */
export async function agenteParaVoz(pergunta: string, usuarioId: string): Promise<string> {
  const area = areaUnica(pergunta);
  if (!area) return 'nexus';
  const a = buscarAgente(area);
  if (!a) return 'nexus';
  return (await temPermissao(usuarioId, a.permissaoMinima.modulo, a.permissaoMinima.acao)) ? area : 'nexus';
}
