/**
 * Monitoramento em tempo real (Fase 06, plano 5A.1) — DETECÇÃO DETERMINÍSTICA.
 *
 * Regras e limiares fixos no código, sem modelo de IA: funcionam mesmo com o Gemini fora do
 * ar. Cada regra lê as tabelas que o NEXUS já grava (LoginAttempt, Auditoria, Venda,
 * EstoqueMovimentacao, IntegracaoEvento, AIExecucao) numa janela recente e devolve eventos
 * com CHAVE ÚNICA: a varredura pode rodar várias vezes (ou em várias instâncias) e o mesmo
 * fato nunca vira dois eventos (unique empresaId+chave na outbox AIEvento).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { comoSistema } from '../../../lib/tenant-context.js';

export type Severidade = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
export interface EventoDetectado { empresaId: string; tipo: string; chave: string; severidade: Severidade; dados: Record<string, unknown> }

/** Limiares (expostos na tela Automações para o usuário saber exatamente o que dispara). */
export const LIMIARES = {
  loginFalhos: { tentativas: 5, minutos: 15 },
  cancelamentos: { quantidade: 5, minutos: 60 },
  ajusteEstoque: { valorMinimo: 1000, foraDoHorario: { de: 22, ate: 6 } },
  integracaoFalhas: { quantidade: 5, minutos: 60 },
  webhookInvalido: { quantidade: 3, minutos: 60 },
  exportacoes: { quantidade: 10, minutos: 60, sensiveis: ['clientes', 'rh', 'financeiro', 'fornecedores', 'relatorios', 'usuarios', 'radar'] },
};

export const DESCRICAO_REGRAS = [
  { tipo: 'LOGIN_FALHO', nome: 'Logins falhos em sequência', regra: `${LIMIARES.loginFalhos.tentativas} ou mais senhas erradas para o mesmo usuário em ${LIMIARES.loginFalhos.minutos} minutos`, severidade: 'CRITICA' },
  { tipo: 'PERMISSAO_ALTERADA', nome: 'Alteração de permissões', regra: 'Toda alteração de permissões de um usuário', severidade: 'ALTA' },
  { tipo: 'CANCELAMENTOS', nome: 'Cancelamentos e estornos fora do padrão', regra: `${LIMIARES.cancelamentos.quantidade} ou mais vendas canceladas, estornadas ou devolvidas pelo mesmo operador em ${LIMIARES.cancelamentos.minutos} minutos`, severidade: 'ALTA' },
  { tipo: 'AJUSTE_ESTOQUE', nome: 'Ajuste de estoque grande ou fora do horário', regra: `Ajuste, perda, avaria ou descarte de R$ ${LIMIARES.ajusteEstoque.valorMinimo} ou mais a custo, ou feito entre ${LIMIARES.ajusteEstoque.foraDoHorario.de}h e ${LIMIARES.ajusteEstoque.foraDoHorario.ate}h`, severidade: 'ALTA' },
  { tipo: 'INTEGRACAO_FALHA', nome: 'Falhas repetidas de integração', regra: `${LIMIARES.integracaoFalhas.quantidade} ou mais falhas do mesmo provedor em ${LIMIARES.integracaoFalhas.minutos} minutos`, severidade: 'MEDIA' },
  { tipo: 'WEBHOOK_INVALIDO', nome: 'Webhook com assinatura inválida', regra: `${LIMIARES.webhookInvalido.quantidade} ou mais avisos recebidos com assinatura inválida em ${LIMIARES.webhookInvalido.minutos} minutos`, severidade: 'ALTA' },
  { tipo: 'EXPORTACAO_MASSA', nome: 'Exportação de dados em massa', regra: `${LIMIARES.exportacoes.quantidade} ou mais exportações do mesmo usuário em ${LIMIARES.exportacoes.minutos} minutos, ou exportação de dados sensíveis (clientes, RH, financeiro, fornecedores, relatórios) entre ${LIMIARES.ajusteEstoque.foraDoHorario.de}h e ${LIMIARES.ajusteEstoque.foraDoHorario.ate}h`, severidade: 'ALTA' },
  { tipo: 'MANIPULACAO_IA', nome: 'Tentativa de manipulação da IA', regra: 'Pergunta bloqueada por instrução suspeita ou dado com instrução embutida neutralizado', severidade: 'ALTA' },
];

