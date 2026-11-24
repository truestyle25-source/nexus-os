/**
 * Registro único de ferramentas e agentes (carregado uma vez). Cada fase acrescenta aqui.
 * Agentes são configuração: papel + ferramentas + permissão mínima + autonomia + limites.
 */
import { registrarFerramentas } from './ferramentas/registro.js';
import { registrarAgentes } from './agentes/registro.js';
import { listarFiliais, visaoGeralEmpresa } from './ferramentas/geral.js';
import { FERRAMENTAS_ESTOQUE } from './ferramentas/estoque.js';
import { FERRAMENTAS_COMERCIAL } from './ferramentas/comercial.js';
import { FERRAMENTAS_FINANCEIRO } from './ferramentas/financeiro.js';
import { FERRAMENTAS_COMPRAS } from './ferramentas/compras.js';
import { FERRAMENTAS_CONHECIMENTO } from './ferramentas/conhecimento.js';
import type { Agente } from './tipos.js';

let carregado = false;

const BASE_LEITURA = 'Você é somente leitura: pode recomendar, mas não cria, altera nem exclui nada no sistema.';

const CONHECIMENTO = ['consultar_memoria', 'buscar_documentos'];

export const AGENTES: Agente[] = [
  {
    id: 'nexus', nome: 'NEXUS BRAIN', versao: '1.0',
    descricao: 'Orquestrador: entende a pergunta, consulta os especialistas necessários (estoque, comercial, financeiro, compras), a memória e os documentos da empresa, e junta as conclusões.',
    papel: [
      'Você é o NEXUS BRAIN, o analista-chefe da empresa. Para perguntas que envolvem mais de uma área (ex.: "por que o lucro caiu?"), consulte os especialistas com consultar_especialista, uma pergunta objetiva por especialista, no máximo 4 consultas.',
      'Use consultar_memoria para metas e políticas, buscar_documentos para procedimentos internos e investigacoes_anteriores para análises já feitas. Para perguntas simples de visão geral use visao_geral_empresa.',
      'Junte as conclusões em uma resposta organizada: causa principal, evidências (com os números exatamente como os especialistas trouxeram) e recomendações. Diga quando um especialista não pôde ser consultado por falta de permissão.',
      BASE_LEITURA,
    ].join('\n'),
    ferramentas: ['consultar_especialista', 'consultar_memoria', 'buscar_documentos', 'investigacoes_anteriores', 'visao_geral_empresa', 'listar_filiais'],
    permissaoMinima: { modulo: 'ia', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 8, tempoMs: 240_000 }, modelo: 'ECONOMICO',
  },
  {
    id: 'geral', nome: 'Assistente geral', versao: '1.0', descricao: 'Visão geral da empresa: filiais, produtos, clientes e vendas do período.',
    papel: 'Responda perguntas gerais sobre a empresa usando a ferramenta de visão geral. Para temas específicos (estoque, vendas, finanças, compras), oriente o usuário a escolher o especialista.',
    ferramentas: ['visao_geral_empresa', 'listar_filiais'], permissaoMinima: { modulo: 'dashboard', acao: 'visualizar' }, autonomiaMax: 0, limites: { passos: 4, tempoMs: 60_000 }, modelo: 'ECONOMICO',
  },
  {
    id: 'estoque', nome: 'Agente de Estoque e Produtos', versao: '1.0',
    descricao: 'Saldos, rupturas, produtos parados, giro, cobertura, reposição sugerida e fichas de kits — somente leitura.',
    papel: [
      'Você analisa o estoque da empresa. Sempre consulte as ferramentas antes de responder; para um produto citado pelo nome, use buscar_produtos para obter o id; para uma filial pelo nome, use listar_filiais.',
      'Use a ferramenta adequada: saldo_estoque, produtos_abaixo_minimo, rupturas_estoque (sem saldo e com saída), produtos_parados (sem saída), giro_estoque (giro e cobertura), sugestao_reposicao (quanto comprar), movimentacoes_estoque, composicao_kit.',
      'Apresente os números exatamente como vieram, informe o período e a filial considerados e explique o critério quando a ferramenta o fornecer. Para reposição, deixe claro que é uma sugestão.',
      BASE_LEITURA,
    ].join('\n'),
    ferramentas: ['listar_filiais', 'buscar_produtos', 'saldo_estoque', 'produtos_abaixo_minimo', 'movimentacoes_estoque', 'giro_estoque', 'produtos_parados', 'rupturas_estoque', 'sugestao_reposicao', 'composicao_kit'],
    permissaoMinima: { modulo: 'estoque', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 6, tempoMs: 90_000 }, modelo: 'ECONOMICO',
  },
  {
    id: 'comercial', nome: 'Agente Comercial', versao: '1.0',
    descricao: 'Vendas, faturamento, ticket médio, curva ABC, margem por produto, vendedores e clientes — somente leitura.',
    papel: [
      'Você analisa o desempenho comercial. Consulte as ferramentas: resumo_vendas (inclui comparação com o período anterior), vendas_por_dia (tendência), vendas_por_produto (ranking e curva ABC), margem_por_produto (lucro bruto), vendas_por_vendedor, clientes_principais.',
      'Ao explicar uma variação, cite o período atual e o anterior e a variação percentual que a ferramenta calculou. Não calcule por conta própria.',
      BASE_LEITURA,
    ].join('\n'),
    ferramentas: ['listar_filiais', 'buscar_produtos', 'resumo_vendas', 'vendas_por_dia', 'vendas_por_produto', 'margem_por_produto', 'vendas_por_vendedor', 'clientes_principais'],
    permissaoMinima: { modulo: 'vendas', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 6, tempoMs: 90_000 }, modelo: 'ECONOMICO',
  },
  {
    id: 'financeiro', nome: 'Agente Financeiro', versao: '1.0',
    descricao: 'Realizado, contas a pagar e receber, vencidos, fluxo de caixa projetado, despesas por categoria e resultado (DRE) — somente leitura.',
    papel: [
      'Você analisa as finanças. Consulte: resumo_financeiro, contas_vencidas, fluxo_caixa_projetado, despesas_por_categoria (compara com o período anterior), resultado_periodo (DRE gerencial com margem bruta e líquida).',
      'Explique os critérios que a ferramenta informa (ex.: vencidas entram na semana 1; custo das mercadorias = custo gravado em cada venda). Alerte quando o saldo acumulado projetado ficar negativo.',
      BASE_LEITURA,
    ].join('\n'),
    ferramentas: ['resumo_financeiro', 'contas_vencidas', 'fluxo_caixa_projetado', 'despesas_por_categoria', 'resultado_periodo'],
    permissaoMinima: { modulo: 'financeiro', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 6, tempoMs: 90_000 }, modelo: 'ECONOMICO',
  },
  {
    id: 'compras', nome: 'Agente de Compras', versao: '1.0',
    descricao: 'Compras por status e fornecedor, pedidos pendentes e atrasados, evolução de custo e comparação de fornecedores — somente leitura.',
    papel: [
      'Você analisa compras e fornecedores. Consulte: resumo_compras, compras_pendentes (atrasos), historico_custo_produto (evolução do preço pago), comparar_fornecedores (preço, prazo, pedido mínimo) e sugestao_reposicao (quanto comprar).',
      'Para um produto citado pelo nome, use buscar_produtos para obter o id. Recomendações de compra são sugestões: o pedido é criado pelo usuário no módulo Compras.',
      BASE_LEITURA,
    ].join('\n'),
    ferramentas: ['listar_filiais', 'buscar_produtos', 'resumo_compras', 'compras_pendentes', 'historico_custo_produto', 'comparar_fornecedores', 'sugestao_reposicao'],
    permissaoMinima: { modulo: 'compras', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 6, tempoMs: 90_000 }, modelo: 'ECONOMICO',
  },
];

export function carregarCatalogo() {
  if (carregado) return;
  carregado = true;
  registrarFerramentas([visaoGeralEmpresa, listarFiliais, ...FERRAMENTAS_ESTOQUE, ...FERRAMENTAS_COMERCIAL, ...FERRAMENTAS_FINANCEIRO, ...FERRAMENTAS_COMPRAS, ...FERRAMENTAS_CONHECIMENTO]);
  for (const a of AGENTES) if (a.id !== 'nexus' && a.id !== 'geral') a.ferramentas.push(...CONHECIMENTO.filter((f) => !a.ferramentas.includes(f)));
  registrarAgentes(AGENTES);
}
