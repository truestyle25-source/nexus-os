
import { prisma } from '../../config/prisma';

export const pdvService = {
  abrirCaixa(data: any) {
    return prisma.caixa.create({ data: { ...data, status: 'ABERTO' } });
  },
  fecharCaixa(id: string, data: any) {
    return prisma.caixa.update({ where: { id }, data: { ...data, status: 'FECHADO', fechadoEm: new Date() } });
  },
  getCaixaAtual() {
    return prisma.caixa.findFirst({ where: { status: 'ABERTO' }, orderBy: { abertoEm: 'desc' } });
  },
  async criarVenda(data: any) {
    const { itens, ...vendaData } = data;
    return prisma.venda.create({
      data: {
        ...vendaData,
        itens: { create: itens }
      },
      include: { itens: true }
    });
  },
  listVendas() {
    return prisma.venda.findMany({ include: { itens: true }, orderBy: { criadoEm: 'desc' }, take: 100 });
  }
};
