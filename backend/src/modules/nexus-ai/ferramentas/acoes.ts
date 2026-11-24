/**
 * Ferramentas de PROPOSTA (Fase 06). Elas não alteram nada no negócio: só registram uma
 * proposta no motor de aprovação (aprovacoes.service.ts) com parâmetros validados e impacto
 * calculado. Quem executa é um usuário com permissão, na tela Aprovações (ou uma política de
 * automação ligada pela empresa, nível 3).
 */
import { z } from 'zod';
import type { Ferramenta } from '../tipos.js';
import { criarProposta } from '../aprovacoes.service.js';

export const proporCompraReposicao: Ferramenta<{ produtoId: string; quantidade: number; fornecedorId?: string; motivo?: string }> = {
  nome: 'propor_compra_reposicao',
  descricao: 'Prepara uma PROPOSTA de pedido de compra em rascunho para repor um produto (não cria o pedido). Use o id do produto devolvido por outra ferramenta e uma quantidade calculada por ferramenta (ex.: previsao_demanda ou sugestao_reposicao). A proposta fica aguardando aprovação na tela Aprovações.',
  parametros: { type: 'object', properties: {
    produtoId: { type: 'string', description: 'Id do produto (de uma ferramenta, nunca inventado).' },
    quantidade: { type: 'number', description: 'Quantidade a comprar, vinda de um cálculo de ferramenta.' },
    fornecedorId: { type: 'string', description: 'Id do fornecedor; se omitido, usa o fornecedor padrão do produto.' },
    motivo: { type: 'string', description: 'Justificativa curta (ex.: "estoque acaba em 4 dias").' },
  }, required: ['produtoId', 'quantidade'] },
  validar: z.object({ produtoId: z.string().min(1).max(40), quantidade: z.coerce.number().positive().max(1_000_000), fornecedorId: z.string().max(40).optional(), motivo: z.string().max(300).optional() }),
  permissao: { modulo: 'compras', acao: 'visualizar' },
  async executar(ctx, args) {
    if (!ctx.usuarioId) return { erro: 'Propostas só podem ser preparadas a pedido de um usuário.' };
    try {
      const ap = await criarProposta({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, filialId: ctx.filialId ?? null, acao: 'criar_compra_rascunho', args, execucaoId: ctx.execucaoId ?? null });
      return {
        aprovacaoId: ap.id, status: ap.status, titulo: ap.titulo, impacto: ap.impacto,
        valorEstimado: ap.valorCentavos != null ? ap.valorCentavos / 100 : null,
        jaExistia: ap.reaproveitada,
        observacao: ap.status === 'EXECUTADA' ? 'Executada pela política de automação da empresa.' : 'Aguardando aprovação de um usuário com permissão de criar compras (tela Aprovações). Nada foi criado ainda.',
      };
    } catch (e) {
      return { erro: e instanceof Error ? e.message : 'Não foi possível preparar a proposta.' };
    }
  },
};

export const FERRAMENTAS_ACOES = [proporCompraReposicao];
