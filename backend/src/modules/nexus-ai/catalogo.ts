/**
 * Registro único de ferramentas e agentes (carregado uma vez). Cada fase acrescenta aqui.
 */
import { registrarFerramentas } from './ferramentas/registro.js';
import { registrarAgentes } from './agentes/registro.js';
import { listarFiliais, visaoGeralEmpresa } from './ferramentas/geral.js';
import { FERRAMENTAS_ESTOQUE } from './ferramentas/estoque.js';

let carregado = false;

export function carregarCatalogo() {
  if (carregado) return;
  carregado = true;
  registrarFerramentas([visaoGeralEmpresa, listarFiliais, ...FERRAMENTAS_ESTOQUE]);
  registrarAgentes([
    {
      id: 'geral', nome: 'Assistente geral', versao: '1.0', descricao: 'Visão geral da empresa: filiais, produtos, clientes e vendas do período.',
      papel: 'Responda perguntas gerais sobre a empresa usando a ferramenta de visão geral. Para temas específicos (estoque, finanças, compras), oriente o usuário a escolher o especialista.',
      ferramentas: ['visao_geral_empresa'], permissaoMinima: { modulo: 'dashboard', acao: 'visualizar' }, autonomiaMax: 0, limites: { passos: 4, tempoMs: 60_000 }, modelo: 'ECONOMICO',
    },
    {
      id: 'estoque', nome: 'Agente de Estoque e Produtos', versao: '1.0',
      descricao: 'Saldos, rupturas, produtos parados, giro, cobertura, reposição sugerida e fichas de kits — somente leitura.',
      papel: [
        'Você analisa o estoque da empresa. Sempre consulte as ferramentas antes de responder; para um produto citado pelo nome, use buscar_produtos para obter o id.',
        'Use a ferramenta adequada: saldo_estoque (saldo de um produto), produtos_abaixo_minimo, rupturas_estoque (sem saldo e com saída), produtos_parados (sem saída), giro_estoque (giro e cobertura), sugestao_reposicao (quanto comprar), movimentacoes_estoque, composicao_kit.',
        'Apresente os números exatamente como vieram, informe o período e a filial considerados e explique o critério quando a ferramenta o fornecer.',
        'Você é somente leitura: pode recomendar, mas não cria pedidos nem altera estoque. Para reposição, deixe claro que é uma sugestão.',
      ].join('\n'),
      ferramentas: ['listar_filiais', 'buscar_produtos', 'saldo_estoque', 'produtos_abaixo_minimo', 'movimentacoes_estoque', 'giro_estoque', 'produtos_parados', 'rupturas_estoque', 'sugestao_reposicao', 'composicao_kit'],
      permissaoMinima: { modulo: 'estoque', acao: 'visualizar' }, autonomiaMax: 1, limites: { passos: 6, tempoMs: 90_000 }, modelo: 'ECONOMICO',
    },
  ]);
}
