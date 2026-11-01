import { prisma } from '../../lib/prisma.js';
import { getKPIs, getInsights, type InsightFornecedores } from './fornecedores.service.js';

/**
 * IA da aba /fornecedores (mesmo padrão de iaRelatorios.service.ts):
 * interpretarPergunta roda SEMPRE (local, determinístico) e analisarPorIA
 * complementa com Gemini quando há GEMINI_API_KEY, usando dados REAIS do
 * Prisma. Sem chave/erro/JSON inválido → fallback local honesto.
 */

export interface InterpretacaoFornecedores {
  acao?: 'criar' | 'pedido';
  nome?: string;
  filtro?: 'Crítico';
  ordenar?: 'totalComprado desc';
}

export interface AnaliseFornecedores {
  resposta: string;
  filtroSugerido?: string;
  fornecedorSugerido?: string;
  /** true = montada localmente (Gemini ausente/erro). */
  fallback: boolean;
}

/** Interpreta a pergunta em linguagem natural da IA BAR (regras do prompt). */
export function interpretarPergunta(pergunta: string): InterpretacaoFornecedores {
  const p = pergunta.toLowerCase();

  // "adicionar fornecedor X" → { acao: 'criar', nome: X }
  const mCriar = p.match(/(?:adicionar|criar|cadastrar)\s+(?:o\s+|um\s+|a\s+)?fornecedor\s+(.+)/i);
  if (mCriar) return { acao: 'criar', nome: mCriar[1].trim().replace(/[.!?]+$/, '') };

  // "quem atrasa / atraso / crítico" → { filtro: 'Crítico' }
  if (/(atrasa|atraso|atrasad|crític|critic)/.test(p)) return { filtro: 'Crítico' };

  // "melhor preço / top / mais barato" → { ordenar: 'totalComprado desc' }
  if (/(melhor\s*preç|melhor\s*prec|\btop\b|mais\s*barat)/.test(p)) {
    return { ordenar: 'totalComprado desc' };
  }

  // "criar pedido" → { acao: 'pedido' }
  if (/(criar|gerar|fazer)\s+(?:um\s+)?pedido/.test(p)) return { acao: 'pedido' };

  return {};
}

function resumoLocal(
  interp: InterpretacaoFornecedores,
  kpis: Awaited<ReturnType<typeof getKPIs>>,
  insights: InsightFornecedores,
): string {
  if (interp.acao === 'criar' && interp.nome) {
    return `Vou cadastrar o fornecedor "${interp.nome}" — confirme no formulário que já está aberto.`;
  }
  if (interp.acao === 'pedido') {
    return 'Para criar pedido, use o módulo Compras (POST /compras) com o fornecedor e os itens; o pedido aparece aqui automaticamente.';
  }
  if (interp.filtro === 'Crítico') {
    return `Filtro crítico aplicado: ${kpis.pedidosPendentes} pedido(s) pendente(s). ${insights.atrasoCritico}`;
  }
  if (interp.ordenar) {
    return `Ordenando por total comprado. ${insights.melhorNegociacao}`;
  }
  return (
    `Resumo dos fornecedores: ${kpis.totalFornecedores} cadastrados, ` +
    `R$ ${kpis.gastoMes.toFixed(2)} gastos no mês, ${kpis.pedidosPendentes} pedido(s) pendente(s), ` +
    `ticket médio R$ ${kpis.ticketMedio.toFixed(2)}. ${insights.melhorNegociacao}`
  );
}

/**
 * Interpreta + cruza com dados reais + Gemini (quando disponível).
 * Sempre retorna JSON {resposta, filtroSugerido, fornecedorSugerido}.
 */
export async function analisarPorIA(args: { pergunta: string; empresaId: string }): Promise<AnaliseFornecedores> {
  const { pergunta, empresaId } = args;
  const interp = interpretarPergunta(pergunta);

  const [kpis, insights, criticos, top] = await Promise.all([
    getKPIs(empresaId),
    getInsights(empresaId),
    prisma.fornecedor.findMany({ where: { empresaId, status: 'Crítico' }, select: { nome: true }, take: 10 }),
    prisma.fornecedor.findMany({
      where: { empresaId },
      orderBy: { totalComprado: 'desc' },
      select: { nome: true, categoria: true, totalComprado: true },
      take: 8,
    }),
  ]);

  const dadosReais = {
    kpis,
    insights,
    fornecedoresCriticos: criticos.map((c) => c.nome),
    topPorTotalComprado: top.map((t) => ({ nome: t.nome, categoria: t.categoria, totalComprado: Number(t.totalComprado) })),
    interpretacao: interp,
  };

  const fb = {
    resposta: resumoLocal(interp, kpis, insights),
    filtroSugerido: interp.filtro as string | undefined,
    fornecedorSugerido: interp.acao === 'criar' ? interp.nome : undefined,
    fallback: true,
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fb;

  // Modelo vem SEMPRE do .env (GEMINI_MODEL) — nunca hardcoded.
  const modelo = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const prompt = `Você é o NEXUS, analista de compras/fornecedores da NEXUS OS (pt-BR).
Abaixo estão DADOS REAIS do banco da empresa. Responda SOMENTE JSON válido (sem markdown):
{"resposta":"2-3 frases executivas citando números reais","filtroSugerido":"Crítico"|"Ativo"|"Inativo"|null,"fornecedorSugerido":"nome de um fornecedor real ou null"}
REGRAS: (1) NUNCA invente números. (2) Se a pergunta pedir filtro, preencha filtroSugerido com valor exato. (3) Se citar fornecedor, use nome real da lista.

DADOS REAIS:
${JSON.stringify(dadosReais)}

Pergunta do usuário: ${pergunta}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let r: Response;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 500, responseMimeType: 'application/json' },
          }),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
    const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    if (!r.ok) return fb;

    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!texto) return fb;
    const bruto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
    const i0 = bruto.indexOf('{');
    const i1 = bruto.lastIndexOf('}');
    const json = JSON.parse(i0 >= 0 && i1 > i0 ? bruto.slice(i0, i1 + 1) : bruto) as Record<string, unknown>;

    const resposta =
      typeof json.resposta === 'string' && json.resposta.trim() ? json.resposta.trim().slice(0, 600) : fb.resposta;
    const filtroSugerido =
      typeof json.filtroSugerido === 'string' && ['Ativo', 'Crítico', 'Inativo'].includes(json.filtroSugerido)
        ? json.filtroSugerido
        : fb.filtroSugerido;
    const fornecedorSugerido =
      typeof json.fornecedorSugerido === 'string' && json.fornecedorSugerido.trim()
        ? json.fornecedorSugerido.trim().slice(0, 120)
        : fb.fornecedorSugerido;

    return { resposta, filtroSugerido, fornecedorSugerido, fallback: false };
  } catch {
    return fb;
  }
}

