/**
 * Registro único de ferramentas e agentes (carregado uma vez). Cada fase acrescenta aqui.
 */
import { registrarFerramentas } from './ferramentas/registro.js';
import { registrarAgentes } from './agentes/registro.js';
import { visaoGeralEmpresa } from './ferramentas/geral.js';

let carregado = false;

export function carregarCatalogo() {
  if (carregado) return;
  carregado = true;
  registrarFerramentas([visaoGeralEmpresa]);
  registrarAgentes([
    {
      id: 'geral', nome: 'Assistente geral', versao: '1.0', descricao: 'Visão geral da empresa: filiais, produtos, clientes e vendas do período.',
      papel: 'Responda perguntas gerais sobre a empresa usando a ferramenta de visão geral. Para temas específicos (estoque, finanças, compras), oriente o usuário a escolher o especialista.',
      ferramentas: ['visao_geral_empresa'], permissaoMinima: { modulo: 'dashboard', acao: 'visualizar' }, autonomiaMax: 0, limites: { passos: 4, tempoMs: 60_000 }, modelo: 'ECONOMICO',
    },
  ]);
}
