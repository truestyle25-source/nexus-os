/**
 * Foto do produto (NEXUS CLUB, F-Foto): enviar/trocar e remover.
 *
 *   POST   /produtos/:id/imagem   { arquivo: { nome, base64 } }  → { foto: { miniatura, lista, detalhe } }
 *   DELETE /produtos/:id/imagem                                   → { removida: boolean }
 *
 * O arquivo vem em base64 dentro de JSON, o mesmo formato dos anexos de Compras,
 * Fornecedores e RH (sem plugin de multipart). Regras em `produto-foto.ts`.
 * Isolamento: o produto é buscado por id + empresaId do token; a chave nova nasce
 * com o empresaId na frente; os arquivos antigos são apagados ao trocar/remover.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { enviarObjeto, montaChave, removerObjeto, storageConfigurado } from '../../lib/storage.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { FOTO_TAMANHO_MAXIMO_BYTES, VALIDADE_LINK_FICHA_S, chavesDaFoto, linksDasFotos, processarFoto, validarArquivoFoto } from './produto-foto.js';

/** Folga acima dos 5 MB (base64 ≈ +33%) para que 6–8 MB recebam a mensagem clara de tamanho, e não o 413 genérico. */
const LIMITE_CORPO = 12 * 1024 * 1024;

async function apagarFotos(req: FastifyRequest, base: string): Promise<void> {
  for (const chave of Object.values(chavesDaFoto(base))) {
    try {
      await removerObjeto(chave);
    } catch (e) {
      // Não desfaz a troca já gravada: o arquivo órfão fica no log para limpeza.
      req.log.warn({ err: e, chave }, 'foto do produto: falha ao apagar arquivo antigo');
    }
  }
}

export async function produtoFotoRoutes(app: FastifyInstance): Promise<void> {
  const editar = [app.authenticate, await permissaoMiddleware('produtos', 'editar')];

  app.post('/produtos/:id/imagem', { preHandler: editar, bodyLimit: LIMITE_CORPO }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const d = z.object({ arquivo: z.object({ nome: z.string().trim().min(1).max(200), base64: z.string().min(1) }) }).parse(req.body);
    const produto = await prisma.produto.findFirst({ where: { id, empresaId }, select: { id: true, imagemChave: true } });
    if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
    if (!storageConfigurado()) throw new ErroDeNegocio('Armazenamento de arquivos não configurado. Use um link de imagem por enquanto.', 503);

    const corpo = Buffer.from(d.arquivo.base64, 'base64');
    const formato = validarArquivoFoto(d.arquivo.nome, corpo);
    const tamanhos = await processarFoto(corpo, formato);

    const base = montaChave(empresaId, 'produtos', 'webp');
    const chaves = chavesDaFoto(base);
    const enviadas: string[] = [];
    try {
      for (const nome of Object.keys(chaves) as Array<keyof typeof chaves>) {
        await enviarObjeto(chaves[nome], tamanhos[nome], 'image/webp');
        enviadas.push(chaves[nome]);
      }
    } catch (e) {
      for (const c of enviadas) await removerObjeto(c).catch(() => undefined);
      req.log.error({ err: e }, 'foto do produto: falha no envio ao armazenamento');
      throw new ErroDeNegocio('Não foi possível guardar a foto agora. Tente de novo.', 502);
    }

    // Grava só se a foto não mudou no meio do caminho (dois envios ao mesmo tempo).
    const gravado = await prisma.produto.updateMany({ where: { id, empresaId, imagemChave: produto.imagemChave }, data: { imagemChave: base } });
    if (gravado.count !== 1) {
      await apagarFotos(req, base);
      throw new ErroDeNegocio('A foto deste produto foi alterada por outra pessoa agora. Abra a ficha de novo.', 409);
    }
    if (produto.imagemChave) await apagarFotos(req, produto.imagemChave);

    await registrarAuditoria({
      usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Produto', entidadeId: id,
      valorAnterior: { foto: produto.imagemChave ? 'enviada' : null },
      valorNovo: { foto: produto.imagemChave ? 'trocada' : 'enviada', bytesOriginal: corpo.length, formatoOriginal: formato },
      origem: 'MANUAL', ip: req.ip, contexto: 'Aba PDV (foto do produto)',
    });
    const links = (await linksDasFotos(empresaId, [base], VALIDADE_LINK_FICHA_S)).get(base) ?? null;
    return reply.status(201).send({ foto: links });
  });

  app.delete('/produtos/:id/imagem', { preHandler: editar }, async (req) => {
    const { id } = req.params as { id: string };
    const empresaId = req.user.empresaId;
    const produto = await prisma.produto.findFirst({ where: { id, empresaId }, select: { id: true, imagemChave: true } });
    if (!produto) throw NaoEncontrado('Produto não encontrado nesta empresa.');
    if (!produto.imagemChave) return { removida: false };
    const gravado = await prisma.produto.updateMany({ where: { id, empresaId, imagemChave: produto.imagemChave }, data: { imagemChave: null } });
    if (gravado.count !== 1) throw new ErroDeNegocio('A foto deste produto foi alterada por outra pessoa agora. Abra a ficha de novo.', 409);
    await apagarFotos(req, produto.imagemChave);
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId, acao: 'EDITAR', entidade: 'Produto', entidadeId: id,
      valorAnterior: { foto: 'enviada' }, valorNovo: { foto: null },
      origem: 'MANUAL', ip: req.ip, contexto: 'Aba PDV (foto do produto removida)',
    });
    return { removida: true };
  });
}
