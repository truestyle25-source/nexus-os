/**
 * NEXUS CLUB — Fase 5: área do cliente (rotas /club, consumidor autenticado).
 *
 *  GET  /club/lojas?busca=                    clubes ativos e públicos (encontrar loja)
 *  GET  /club/clubes                          meus clubes
 *  POST /club/clubes/:clube/entrar            entrar no clube (liga ao cliente da loja pelo CPF)
 *  POST /club/clubes/:clube/sair              sair (revoga as autorizações daquele clube)
 *  GET  /club/clubes/:clube                   detalhes: benefício, autorizações, texto de autorização
 *  PUT  /club/clubes/:clube/consentimentos/:canal   autorizar/revogar mensagens por canal
 *  GET  /club/clubes/:clube/consentimentos/historico
 *  GET  /club/clubes/:clube/compras           compras nesta loja (só as ligadas a mim)
 *  GET  /club/eu/exportar                     baixar meus dados (LGPD)
 *  POST /club/eu/encerrar                     excluir minha conta NEXUS CLUB
 *
 * Isolamento: o consumidor só enxerga o que é dele (regras da Fase 2). A empresa de um clube é
 * aberta (comEmpresaDoConsumidor) SÓ depois de conferir no servidor a carteirinha da pessoa.
 * Nada de estoque, custo, funcionários ou dados internos da loja volta para o cliente.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { CanalConsentimento } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { decryptSecret } from '../../lib/secrets.js';
import { hashSenha, verificarSenha } from '../../lib/auth.js';
import { normalizeCpf, formatCpf } from '../../domain/cpf.js';
import { comEmpresaDoConsumidor, comoSistema } from '../../lib/tenant-context.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { autenticarConsumidor, exigirClube, type ConsumidorAutenticado } from './consumidor-auth.routes.js';
import { registrarConsentimento, termosVigentes } from './consentimento.service.js';

const CANAIS: CanalConsentimento[] = ['WHATSAPP', 'EMAIL', 'APP'];
const num = (v: unknown) => (v == null ? null : Number(v));
const quem = (req: FastifyRequest) => ((req as any).consumidor as ConsumidorAutenticado).id;

const auditarClube = (d: { empresaId?: string; consumidorId: string; contexto: string; ip?: string }) =>
  comoSistema('club:auditoria', () => registrarAuditoria({
    empresaId: d.empresaId, acao: 'EDITAR', entidade: 'MembroClube', entidadeId: d.consumidorId, origem: 'NEXUS_CLUB', ip: d.ip, contexto: d.contexto,
  })).catch(() => undefined);

/**
 * Clube visível para a pessoa: ativo e público, ou do qual ela participa. Conferido aqui no código
 * E nas regras do banco (defesa dupla: o código não depende do papel com que o banco é acessado).
 */
export async function clubeVisivel(clubeId: string, consumidorId: string) {
  const c = await prisma.clubeConfig.findUnique({ where: { id: clubeId } });
  if (!c || !c.ativo) throw NaoEncontrado('Clube não encontrado.');
  if (!c.publico && !(await carteirinha(consumidorId, c.empresaId))) throw NaoEncontrado('Clube não encontrado.');
  return c;
}

async function carteirinha(consumidorId: string, empresaId: string) {
  return prisma.membroClube.findUnique({ where: { empresaId_consumidorId: { empresaId, consumidorId } } });
}

/** Carteirinha ativa (ou aguardando a loja escolher o cadastro) — senão 403. */
export async function exigirMembro(consumidorId: string, empresaId: string) {
  const m = await carteirinha(consumidorId, empresaId);
  if (!m || (m.status !== 'ATIVO' && m.status !== 'PENDENTE_VINCULO')) throw new ErroDeNegocio('Você não participa deste clube.', 403);
  return m;
}

const resumoClube = (c: { id: string; nome: string; corPrimaria: string | null; beneficioPercentual: unknown; limiteBeneficio: unknown }) => ({
  id: c.id, nome: c.nome, cor: c.corPrimaria, beneficioPercentual: num(c.beneficioPercentual), limiteBeneficio: num(c.limiteBeneficio),
});

