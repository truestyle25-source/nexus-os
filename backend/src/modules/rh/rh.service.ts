
import { prisma } from '../../config/prisma.js';

export const rhService = {
  listFuncionarios() {
    return prisma.funcionario.findMany({ include: { cargo: true } });
  },
  createFuncionario(data: any) {
    return prisma.funcionario.create({ data });
  },
  updateFuncionario(id: string, data: any) {
    return prisma.funcionario.update({ where: { id }, data });
  },
  deleteFuncionario(id: string) {
    return prisma.funcionario.delete({ where: { id } });
  },
  listPonto() {
    return prisma.ponto.findMany({ orderBy: { dataHora: 'desc' }, take: 100 });
  },
  registrarPonto(data: any) {
    return prisma.ponto.create({ data });
  }
};
