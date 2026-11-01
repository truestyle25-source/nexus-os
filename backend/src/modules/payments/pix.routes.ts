import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { encryptSecret, decryptSecret } from '../../lib/secrets.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { ErroDeNegocio } from '../../lib/erros.js';
import { mensagemPixProviderIndisponivel, pixProviderConfigurado } from './pixProvider.js';

const TIPOS_CHAVE = ['CPF', 'CNPJ', 'PHONE', 'EMAIL', 'RANDOM'] as const;

const pixSettingsSchema = z.object({
  enabled: z.boolean(),
  keyType: z.enum(TIPOS_CHAVE),
  pixKey: z.string().trim().min(1).max(77),
  merchantName: z.string().trim().min(1).max(25),
  merchantCity: z.string().trim().min(1).max(15),
  document: z.string().trim().max(18).optional().or(z.literal('')),
});

function validaChavePorTipo(keyType: (typeof TIPOS_CHAVE)[number], pixKey: string): void {
  const chave = pixKey.trim();
  if (keyType === 'CPF' && !/^\d{11}$/.test(chave.replace(/\D/g, ''))) {
    throw new Error('Chave CPF deve ter 11 dígitos.');
  }
  if (keyType === 'CNPJ' && !/^\d{14}$/.test(chave.replace(/\D/g, ''))) {
    throw new Error('Chave CNPJ deve ter 14 dígitos.');
  }
  if (keyType === 'PHONE') {
    const digitos = chave.replace(/\D/g, '');
    if (!/^\d{10,13}$/.test(digitos)) throw new Error('Chave telefone: celular com DDD (ex.: +5511999998888).');
  }
  if (keyType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chave)) {
    throw new Error('Chave e-mail inválida.');
  }
  if (keyType === 'RANDOM' && !/^[0-9a-fA-F-]{32,36}$/.test(chave)) {
    throw new Error('Chave aleatória deve ser o UUID gerado pelo banco.');
  }
}

function mascaraChave(chave: string): string {
  const limpa = chave.trim();
  if (limpa.length <= 6) return '••••••';
  return `${limpa.slice(0, 3)}••••••${limpa.slice(-2)}`;
}

export async function pixRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/settings/pix',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] },
    async (req: FastifyRequest) => {
      const empresaId = (req as any).user.empresaId as string;
      const cfg = await prisma.pixSettings.findUnique({ where: { empresaId } });
      if (!cfg) return { enabled: false, providerConfigured: pixProviderConfigurado, keyType: 'RANDOM', pixKey: '', pixKeyMasked: '', merchantName: '', merchantCity: '', document: '' };
      let descriptografada = '';
      try { descriptografada = decryptSecret(cfg.pixKey); } catch { descriptografada = ''; }
      return {
        enabled: cfg.enabled && pixProviderConfigurado, providerConfigured: pixProviderConfigurado, keyType: cfg.keyType, pixKey: '',
        pixKeyMasked: descriptografada ? mascaraChave(descriptografada) : '••••••',
        merchantName: cfg.merchantName, merchantCity: cfg.merchantCity, document: cfg.document ?? '',
      };
    },
  );

  app.put(
    '/api/v1/settings/pix',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] },
    async (req: FastifyRequest) => {
      const user = (req as any).user;
      const data = pixSettingsSchema.parse(req.body);
      validaChavePorTipo(data.keyType, data.pixKey);
      if (data.enabled && !pixProviderConfigurado) throw new ErroDeNegocio(mensagemPixProviderIndisponivel, 503);
      const criptografada = encryptSecret(data.pixKey.trim());
      const salva = await prisma.pixSettings.upsert({
        where: { empresaId: user.empresaId },
        update: {
          enabled: data.enabled, keyType: data.keyType, pixKey: criptografada,
          merchantName: data.merchantName.trim(), merchantCity: data.merchantCity.trim(),
          document: data.document?.trim() || null,
        },
        create: {
          empresaId: user.empresaId, enabled: data.enabled, keyType: data.keyType, pixKey: criptografada,
          merchantName: data.merchantName.trim(), merchantCity: data.merchantCity.trim(),
          document: data.document?.trim() || null,
        },
      });
      await registrarAuditoria({
        usuarioId: user.id, empresaId: user.empresaId, acao: 'ALTERAR_CONFIG',
        entidade: 'PixSettings', entidadeId: salva.id,
        valorNovo: { enabled: salva.enabled, keyType: salva.keyType } as never,
        origem: 'MANUAL', ip: (req as any).ip,
      });
      return { ok: true, enabled: salva.enabled };
    },
  );
  app.post(
    '/api/v1/pdv/pix/generate',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] },
    async (_req: FastifyRequest, reply: FastifyReply) => reply.status(503).send({ error: mensagemPixProviderIndisponivel }),
  );

  app.post(
    '/api/v1/pdv/pix/confirm',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'editar')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.status(503).send({
        error: 'Confirmação manual desabilitada: este servidor não tem um provider PIX configurado para validar o pagamento.',
      });
    },
  );

  app.post(
    '/api/v1/pdv/pix/:txid/status',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('pdv', 'visualizar')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      return reply.status(503).send({ error: mensagemPixProviderIndisponivel });
    },
  );

  app.post('/api/v1/webhooks/pix/:tenantId', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(503).send({
      error: 'Webhook PIX indisponível: nenhum provider com validação de assinatura está configurado.',
    });
  });
}