const MIN = 60_000;
const balde = (d: Date, minutos: number) => Math.floor(d.getTime() / (minutos * MIN));
const N = (v: unknown) => Number(v ?? 0);
const mascararEmail = (e: string) => e.replace(/^(.).*?(@.*)$/, '$1***$2');

function horaSaoPaulo(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(d));
}
export function foraDoHorario(d: Date): boolean {
  const h = horaSaoPaulo(d); const { de, ate } = LIMIARES.ajusteEstoque.foraDoHorario;
  return h >= de || h < ate;
}

async function loginsFalhos(desde: Date): Promise<EventoDetectado[]> {
  const L = LIMIARES.loginFalhos;
  const falhas = await prisma.loginAttempt.findMany({ where: { sucesso: false, email: { not: null }, createdAt: { gte: desde } }, select: { email: true, ip: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 20_000 });
  const grupos = new Map<string, { email: string; b: number; ips: Set<string>; n: number; primeira: Date; ultima: Date }>();
  for (const f of falhas) {
    const email = f.email!.trim().toLowerCase(); const b = balde(f.createdAt, L.minutos); const k = `${email}|${b}`;
    const g = grupos.get(k) ?? { email, b, ips: new Set(), n: 0, primeira: f.createdAt, ultima: f.createdAt };
    g.n++; g.ips.add(f.ip); g.ultima = f.createdAt; grupos.set(k, g);
  }
  const suspeitos = [...grupos.values()].filter((g) => g.n >= L.tentativas);
  if (!suspeitos.length) return [];
  const usuarios = await prisma.usuario.findMany({ where: { email: { in: [...new Set(suspeitos.map((s) => s.email))], mode: 'insensitive' } }, select: { id: true, nome: true, email: true, empresaId: true } });
  const porEmail = new Map(usuarios.map((u) => [u.email.toLowerCase(), u]));
  return suspeitos.flatMap((g) => {
    const u = porEmail.get(g.email);
    if (!u) return []; // e-mail que não existe: sem empresa para alertar (fica no rate limit)
    return [{ empresaId: u.empresaId, tipo: 'LOGIN_FALHO', chave: `login:${u.id}:${g.b}`, severidade: 'CRITICA' as const,
      dados: { usuarioId: u.id, usuario: u.nome, email: mascararEmail(u.email), tentativas: g.n, ipsDistintos: g.ips.size, primeira: g.primeira.toISOString(), ultima: g.ultima.toISOString(), janelaMinutos: L.minutos } }];
  });
}

async function permissoesAlteradas(desde: Date): Promise<EventoDetectado[]> {
  const linhas = await prisma.auditoria.findMany({ where: { acao: 'ALTERAR_PERMISSAO', empresaId: { not: null }, createdAt: { gte: desde } }, select: { id: true, empresaId: true, usuarioId: true, entidadeId: true, createdAt: true, usuario: { select: { nome: true } } }, take: 5000 });
  const alvos = await prisma.usuario.findMany({ where: { id: { in: linhas.map((l) => l.entidadeId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } });
  const nome = new Map(alvos.map((a) => [a.id, a.nome]));
  return linhas.map((l) => ({ empresaId: l.empresaId!, tipo: 'PERMISSAO_ALTERADA', chave: `perm:${l.id}`, severidade: 'ALTA' as const,
    dados: { auditoriaId: l.id, usuarioAlteradoId: l.entidadeId, alteradoPorId: l.usuarioId, alteradoPor: l.usuario?.nome ?? '(sistema)', usuarioAlterado: (l.entidadeId && nome.get(l.entidadeId)) ?? l.entidadeId ?? '(desconhecido)', quando: l.createdAt.toISOString() } }));
}

async function cancelamentos(desde: Date): Promise<EventoDetectado[]> {
  const L = LIMIARES.cancelamentos;
  // createdAt limita a busca às vendas dos últimos 30 dias (usa o índice existente; Venda não tem
  // índice em updatedAt e criar um travaria o PDV). Cancelar venda mais antiga que isso não entra.
  const vendas = await prisma.venda.findMany({ where: { status: { in: ['CANCELADA', 'ESTORNADA', 'DEVOLVIDA'] }, createdAt: { gte: new Date(desde.getTime() - 30 * 86_400_000) }, updatedAt: { gte: desde } }, select: { empresaId: true, funcionarioId: true, total: true, updatedAt: true, status: true }, take: 20_000 });
  const grupos = new Map<string, { empresaId: string; func: string; b: number; n: number; valor: number; status: Record<string, number> }>();
  for (const v of vendas) {
    const func = v.funcionarioId ?? 'sem-operador'; const b = balde(v.updatedAt, L.minutos); const k = `${v.empresaId}|${func}|${b}`;
    const g = grupos.get(k) ?? { empresaId: v.empresaId, func, b, n: 0, valor: 0, status: {} };
    g.n++; g.valor += N(v.total); g.status[v.status] = (g.status[v.status] ?? 0) + 1; grupos.set(k, g);
  }
  const suspeitos = [...grupos.values()].filter((g) => g.n >= L.quantidade);
  const ops = await prisma.usuario.findMany({ where: { id: { in: suspeitos.map((s) => s.func) } }, select: { id: true, nome: true } });
  const nome = new Map(ops.map((o) => [o.id, o.nome]));
  return suspeitos.map((g) => ({ empresaId: g.empresaId, tipo: 'CANCELAMENTOS', chave: `canc:${g.func}:${g.b}`, severidade: 'ALTA' as const,
    dados: { operador: nome.get(g.func) ?? '(sem operador)', vendas: g.n, valorTotal: Math.round(g.valor * 100) / 100, porStatus: g.status, janelaMinutos: L.minutos } }));
}

async function ajustesEstoque(desde: Date): Promise<EventoDetectado[]> {
  const movs = await prisma.estoqueMovimentacao.findMany({ where: { tipo: { in: ['AJUSTE', 'PERDA', 'AVARIA', 'DESCARTE'] }, createdAt: { gte: desde } }, select: { id: true, empresaId: true, tipo: true, quantidade: true, custoUnitario: true, createdAt: true, motivo: true, produto: { select: { nome: true, custo: true } }, usuario: { select: { nome: true } } }, take: 20_000 });
  return movs.flatMap((m) => {
    const custo = N(m.custoUnitario ?? m.produto.custo);
    const valor = Math.round(Math.abs(N(m.quantidade)) * custo * 100) / 100;
    const grande = valor >= LIMIARES.ajusteEstoque.valorMinimo; const tarde = foraDoHorario(m.createdAt);
    if (!grande && !tarde) return [];
    return [{ empresaId: m.empresaId, tipo: 'AJUSTE_ESTOQUE', chave: `estq:${m.id}`, severidade: (grande && tarde ? 'CRITICA' : 'ALTA') as Severidade,
      dados: { movimentacaoId: m.id, tipoMovimentacao: m.tipo, produto: m.produto.nome, quantidade: N(m.quantidade), valorACusto: valor, usuario: m.usuario?.nome ?? '(sistema)', quando: m.createdAt.toISOString(), motivos: [grande ? 'valor alto' : null, tarde ? 'fora do horário' : null].filter(Boolean) } }];
  });
}

async function integracoes(desde: Date): Promise<EventoDetectado[]> {
  const falhas = await prisma.integracaoEvento.findMany({ where: { resultado: 'FALHA', createdAt: { gte: desde } }, select: { empresaId: true, provedor: true, codigoErro: true, createdAt: true }, take: 20_000 });
  const grupos = new Map<string, { empresaId: string; provedor: string; webhook: boolean; b: number; n: number; codigos: Record<string, number> }>();
  for (const f of falhas) {
    const webhook = f.codigoErro === 'ASSINATURA_INVALIDA';
    const min = webhook ? LIMIARES.webhookInvalido.minutos : LIMIARES.integracaoFalhas.minutos;
    const b = balde(f.createdAt, min); const k = `${f.empresaId}|${f.provedor}|${webhook}|${b}`;
    const g = grupos.get(k) ?? { empresaId: f.empresaId, provedor: f.provedor, webhook, b, n: 0, codigos: {} };
    g.n++; const c = f.codigoErro ?? 'SEM_CODIGO'; g.codigos[c] = (g.codigos[c] ?? 0) + 1; grupos.set(k, g);
  }
  return [...grupos.values()]
    .filter((g) => g.n >= (g.webhook ? LIMIARES.webhookInvalido.quantidade : LIMIARES.integracaoFalhas.quantidade))
    .map((g) => ({ empresaId: g.empresaId, tipo: g.webhook ? 'WEBHOOK_INVALIDO' : 'INTEGRACAO_FALHA', chave: `${g.webhook ? 'webhook' : 'integ'}:${g.provedor}:${g.b}`, severidade: (g.webhook ? 'ALTA' : 'MEDIA') as Severidade,
      dados: { provedor: g.provedor, falhas: g.n, porCodigo: g.codigos, janelaMinutos: g.webhook ? LIMIARES.webhookInvalido.minutos : LIMIARES.integracaoFalhas.minutos } }));
}

async function manipulacaoIA(desde: Date): Promise<EventoDetectado[]> {
  const [bloqueadas, embutidas] = await Promise.all([
    prisma.aIExecucao.findMany({ where: { status: 'BLOQUEADA', createdAt: { gte: desde } }, select: { id: true, empresaId: true, usuarioId: true, agente: true, createdAt: true }, take: 5000 }),
    prisma.auditoria.findMany({ where: { entidade: 'AIEventoSeguranca', empresaId: { not: null }, createdAt: { gte: desde } }, select: { id: true, empresaId: true, entidadeId: true, valorNovo: true, createdAt: true }, take: 5000 }),
  ]);
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: bloqueadas.map((b) => b.usuarioId).filter((x): x is string => !!x) } }, select: { id: true, nome: true } });
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  return [
    // O texto da pergunta suspeita NÃO vai para o evento (poderia carregar a própria injeção).
    ...bloqueadas.map((b) => ({ empresaId: b.empresaId, tipo: 'MANIPULACAO_IA', chave: `ia:${b.id}`, severidade: 'ALTA' as const,
      dados: { origem: 'pergunta bloqueada', execucaoId: b.id, usuario: (b.usuarioId && nome.get(b.usuarioId)) ?? '(sistema)', agente: b.agente, quando: b.createdAt.toISOString() } })),
    // A pergunta bloqueada também gera auditoria (mesmo fato): aqui só os dados com instrução embutida.
    ...embutidas.filter((e) => (e.valorNovo as any)?.motivo === 'instrucao_embutida_em_dados').map((e) => ({ empresaId: e.empresaId!, tipo: 'MANIPULACAO_IA', chave: `iadados:${e.id}`, severidade: 'ALTA' as const,
      dados: { origem: 'instrução embutida em dados do sistema', execucaoId: e.entidadeId, ferramenta: (e.valorNovo as any)?.ferramenta ?? null, campos: (e.valorNovo as any)?.campos ?? [], quando: e.createdAt.toISOString() } })),
  ];
}