export async function areaClienteRoutes(app: FastifyInstance): Promise<void> {
  const autenticado = [exigirClube, autenticarConsumidor];

  app.get('/club/lojas', { preHandler: autenticado }, async (req) => {
    const { busca } = z.object({ busca: z.string().trim().max(80).optional() }).parse(req.query);
    const lista = await prisma.clubeConfig.findMany({
      where: { ativo: true, publico: true, ...(busca ? { nome: { contains: busca, mode: 'insensitive' } } : {}) },
      orderBy: { nome: 'asc' }, take: 50,
    });
    const meus = new Set((await prisma.membroClube.findMany({ where: { consumidorId: quem(req), status: { in: ['ATIVO', 'PENDENTE_VINCULO'] } }, select: { empresaId: true } })).map((m) => m.empresaId));
    return lista.map((c) => ({ ...resumoClube(c), participo: meus.has(c.empresaId) }));
  });

  app.get('/club/clubes', { preHandler: autenticado }, async (req) => {
    const membros = await prisma.membroClube.findMany({ where: { consumidorId: quem(req), status: { in: ['ATIVO', 'PENDENTE_VINCULO'] } }, orderBy: { entrouEm: 'asc' } });
    const clubes = await prisma.clubeConfig.findMany({ where: { empresaId: { in: membros.map((m) => m.empresaId) }, ativo: true } });
    const porEmpresa = new Map(clubes.map((c) => [c.empresaId, c]));
    return membros.filter((m) => porEmpresa.has(m.empresaId)).map((m) => ({
      ...resumoClube(porEmpresa.get(m.empresaId)!), status: m.status, entrouEm: m.entrouEm,
    }));
  });

  app.post('/club/clubes/:clube/entrar', { preHandler: autenticado }, async (req, reply) => {
    const id = quem(req);
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    const atual = await carteirinha(id, clube.empresaId);
    if (atual?.status === 'BLOQUEADO') throw new ErroDeNegocio('Sua participação neste clube está bloqueada. Fale com a loja.', 403);
    if (atual && atual.status !== 'SAIU') return { status: atual.status };

    const conta = await prisma.contaConsumidor.findUniqueOrThrow({ where: { id }, select: { nome: true, email: true, celular: true, whatsapp: true, cpfCifrado: true } });
    let cpf = '';
    try { cpf = normalizeCpf(decryptSecret(conta.cpfCifrado)); } catch { /* sem CPF legível: cria cadastro novo sem documento */ }

    const resultado = await comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      // Liga ao cadastro que a loja já tem com este CPF (sem duplicar). Mais de um: a loja escolhe.
      const existentes = cpf.length === 11
        ? await prisma.cliente.findMany({ where: { empresaId: clube.empresaId, documento: { in: [cpf, formatCpf(cpf)] } }, select: { id: true } })
        : [];
      let clienteId: string | null = null;
      let status: 'ATIVO' | 'PENDENTE_VINCULO' = 'ATIVO';
      if (existentes.length === 1) clienteId = existentes[0].id;
      else if (existentes.length > 1) status = 'PENDENTE_VINCULO';
      else {
        const novo = await prisma.cliente.create({
          data: { empresaId: clube.empresaId, nome: conta.nome, documento: cpf || null, email: conta.email, telefone: conta.whatsapp || conta.celular || null, origem: 'NEXUS_CLUB' },
          select: { id: true },
        });
        clienteId = novo.id;
      }
      const dados = { status, clienteId: clienteId ?? atual?.clienteId ?? null, saiuEm: null, entrouEm: new Date() };
      const m = atual
        ? await prisma.membroClube.update({ where: { id: atual.id }, data: dados })
        : await prisma.membroClube.create({ data: { empresaId: clube.empresaId, consumidorId: id, ...dados } });
      return { status: m.status, novoCadastro: existentes.length === 0 };
    });
    await auditarClube({ empresaId: clube.empresaId, consumidorId: id, ip: req.ip, contexto: `NEXUS CLUB: entrou no clube (${resultado.status === 'PENDENTE_VINCULO' ? 'loja precisa escolher o cadastro' : resultado.novoCadastro ? 'cadastro de cliente criado' : 'ligado ao cadastro existente'})` });
    return reply.status(atual ? 200 : 201).send({ status: resultado.status });
  });

  app.post('/club/clubes/:clube/sair', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    const m = await exigirMembro(id, clube.empresaId);
    await comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      // Sair revoga na hora todas as autorizações de mensagens deste clube.
      const ativos = await prisma.consentimentoAtual.findMany({ where: { empresaId: clube.empresaId, consumidorId: id, situacao: 'CONCEDIDO' }, select: { canal: true } });
      for (const a of ativos) await registrarConsentimento({ empresaId: clube.empresaId, consumidorId: id, canal: a.canal, acao: 'REVOGADO', origem: 'APP', ip: req.ip });
      await prisma.membroClube.update({ where: { id: m.id }, data: { status: 'SAIU', saiuEm: new Date(), codigoQr: null, codigoQrGeradoEm: null } });
    });
    await auditarClube({ empresaId: clube.empresaId, consumidorId: id, ip: req.ip, contexto: 'NEXUS CLUB: saiu do clube (autorizações revogadas)' });
    return { ok: true };
  });

  app.get('/club/clubes/:clube', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    const m = await exigirMembro(id, clube.empresaId);
    return comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      const [autorizacao] = await termosVigentes(['AUTORIZACAO_MARKETING'], clube.empresaId);
      const atuais = await prisma.consentimentoAtual.findMany({ where: { empresaId: clube.empresaId, consumidorId: id } });
      const porCanal = new Map(atuais.map((a) => [a.canal, a]));
      return {
        clube: resumoClube(clube),
        membro: { status: m.status, entrouEm: m.entrouEm },
        autorizacao: autorizacao ? { id: autorizacao.id, versao: autorizacao.versao, texto: autorizacao.texto } : null,
        consentimentos: CANAIS.map((canal) => ({ canal, autorizado: porCanal.get(canal)?.situacao === 'CONCEDIDO', atualizadoEm: porCanal.get(canal)?.atualizadoEm ?? null })),
      };
    });
  });

  app.put('/club/clubes/:clube/consentimentos/:canal', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const { clube: clubeId, canal } = z.object({ clube: z.string(), canal: z.enum(['WHATSAPP', 'EMAIL', 'APP']) }).parse(req.params);
    const d = z.object({ autorizar: z.boolean(), termoVersaoId: z.string().optional() }).parse(req.body);
    const clube = await clubeVisivel(clubeId, id);
    const m = await exigirMembro(id, clube.empresaId);
    if (d.autorizar && m.status !== 'ATIVO') throw new ErroDeNegocio('A loja ainda está confirmando o seu cadastro. Tente mais tarde.', 409);
    return comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      if (d.autorizar) {
        const [vigente] = await termosVigentes(['AUTORIZACAO_MARKETING'], clube.empresaId);
        if (!vigente) throw new ErroDeNegocio('Esta loja ainda não publicou o texto de autorização de mensagens.', 409);
        if (d.termoVersaoId !== vigente.id) throw new ErroDeNegocio('O texto de autorização mudou. Leia a versão atual e autorize de novo.', 409);
      }
      const r = await registrarConsentimento({ empresaId: clube.empresaId, consumidorId: id, canal, acao: d.autorizar ? 'CONCEDIDO' : 'REVOGADO', origem: 'APP', termoVersaoId: d.autorizar ? d.termoVersaoId : null, ip: req.ip });
      return { canal, autorizado: r.atual.situacao === 'CONCEDIDO', atualizadoEm: r.atual.atualizadoEm };
    });
  });

  app.get('/club/clubes/:clube/consentimentos/historico', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    await exigirMembro(id, clube.empresaId);
    const eventos = await prisma.consentimentoEvento.findMany({
      where: { empresaId: clube.empresaId, consumidorId: id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, canal: true, acao: true, origem: true, createdAt: true, termoVersao: { select: { versao: true } } },
    });
    return eventos.map((e) => ({ id: e.id, canal: e.canal, acao: e.acao, origem: e.origem, data: e.createdAt, versaoTexto: e.termoVersao?.versao ?? null }));
  });

  app.get('/club/clubes/:clube/compras', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const clube = await clubeVisivel((req.params as { clube: string }).clube, id);
    const m = await exigirMembro(id, clube.empresaId);
    if (!m.clienteId) return [];
    return comEmpresaDoConsumidor(id, clube.empresaId, async () => {
      const vendas = await prisma.venda.findMany({
        where: { empresaId: clube.empresaId, clienteId: m.clienteId!, status: 'FINALIZADA' },
        orderBy: { createdAt: 'desc' }, take: 50,
        select: { id: true, createdAt: true, total: true, desconto: true, _count: { select: { itens: true } } },
      });
      return vendas.map((v) => ({ id: v.id, data: v.createdAt, total: Number(v.total), desconto: Number(v.desconto), itens: v._count.itens }));
    });
  });

  // ---------------------------------------------------------------- LGPD: meus dados
  app.get('/club/eu/exportar', { preHandler: autenticado }, async (req) => {
    const id = quem(req);
    const conta = await prisma.contaConsumidor.findUniqueOrThrow({ where: { id } });
    let cpf: string | null = null;
    try { cpf = formatCpf(normalizeCpf(decryptSecret(conta.cpfCifrado))); } catch { cpf = null; }
    const [aceites, membros, eventos] = await Promise.all([
      prisma.termoAceite.findMany({ where: { consumidorId: id }, select: { aceitoEm: true, ip: true, termoVersao: { select: { tipo: true, versao: true } } }, orderBy: { aceitoEm: 'asc' } }),
      prisma.membroClube.findMany({ where: { consumidorId: id }, select: { empresaId: true, status: true, entrouEm: true, saiuEm: true } }),
      prisma.consentimentoEvento.findMany({ where: { consumidorId: id }, select: { empresaId: true, canal: true, acao: true, origem: true, createdAt: true, ip: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const nomes = new Map((await prisma.clubeConfig.findMany({ where: { empresaId: { in: [...new Set([...membros, ...eventos].map((x) => x.empresaId))] } }, select: { empresaId: true, nome: true } })).map((c) => [c.empresaId, c.nome]));
    const clube = (empresaId: string) => nomes.get(empresaId) ?? 'Clube';
    await auditarClube({ consumidorId: id, ip: req.ip, contexto: 'NEXUS CLUB: exportou os próprios dados' });
    return {
      geradoEm: new Date().toISOString(),
      conta: { nome: conta.nome, email: conta.email, cpf, celular: conta.celular, whatsapp: conta.whatsapp, nascimento: conta.nascimento?.toISOString().slice(0, 10) ?? null, status: conta.status, criadaEm: conta.createdAt, emailVerificadoEm: conta.emailVerificadoEm },
      termosAceitos: aceites.map((a) => ({ termo: a.termoVersao.tipo, versao: a.termoVersao.versao, aceitoEm: a.aceitoEm, ip: a.ip })),
      clubes: membros.map((m) => ({ clube: clube(m.empresaId), situacao: m.status, entrouEm: m.entrouEm, saiuEm: m.saiuEm })),
      autorizacoes: eventos.map((e) => ({ clube: clube(e.empresaId), canal: e.canal, acao: e.acao, origem: e.origem, data: e.createdAt, ip: e.ip })),
      observacao: 'Compras feitas nas lojas pertencem ao cadastro de cada loja; peça a cada uma, se quiser.',
    };
  });

  app.post('/club/eu/encerrar', { preHandler: autenticado }, async (req, reply) => {
    const id = quem(req);
    const { senha, confirmo } = z.object({ senha: z.string().min(1).max(200), confirmo: z.literal(true) }).parse(req.body);
    const conta = await prisma.contaConsumidor.findUniqueOrThrow({ where: { id }, select: { senhaHash: true } });
    if (!(await verificarSenha(senha, conta.senhaHash))) return reply.status(400).send({ error: 'Senha incorreta.' });

    // 1) Sai de todos os clubes, revogando as autorizações (o histórico fica, como prova da revogação).
    const membros = await prisma.membroClube.findMany({ where: { consumidorId: id, status: { not: 'SAIU' } }, select: { id: true, empresaId: true } });
    for (const m of membros) {
      await comEmpresaDoConsumidor(id, m.empresaId, async () => {
        const ativos = await prisma.consentimentoAtual.findMany({ where: { empresaId: m.empresaId, consumidorId: id, situacao: 'CONCEDIDO' }, select: { canal: true } });
        for (const a of ativos) await registrarConsentimento({ empresaId: m.empresaId, consumidorId: id, canal: a.canal, acao: 'REVOGADO', origem: 'APP', ip: req.ip });
        await prisma.membroClube.update({ where: { id: m.id }, data: { status: 'SAIU', saiuEm: new Date(), codigoQr: null, codigoQrGeradoEm: null } });
      });
    }
    // 2) Anonimiza a conta: e-mail e CPF ficam livres para um cadastro novo; ninguém mais entra nela.
    const agora = new Date();
    await prisma.contaConsumidor.update({
      where: { id },
      data: {
        nome: 'Conta encerrada', email: `encerrada-${id}@removido.invalid`, cpfHash: `encerrada-${id}-${randomBytes(8).toString('hex')}`, cpfCifrado: '',
        celular: null, whatsapp: null, nascimento: null, senhaHash: await hashSenha(randomBytes(24).toString('hex')),
        status: 'ENCERRADA', encerradaEm: agora, sessoesValidasDesde: agora,
      },
    });
    await auditarClube({ consumidorId: id, ip: req.ip, contexto: `NEXUS CLUB: conta encerrada pela pessoa (saiu de ${membros.length} clube(s); dados pessoais anonimizados)` });
    return { ok: true };
  });
}
