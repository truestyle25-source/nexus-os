import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';

export async function assinaturaRoutes(app: FastifyInstance) {
  app.get('/assinatura', { preHandler: [(app as any).authenticate] }, async (req:any, reply) => {
    const assinatura = await prisma.assinatura.findUnique({ where: { empresaId: req.user.empresaId } });
    if (!assinatura) return reply.status(404).send({ error: 'Assinatura não encontrada.' });
    const now = new Date();
    const status = assinatura.status === 'TRIAL' && now > assinatura.trialFim ? 'EXPIRADA' : assinatura.status;
    if (status !== assinatura.status) await prisma.assinatura.update({ where: { id: assinatura.id }, data: { status: status as any } });
    return { ...assinatura, status, checkoutUrl: assinatura.checkoutUrl || process.env.INFINITEPAY_CHECKOUT_URL || null };
  });

  // Apenas prepara o registro local do ciclo de cobrança. A confirmação de pagamento
  // deve vir de uma integração oficial/documentada da InfinitePay; não liberamos acesso por clique.
  app.post('/assinatura/checkout', { preHandler: [(app as any).authenticate, await permissaoMiddleware('empresa', 'visualizar')] }, async (req:any, reply) => {
    const assinatura = await prisma.assinatura.findUnique({ where: { empresaId: req.user.empresaId } });
    if (!assinatura) return reply.status(404).send({ error: 'Assinatura não encontrada.' });
    const checkoutUrl = assinatura.checkoutUrl || process.env.INFINITEPAY_CHECKOUT_URL;
    if (!checkoutUrl) return reply.status(503).send({ error: 'Checkout InfinitePay não configurado.' });
    return { checkoutUrl, valorMensal: Number(assinatura.valorMensal), aviso: 'O acesso não é liberado por clique. A ativação depende de confirmação oficial do pagamento.' };
  });
}