async function exportacoes(desde: Date): Promise<EventoDetectado[]> {
  const L = LIMIARES.exportacoes;
  const linhas = await prisma.auditoria.findMany({ where: { acao: 'EXPORTAR', empresaId: { not: null }, createdAt: { gte: desde } }, select: { id: true, empresaId: true, usuarioId: true, entidadeId: true, contexto: true, ip: true, createdAt: true }, take: 20_000 });
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: [...new Set(linhas.map((l) => l.usuarioId).filter((x): x is string => !!x))] } }, select: { id: true, nome: true } });
  const nome = new Map(usuarios.map((u) => [u.id, u.nome]));
  const eventos: EventoDetectado[] = [];
  const grupos = new Map<string, { empresaId: string; usuarioId: string; b: number; n: number; modulos: Record<string, number>; primeira: Date; ultima: Date }>();
  for (const l of linhas) {
    const u = l.usuarioId ?? 'desconhecido'; const b = balde(l.createdAt, L.minutos); const k = `${l.empresaId}|${u}|${b}`;
    const g = grupos.get(k) ?? { empresaId: l.empresaId!, usuarioId: u, b, n: 0, modulos: {}, primeira: l.createdAt, ultima: l.createdAt };
    g.n++; const m = l.entidadeId ?? 'desconhecido'; g.modulos[m] = (g.modulos[m] ?? 0) + 1; g.ultima = l.createdAt; grupos.set(k, g);
    if (L.sensiveis.includes(m) && foraDoHorario(l.createdAt)) {
      eventos.push({ empresaId: l.empresaId!, tipo: 'EXPORTACAO_MASSA', chave: `exphora:${l.id}`, severidade: 'MEDIA',
        dados: { motivo: 'fora do horário', usuarioId: u, usuario: nome.get(u) ?? '(desconhecido)', exportacoes: 1, porModulo: { [m]: 1 }, quando: l.createdAt.toISOString() } });
    }
  }
  for (const g of grupos.values()) if (g.n >= L.quantidade) {
    eventos.push({ empresaId: g.empresaId, tipo: 'EXPORTACAO_MASSA', chave: `exp:${g.usuarioId}:${g.b}`, severidade: 'ALTA',
      dados: { motivo: 'volume', usuarioId: g.usuarioId, usuario: nome.get(g.usuarioId) ?? '(desconhecido)', exportacoes: g.n, porModulo: g.modulos, janelaMinutos: L.minutos, primeira: g.primeira.toISOString(), ultima: g.ultima.toISOString() } });
  }
  return eventos;
}

export const REGRAS: Record<string, (desde: Date) => Promise<EventoDetectado[]>> = { loginsFalhos, permissoesAlteradas, cancelamentos, ajustesEstoque, integracoes, manipulacaoIA, exportacoes };

/** Grava eventos na outbox; os já existentes (mesma chave) são ignorados. */
export async function registrarEventos(eventos: EventoDetectado[]): Promise<number> {
  if (!eventos.length) return 0;
  const r = await comoSistema('nexus-ai:eventos:registrar', () => prisma.aIEvento.createMany({
    data: eventos.map((e) => ({ empresaId: e.empresaId, tipo: e.tipo, chave: e.chave.slice(0, 190), severidade: e.severidade, dados: e.dados as Prisma.InputJsonValue })),
    skipDuplicates: true,
  }));
  return r.count;
}

/**
 * Uma varredura completa. `janelaMin` cobre com folga o intervalo entre varreduras (fatos já
 * vistos são descartados pela chave). Uma regra que falha não impede as outras.
 */
export async function varrer(janelaMin = 120, agora = new Date()): Promise<{ detectados: number; novos: number; falhas: string[] }> {
  const desde = new Date(agora.getTime() - janelaMin * MIN);
  const falhas: string[] = []; const todos: EventoDetectado[] = [];
  for (const [nome, regra] of Object.entries(REGRAS)) {
    try { todos.push(...(await comoSistema(`nexus-ai:regra:${nome}`, () => regra(desde)))); } catch { falhas.push(nome); }
  }
  return { detectados: todos.length, novos: await registrarEventos(todos), falhas };
}
