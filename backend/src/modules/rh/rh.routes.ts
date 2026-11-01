
import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { decryptSecret, encryptSecret } from '../../lib/secrets.js';
import { ErroDeNegocio } from '../../lib/erros.js';
// Fuso da empresa: decide a que dia pertence uma marcação de ponto.
import { dataNoFuso, instanteNaHoraLocal, normalizarFuso } from '../../lib/fuso.js';
import { fecharExpediente } from './ponto-fechamento.service.js';
import {
  TAMANHO_MAXIMO_BYTES, baixarObjeto, configStorage, contentTypeDe, enviarObjeto,
  extensaoDe, montaChave, removerObjeto, storageConfigurado, validaTamanho,
} from '../../lib/storage.js';
import { montarVerbas, devePagarMulta, diasDeContrato, TIPOS_DESLIGAMENTO } from './verbas.js';
import { dataBr, valorBr, empresaDoUsuario } from './rh.utils.js';
import { gerarPdf, type Bloco } from '../../lib/pdf.js';
import type { TipoAviso } from './verbas.js';

/**
 * Gerador de PDF mínimo, sem dependência externa.
 *
 * POR QUE EXISTE
 * --------------
 * As rotas de documento de RH gravavam apenas o NOME do arquivo no banco e
 * respondiam "PDF gerado". Nenhum byte de PDF era produzido: não havia
 * biblioteca instalada nem rota de download, e o botão da tela virava um
 * texto que não baixava nada. Um termo de advertência é documento legal —
 * dizer que ele existe sem que exista é pior que não oferecer o recurso.
 *
 * O QUE FAZ
 * ---------
 * Monta um PDF 1.4 válido (A4, fontes base-14 Helvetica) direto no buffer:
 * cabeçalho, objetos, xref e trailer. É um subconjunto deliberado — texto
 * com quebra de linha automática, negrito, três alinhamentos e paginação —
 * o suficiente para termo de advertência, notificação de suspensão e termo
 * de rescisão, que são documentos de texto.
 *
 * A fonte usa `/WinAnsiEncoding`, então os acentos do português (á, ã, ç, é…)
 * saem corretos sem embutir arquivo de fonte.
 */

const A4_LARGURA = 595.28; // pt



/**
 * Larguras oficiais dos glifos de Helvetica (unidades/1000 em), códigos 32..126.
 * Sem esta tabela o gerador não quebra linha: estimar por média de caracteres
 * estourava a margem em títulos e cortava a última linha.
 */


export type Alinhamento = 'esquerda' | 'centro' | 'direita';


const textoOpcional = (v: unknown): string | undefined => {
  const t = typeof v === 'string' ? v.trim() : '';
  return t === '' ? undefined : t;
};

/** Campo de data opcional: string vazia/inválida vira `undefined`. */
const dataOpcional = (v: unknown): Date | undefined => {
  const t = textoOpcional(v);
  if (!t) return undefined;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Horário previsto da jornada (`HH:MM`) vindo do formulário.
 *
 * POR QUE VALIDA AQUI E NÃO SÓ NO ZOD
 * ------------------------------------
 * A criação (`POST /funcionarios`) passa pelo schema do Zod, mas a edição
 * (`PUT /funcionarios/:id`) recebe `req.body` cru e não valida nada. Se a
 * checagem do formato ficasse só no Zod, o mesmo campo aceitaria "8h" pelo
 * cadastro e recusaria "8h" pela edição — e o valor recusado viraria ATRASO na
 * folha. Validando aqui, os dois caminhos têm a mesma regra.
 *
 * Devolve `null` (e não `undefined`) porque a edição monta o objeto de update
 * inteiro: um campo omitido manteria o valor anterior quando o RH apaga o
 * horário, e o cadastro passaria a mentir.
 */
const horarioPrevisto = (v: unknown, campo: string): string | null => {
  const t = textoOpcional(v);
  if (t === undefined) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
    throw new ErroDeNegocio(`${campo} deve estar no formato HH:MM (ex.: 08:00).`, 422);
  }
  return t;
};

/**
 * Lê um horário previsto do cadastro, ignorando valor fora do formato.
 *
 * A entrada pode vir de importação ou de cadastro antigo com o campo sujo
 * ("8h", "08:00:00"). O Ponto não pode quebrar por isso: usa o padrão 08:00 /
 * 18:00 e o dado inválido fica visível para o RH corrigir, em vez de virar
 * NaN num cálculo de atraso.
 */
const horarioPrevistoDoFuncionario = (
  f: { horarioEntradaPrevisto?: string | null; horarioSaidaPrevisto?: string | null } | null | undefined,
  campo: 'horarioEntradaPrevisto' | 'horarioSaidaPrevisto',
): string | undefined => {
  const v = f?.[campo];
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? v.trim() : undefined;
};

/**
 * Reduz um rótulo para comparar nomes: sem acento, sem caixa e sem espaço extra
 * nas pontas.
 *
 * É o que impede "Financeiro", "financeiro " e "FinancEIro" de virarem três
 * departamentos diferentes. Sem isto, a empresa digita o mesmo setor de três
 * formas ao longo de um mês e o Radar passa a mostrar três grupos para a mesma
 * equipe — que é exatamente o problema que a lista de opções fixa resolvia.
 */
const chaveRotulo = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Resolve o departamento digitado no formulário para um departamento REAL.
 *
 * POR QUE NÃO BASTA GUARDAR O TEXTO
 * ---------------------------------
 * `departamentoId` é chave estrangeira usada pelo Radar para agrupar a equipe e
 * pela aba de Departamentos para contar gente. Um funcionário só com texto
 * apareceria como "Sem departamento" no Radar — o cadastro aceitaria e a empresa
 * perderia a leitura.
 *
 * POR QUE NÃO CRIAR COLUNA DE TEXTO NO FUNCIONÁRIO
 * -----------------------------------------------
 * Por que o departamento renomeado passaria a ter duas verdades: o texto no
 * cadastro diria "Vendas" e o vínculo diria "Comercial". A tela teria que
 * escolher uma. Resolvendo para o cadastro, renomear continua valendo para
 * todo mundo, como já valia.
 *
 * O QUE FAZ
 * ---------
 * Texto vazio → `null` (funcionário sem departamento, como antes com "—").
 * Texto que já existe → devolve o `id` do departamento, sem criar nada.
 * Texto novo → cria o departamento na empresa e devolve o `id`.
 */
const resolverDepartamento = async (
  empresaId: string,
  texto: unknown,
  idExplicito: unknown,
): Promise<string | null> => {
  // O id explícito vem da sugestão da lista: quando o gestor escolhe uma
  // opção que já existe, respeitamos a escolha sem recriar nada.
  const id = textoOpcional(idExplicito);
  if (id) {
    const achado = await prisma.departamento.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!achado) throw new ErroDeNegocio('Departamento inválido para esta empresa.', 422);
    return achado.id;
  }
  const nome = textoOpcional(texto);
  if (!nome) return null;
  const existente = await prisma.departamento.findMany({
    where: { empresaId },
    select: { id: true, nome: true },
  });
  const igual = existente.find((d) => chaveRotulo(d.nome) === chaveRotulo(nome));
  if (igual) return igual.id;
  const criado = await prisma.departamento.create({
    data: { empresaId, nome },
    select: { id: true },
  });
  return criado.id;
};

/**
 * Resolve o cargo digitado no mesmo espírito do departamento.
 *
 * O cargo não recebe o departamento do funcionário de propósito: um "Analista"
 * pode existir na empresa inteira, e vinculá-lo ao departamento da pessoa que
 * por último o escolheu faria o cargo mudar de dono sozinho. Quem quiser
 * organizar cargos por departamento usa a aba de Cargos, que é o lugar disso.
 */
const resolverCargo = async (
  empresaId: string,
  texto: unknown,
  idExplicito: unknown,
): Promise<string | null> => {
  const id = textoOpcional(idExplicito);
  if (id) {
    const achado = await prisma.cargo.findFirst({ where: { id, empresaId }, select: { id: true } });
    if (!achado) throw new ErroDeNegocio('Cargo inválido para esta empresa.', 422);
    return achado.id;
  }
  const nome = textoOpcional(texto);
  if (!nome) return null;
  const existentes = await prisma.cargo.findMany({
    where: { empresaId },
    select: { id: true, nome: true },
  });
  const igual = existentes.find((c) => chaveRotulo(c.nome) === chaveRotulo(nome));
  if (igual) return igual.id;
  const criado = await prisma.cargo.create({
    data: { empresaId, nome },
    select: { id: true },
  });
  return criado.id;
};

const MES_INICIO = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const DIA_INICIO = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export async function rhRoutes(app: FastifyInstance) {
  // Departamentos
  app.get('/departamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.departamento.findMany({ where: { empresaId: req.user.empresaId }, include: { cargos: true, _count: { select: { funcionarios: true } } } });
  });
  app.post('/departamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const { nome, descricao } = req.body as any;
    const dep = await prisma.departamento.create({ data: { empresaId: req.user.empresaId, nome, descricao } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Departamento', entidadeId: dep.id, valorNovo: dep, origem: 'MANUAL', ip: req.ip });
    return dep;
  });

  /**
   * Renomeia um departamento.
   *
   * Antes só existia POST: um departamento com nome errado ou duplicado ficava
   * assim para sempre, e o `<select>` do cadastro de funcionário era a única
   * forma de usá-lo. Alterar o nome NÃO mexe nos funcionários vinculados nem
   * nos cargos — a relação continua a mesma, só o rótulo muda.
   */
  app.put('/departamentos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any) => {
    const { nome, descricao } = z.object({ nome: z.string().min(2), descricao: z.string().optional() }).parse(req.body ?? {});
    const anterior = await prisma.departamento.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!anterior) throw new ErroDeNegocio('Departamento não encontrado nesta empresa.', 404);
    const dep = await prisma.departamento.update({ where: { id: anterior.id }, data: { nome: nome.trim(), descricao: textoOpcional(descricao) ?? null } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'Departamento',
      entidadeId: dep.id, valorAnterior: { nome: anterior.nome, descricao: anterior.descricao },
      valorNovo: { nome: dep.nome, descricao: dep.descricao }, origem: 'MANUAL', ip: req.ip,
    });
    return dep;
  });

  /**
   * Exclui um departamento.
   *
   * Com funcionários ou cargos vinculados a exclusão é recusada (409) em vez de
   * cascade silencioso: apagar um departamento levaria junto o cargo e o
   * vínculo de pessoas que o usuário não pediu para remover. A resposta diz
   * quantos estão vinculados, para a tela poder explicar.
   */
  app.delete('/departamentos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const dep = await prisma.departamento.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { _count: { select: { cargos: true, funcionarios: true } } },
    });
    if (!dep) throw new ErroDeNegocio('Departamento não encontrado nesta empresa.', 404);
    if (dep._count.cargos > 0 || dep._count.funcionarios > 0) {
      throw new ErroDeNegocio(
        `Não é possível excluir: o departamento tem ${dep._count.cargos} cargo(s) e ${dep._count.funcionarios} funcionário(s) vinculado(s). Remova os vínculos primeiro.`,
        409,
      );
    }
    await prisma.departamento.delete({ where: { id: dep.id } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EXCLUIR', entidade: 'Departamento',
      entidadeId: dep.id, valorAnterior: { nome: dep.nome }, origem: 'MANUAL', ip: req.ip,
    });
    return { ok: true };
  });

  // Cargos
  app.get('/cargos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.cargo.findMany({ where: { empresaId: req.user.empresaId }, include: { departamento: true } });
  });
  app.post('/cargos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const { nome, departamentoId, descricao } = req.body as any;
    if (departamentoId) {
      const dep = await prisma.departamento.findFirst({ where: { id: departamentoId, empresaId: req.user.empresaId } });
      if (!dep) throw new ErroDeNegocio('Departamento inválido para esta empresa.');
    }
    const cargo = await prisma.cargo.create({ data: { empresaId: req.user.empresaId, nome, departamentoId, descricao } });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Cargo', entidadeId: cargo.id, valorNovo: cargo, origem: 'MANUAL', ip: req.ip });
    return cargo;
  });
  /**
   * Renomeia um cargo e/ou move-o de departamento.
   *
   * Enviar `departamentoId: null` desvincula o cargo do departamento; omitir o
   * campo mantém o vínculo atual. Sem essa distinção, mover um cargo para
   * outro departamento seria indistinguível de limpar o campo.
   */
  app.put('/cargos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any) => {
    const { nome, departamentoId, descricao } = z
      .object({ nome: z.string().min(2), departamentoId: z.string().nullish(), descricao: z.string().optional() })
      .parse(req.body ?? {});
    const anterior = await prisma.cargo.findFirst({ where: { id: req.params.id, empresaId: req.user.empresaId } });
    if (!anterior) throw new ErroDeNegocio('Cargo não encontrado nesta empresa.', 404);
    if (departamentoId) {
      const dep = await prisma.departamento.findFirst({ where: { id: departamentoId, empresaId: req.user.empresaId } });
      if (!dep) throw new ErroDeNegocio('Departamento inválido para esta empresa.');
    }
    const cargo = await prisma.cargo.update({
      where: { id: anterior.id },
      data: {
        nome: nome.trim(),
        descricao: textoOpcional(descricao) ?? null,
        ...(departamentoId === null ? { departamentoId: null } : departamentoId ? { departamentoId } : {}),
      },
    });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'Cargo',
      entidadeId: cargo.id, valorAnterior: { nome: anterior.nome, departamentoId: anterior.departamentoId },
      valorNovo: { nome: cargo.nome, departamentoId: cargo.departamentoId }, origem: 'MANUAL', ip: req.ip,
    });
    return cargo;
  });

  /** Exclui um cargo — recusado (409) se houver funcionário vinculado a ele. */
  app.delete('/cargos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const cargo = await prisma.cargo.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { _count: { select: { funcionarios: true } } },
    });
    if (!cargo) throw new ErroDeNegocio('Cargo não encontrado nesta empresa.', 404);
    if (cargo._count.funcionarios > 0) {
      throw new ErroDeNegocio(
        `Não é possível excluir: ${cargo._count.funcionarios} funcionário(s) está(ão) vinculado(s) a este cargo. Troque o cargo dessas pessoas primeiro.`,
        409,
      );
    }
    await prisma.cargo.delete({ where: { id: cargo.id } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EXCLUIR', entidade: 'Cargo',
      entidadeId: cargo.id, valorAnterior: { nome: cargo.nome }, origem: 'MANUAL', ip: req.ip,
    });
    return { ok: true };
  });


  // Funcionários Seção 20 - CPF único, idExternoPonto
  app.get('/funcionarios', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    // ARQUIVADO fica DE FORA da lista de ativos — é o contrato que a própria
    // rota de arquivamento promete ("o arquivado sai da lista de ativos, mas
    // continua preservado"). Sem este filtro, arquivar não tirava ninguém da
    // tela: o status mudava no banco e a lista seguia mostrando o funcionário,
    // em Ponto inclusive (quem está arquivado não bate ponto).
    // Quem precisa ver o histórico usa `GET /rh/funcionarios/arquivados`.
    return prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId, status: { not: 'ARQUIVADO' } },
      include: { cargo: true, departamento: true },
      orderBy: { createdAt: 'desc' },
    });
  });
  /**
   * Benefícios (VA e VR) a partir do corpo da requisição.
   *
   * VA e VR são independentes: o funcionário pode não receber nenhum, receber
   * só um, ou receber os dois. Cada um tem seu próprio toggle e seu próprio
   * valor — não existe um "benefício" único com um valor, porque são
   * contratados separadamente.
   *
   * VALOR É ZERADO QUANDO O BENEFÍCIO ESTÁ DESLIGADO, e é isso que evita
   * pagamento fantasma: marcar "Sim", digitar 300 e voltar para "Não" deixaria
   * o valor 300 gravado, e a folha — que respeita o toggle — não pagaria, mas
   * o cadastro continuaria mostrando um valor que não vale nada. Zerar mantém o
   * registro coerente com o que a folha vai usar.
   *
   * Valores negativos são recusados: um benefício de -R$ 50 viraria desconto.
   */
  const beneficiosDoFuncionario = (d: any) => {
    const alvo = d as { valeAlimentacao?: boolean; valorValeAlimentacao?: unknown; valeRefeicao?: boolean; valorValeRefeicao?: unknown };
    const temVA = alvo.valeAlimentacao === true;
    const temVR = alvo.valeRefeicao === true;
    const numero = (v: unknown, campo: string): number => {
      if (v === undefined || v === null || v === '') return 0;
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) throw new ErroDeNegocio(`Valor de ${campo} inválido. Use um número maior ou igual a zero.`, 422);
      return n;
    };
    return {
      valeAlimentacao: temVA,
      valorValeAlimentacao: temVA ? numero(alvo.valorValeAlimentacao, 'vale-alimentação') : 0,
      valeRefeicao: temVR,
      valorValeRefeicao: temVR ? numero(alvo.valorValeRefeicao, 'vale-refeição') : 0,
    };
  };

  app.post('/funcionarios', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const schema = z.object({
      nome: z.string().min(2),
      cpf: z.string().optional(),
      idExternoPonto: z.string().optional(),
      departamentoId: z.string().optional(),
      cargoId: z.string().optional(),
      // Texto LIVRE digitado no formulário. O servidor resolve contra os
      // cadastros da empresa e cria o que não existir, em vez de recusar —
      // é o que permite escrever qualquer departamento ou cargo.
      departamentoTexto: z.string().max(120).optional(),
      cargoTexto: z.string().max(120).optional(),
      filialId: z.string().optional(),
      usuarioId: z.string().optional(),
      dataAdmissao: z.string().optional(),
      dataDesligamento: z.string().optional(),
      dataNascimento: z.string().optional(),
      email: z.string().optional(),
      telefone: z.string().optional(),
      rg: z.string().optional(),
      cep: z.string().optional(),
      endereco: z.string().optional(),
      fotoUrl: z.string().optional(),
      salario: z.union([z.number(), z.string()]).optional(),
      tipoContrato: z.string().optional(),
      cargaHoraria: z.string().optional(),
      jornada: z.string().optional(),
      // Horários previstos da jornada, separados. `HH:MM` é validado no formato
      // porque a diferença entre a batida real e o previsto vira ATRASO na
      // folha: aceitar "8h" ou "08:00:00" aqui produziria um número sem sentido
      // mais tarde, com muito mais dificuldade de diagnóstico. Vazio é ausente,
      // não "00:00".
      horarioEntradaPrevisto: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário previsto de entrada deve estar no formato HH:MM (ex.: 08:00).').optional().or(z.literal('')),
      horarioSaidaPrevisto: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário previsto de saída deve estar no formato HH:MM (ex.: 17:00).').optional().or(z.literal('')),
      biometriaId: z.string().optional(),
      matricula: z.string().optional(),
      pis: z.string().optional(),
      re: z.string().optional(),
      observacoes: z.string().optional(),
      status: z.enum(['ATIVO','INATIVO','FERIAS','AFASTADO','DESLIGADO']).optional(),
      // Benefícios. VA e VR são independentes: cada um com seu toggle e seu
      // próprio valor. Declarados aqui porque o `parse` do Zod devolve um
      // objeto NOVO com apenas as chaves do schema — campo não declarado
      // simplesmente não existe depois do parse.
      valeAlimentacao: z.boolean().optional(),
      valorValeAlimentacao: z.union([z.number(), z.string()]).optional(),
      valeRefeicao: z.boolean().optional(),
      valorValeRefeicao: z.union([z.number(), z.string()]).optional(),
      origem: z.enum(['MANUAL','IMPORTADO','API','AUTOMATICO']).default('MANUAL')
    });
    const data = schema.parse(req.body);
    if (data.filialId) { const f=await prisma.filial.findFirst({where:{id:data.filialId,empresaId:req.user.empresaId}}); if(!f)throw new Error('Filial inválida para esta empresa.'); }
    if (data.departamentoId) { const d=await prisma.departamento.findFirst({where:{id:data.departamentoId,empresaId:req.user.empresaId}}); if(!d)throw new Error('Departamento inválido para esta empresa.'); }
    if (data.cargoId) { const c=await prisma.cargo.findFirst({where:{id:data.cargoId,empresaId:req.user.empresaId}}); if(!c)throw new Error('Cargo inválido para esta empresa.'); }
    // Departamento e cargo resolvidos a partir do TEXTO digitado. O id explícito
    // (escolha de uma sugestão) tem prioridade; sem ele, o texto é casado com
    // o cadastro existente ou vira um cadastro novo — é o que permite escrever
    // qualquer departamento ou cargo sem sair das opções pré-cadastradas.
    const departamentoId = await resolverDepartamento(req.user.empresaId, data.departamentoTexto, data.departamentoId);
    const cargoId = await resolverCargo(req.user.empresaId, data.cargoTexto, data.cargoId);
    if (data.usuarioId) {
      const u = await prisma.usuario.findFirst({ where: { id: data.usuarioId, empresaId: req.user.empresaId } });
      if (!u) throw new Error('Usuário inválido para esta empresa.');
      const vinculo = await prisma.funcionario.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: data.usuarioId } });
      if (vinculo) throw new Error(`Este usuário já está vinculado ao funcionário ${vinculo.nome}.`);
    }
    // CPF único validação
    if (data.cpf) {
      const existe = await prisma.funcionario.findFirst({ where: { cpf: data.cpf, empresaId: req.user.empresaId } });
      if (existe) throw new Error('CPF já cadastrado - CPF único Seção 20');
    }
    const func = await prisma.funcionario.create({
      data: {
        empresaId: req.user.empresaId,
        filialId: textoOpcional(data.filialId),
        departamentoId,
        cargoId,
        usuarioId: textoOpcional(data.usuarioId),
        nome: data.nome,
        cpf: textoOpcional(data.cpf),
        idExternoPonto: textoOpcional(data.idExternoPonto),
        dataAdmissao: dataOpcional(data.dataAdmissao) ?? null,
        dataDesligamento: dataOpcional(data.dataDesligamento) ?? null,
        dataNascimento: dataOpcional(data.dataNascimento) ?? null,
        email: textoOpcional(data.email),
        telefone: textoOpcional(data.telefone),
        rg: textoOpcional(data.rg),
        cep: textoOpcional(data.cep),
        endereco: textoOpcional(data.endereco),
        fotoUrl: textoOpcional(data.fotoUrl),
        salario: data.salario === undefined || data.salario === '' ? null : Number(data.salario),
        tipoContrato: textoOpcional(data.tipoContrato),
        cargaHoraria: textoOpcional(data.cargaHoraria),
        jornada: textoOpcional(data.jornada),
        horarioEntradaPrevisto: horarioPrevisto(data.horarioEntradaPrevisto, 'Horário previsto de entrada') ?? undefined,
        horarioSaidaPrevisto: horarioPrevisto(data.horarioSaidaPrevisto, 'Horário previsto de saída') ?? undefined,
        biometriaId: textoOpcional(data.biometriaId),
        matricula: textoOpcional(data.matricula),
        pis: textoOpcional(data.pis),
        re: textoOpcional(data.re),
        observacoes: textoOpcional(data.observacoes),
        status: data.status ?? 'ATIVO',
        origem: data.origem as any,
        ...beneficiosDoFuncionario(data)
      }
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Funcionario', entidadeId: func.id, valorNovo: func, origem: data.origem as any, ip: req.ip });
    return func;
  });

  // Edição do cadastro — o mockup reusa o mesmo formulário para adicionar e editar.
  app.put('/funcionarios/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any) => {
    const { id } = req.params as any;
    const anterior = await prisma.funcionario.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!anterior) throw new ErroDeNegocio('Funcionário não encontrado nesta empresa.', 404);
    const data = req.body as any;
    if (data.filialId) { const f=await prisma.filial.findFirst({where:{id:data.filialId,empresaId:req.user.empresaId}}); if(!f)throw new Error('Filial inválida para esta empresa.'); }
    if (data.departamentoId) { const d=await prisma.departamento.findFirst({where:{id:data.departamentoId,empresaId:req.user.empresaId}}); if(!d)throw new Error('Departamento inválido para esta empresa.'); }
    if (data.cargoId) { const c=await prisma.cargo.findFirst({where:{id:data.cargoId,empresaId:req.user.empresaId}}); if(!c)throw new Error('Cargo inválido para esta empresa.'); }
    // Mesma resolução do cadastro: o texto digitado na edição vira o mesmo
    // vínculo, e um rótulo novo continua criando o departamento/cargo.
    const departamentoId = await resolverDepartamento(req.user.empresaId, data.departamentoTexto, data.departamentoId);
    const cargoId = await resolverCargo(req.user.empresaId, data.cargoTexto, data.cargoId);
    if (data.usuarioId) {
      const u = await prisma.usuario.findFirst({ where: { id: data.usuarioId, empresaId: req.user.empresaId } });
      if (!u) throw new Error('Usuário inválido para esta empresa.');
      const vinculo = await prisma.funcionario.findFirst({ where: { empresaId: req.user.empresaId, usuarioId: data.usuarioId } });
      if (vinculo && vinculo.id !== id) throw new Error(`Este usuário já está vinculado ao funcionário ${vinculo.nome}.`);
    }
    if (data.cpf) {
      const existe = await prisma.funcionario.findFirst({ where: { cpf: data.cpf, empresaId: req.user.empresaId } });
      if (existe && existe.id !== id) throw new Error('CPF já cadastrado - CPF único Seção 20');
    }
    const statusValidos = ['ATIVO','INATIVO','FERIAS','AFASTADO','DESLIGADO'];
    const status: "ATIVO" | "INATIVO" | "FERIAS" | "AFASTADO" | "DESLIGADO" | undefined =
      typeof data.status === 'string' && statusValidos.includes(data.status) ? data.status : undefined;
    const desligamento = dataOpcional(data.dataDesligamento);
    const atualizado = await prisma.funcionario.update({
      where: { id },
      data: {
        nome: textoOpcional(data.nome),
        cpf: textoOpcional(data.cpf),
        filialId: textoOpcional(data.filialId) ?? null,
        departamentoId,
        cargoId,
        usuarioId: textoOpcional(data.usuarioId) ?? null,
        idExternoPonto: textoOpcional(data.idExternoPonto) ?? null,
        dataAdmissao: dataOpcional(data.dataAdmissao) ?? null,
        dataNascimento: dataOpcional(data.dataNascimento) ?? null,
        dataDesligamento: desligamento ?? (status === 'DESLIGADO' ? anterior.dataDesligamento ?? new Date() : null),
        email: textoOpcional(data.email) ?? null,
        telefone: textoOpcional(data.telefone) ?? null,
        rg: textoOpcional(data.rg) ?? null,
        cep: textoOpcional(data.cep) ?? null,
        endereco: textoOpcional(data.endereco) ?? null,
        fotoUrl: textoOpcional(data.fotoUrl) ?? null,
        salario: data.salario === undefined || data.salario === '' ? null : Number(data.salario),
        tipoContrato: textoOpcional(data.tipoContrato) ?? null,
        cargaHoraria: textoOpcional(data.cargaHoraria) ?? null,
        jornada: textoOpcional(data.jornada) ?? null,
        horarioEntradaPrevisto: horarioPrevisto(data.horarioEntradaPrevisto, 'Horário previsto de entrada'),
        horarioSaidaPrevisto: horarioPrevisto(data.horarioSaidaPrevisto, 'Horário previsto de saída'),
        biometriaId: textoOpcional(data.biometriaId) ?? null,
        matricula: textoOpcional(data.matricula) ?? null,
        pis: textoOpcional(data.pis) ?? null,
        re: textoOpcional(data.re) ?? null,
        observacoes: textoOpcional(data.observacoes) ?? null,
        status,
        ...beneficiosDoFuncionario(data),
      },
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR', entidade: 'Funcionario', entidadeId: id, valorAnterior: anterior, valorNovo: atualizado, origem: 'MANUAL', ip: req.ip });
    return atualizado;
  });

  // Indicadores RH Seção 20
  // Usuários da empresa que podem ser vinculados a uma ficha de funcionário.
  // Sem esse vínculo, as vendas do PDV (Venda.funcionarioId = id do usuário)
  // não podem ser atribuídas à pessoa na aba Desempenho.
  app.get('/rh/usuarios-vinculaveis', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const [usuarios, vinculados] = await Promise.all([
      prisma.usuario.findMany({ where: { empresaId: req.user.empresaId, status: 'ATIVO' }, select: { id: true, nome: true, email: true }, orderBy: { nome: 'asc' } }),
      prisma.funcionario.findMany({ where: { empresaId: req.user.empresaId, usuarioId: { not: null } }, select: { usuarioId: true, nome: true } }),
    ]);
    const mapa = new Map<string, string>();
    for (const v of vinculados) if (v.usuarioId) mapa.set(v.usuarioId, v.nome);
    return usuarios.map((u:any) => ({ id: u.id, nome: u.nome, email: u.email, vinculadoA: mapa.get(u.id) ?? null }));
  });
  // Advertências (Seção 20 - disciplina)
  app.get('/rh/advertencias', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.advertencia.findMany({
      where: { empresaId: req.user.empresaId },
      include: { funcionario: { select: { id: true, nome: true } } },
      orderBy: { data: 'desc' },
    });
  });

  app.post('/rh/advertencias', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any, reply:any) => {
    const { funcionarioId, tipo, motivo, descricao, data, aplicadaPor } = req.body as any;
    if (!funcionarioId || !motivo) return reply.status(400).send({ error: 'Informe funcionário e motivo.' });
    const func = await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId: req.user.empresaId } });
    if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado.' });
    const adv = await prisma.advertencia.create({
      data: {
        empresaId: req.user.empresaId,
        funcionarioId,
        tipo: tipo || 'VERBAL',
        motivo,
        descricao: textoOpcional(descricao) ?? null,
        data: dataOpcional(data) ?? new Date(),
        aplicadaPor: textoOpcional(aplicadaPor) ?? null,
      },
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Advertencia', entidadeId: adv.id, valorNovo: adv, origem: 'MANUAL', ip: req.ip });
    return adv;
  });

  // Suspensões (Seção 20 - disciplina)
  app.get('/rh/suspensoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.suspensao.findMany({
      where: { empresaId: req.user.empresaId },
      include: { funcionario: { select: { id: true, nome: true } } },
      orderBy: { inicio: 'desc' },
    });
  });

  app.post('/rh/suspensoes', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any, reply:any) => {
    const { funcionarioId, dias, motivo, inicio, fim, aplicadaPor } = req.body as any;
    if (!funcionarioId || !motivo || !dias || Number(dias) <= 0) return reply.status(400).send({ error: 'Informe funcionário, dias (> 0) e motivo.' });
    // Teto de dias. Antes qualquer valor positivo era aceito e o `fim` era
    // calculado a partir dele, então um dígito a mais produzia uma suspensão de
    // anos — dado de RH irreal que ninguém corrigiria depois. 365 dias é o
    // limite máximo razoável para um período aquisitivo inteiro.
    if (Number(dias) > 365) return reply.status(422).send({ error: 'A suspensão não pode exceder 365 dias.' });
    const func = await prisma.funcionario.findFirst({ where: { id: funcionarioId, empresaId: req.user.empresaId } });
    if (!func) return reply.status(404).send({ error: 'Funcionário não encontrado.' });
    const ini = dataOpcional(inicio) ?? new Date();
    const numDias = Number(dias);
    const fimCalc = dataOpcional(fim) ?? new Date(ini.getTime() + (numDias - 1) * 86400000);
    const sus = await prisma.suspensao.create({
      data: {
        empresaId: req.user.empresaId,
        funcionarioId,
        dias: numDias,
        motivo,
        inicio: ini,
        fim: fimCalc,
        aplicadaPor: textoOpcional(aplicadaPor) ?? null,
      },
    });
    await registrarAuditoria({ usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR', entidade: 'Suspensao', entidadeId: sus.id, valorNovo: sus, origem: 'MANUAL', ip: req.ip });
    return sus;
  });



  app.get('/rh/indicadores', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const total = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId } });
    const ativos = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId, status: 'ATIVO' } });
    const porSetor = await prisma.departamento.findMany({ where: { empresaId: req.user.empresaId }, include: { _count: { select: { funcionarios: true } } } });

    // O DIA DE REFERÊNCIA É O ÚLTIMO EXPEDIENTE FECHADO (D-1), não hoje.
    //
    // A falta só é marcada no fechamento do expediente
    // (`ponto-fechamento.service.ts`), e o fechamento se recusa a apurar o dia
    // corrente — fechar o mesmo dia às 18h01 zeraria quem registrou entrada às
    // 18h05. Consequência: contando "hoje", o KPI de Faltas era
    // ESTRUTURALMENTE zero, e com ele o absenteísmo e a produtividade, mesmo
    // com dezenas de faltas gravadas no banco. A série de 6 meses (aba
    // Desempenho) e a folha continuam lendo o mês inteiro — este bloco é o do
    // último dia fechado.
    //
    // `Ponto.data` é `@db.Date`, então o dia é montado em meia-noite UTC, que é
    // como o dado foi gravado. (O Prisma converte o parâmetro para o tipo da
    // coluna, então meia-noite local daria o mesmo resultado — mas meio-noite
    // UTC deixa a intenção explícita.)
    // A busca volta dia a dia até achar um DIA ÚTIL com expediente fechado.
    //
    // Só pular um dia (D-1) não basta: cairia em sábado ou domingo com frequência
    // — fim de semana não é apurado e nunca tem falta —, e o painel mostraria
    // "Faltas: 0" numa segunda-feira como se ninguém tivesse faltado na sexta.
    // A data exibida vem junto, para o RH saber de que dia é o número.
    const empresas = await prisma.empresa.findFirst({ where: { id: req.user.empresaId }, select: { fusoHorario: true } });
    const fuso = normalizarFuso(empresas?.fusoHorario);
    const hojeISO = dataNoFuso(new Date(), fuso);
    const [hojeA, hojeM, hojeD] = hojeISO.split('-').map(Number);
    let refISO = hojeISO;
    for (let volta = 1; volta <= 7; volta++) {
      const dia = new Date(Date.UTC(hojeA, hojeM - 1, hojeD - volta));
      const dow = dia.getUTCDay();
      if (dow === 0 || dow === 6) continue; // sábado/domingo: não é dia de expediente
      refISO = dia.toISOString().slice(0, 10);
      break;
    }
    const inicioUTC = new Date(`${refISO}T00:00:00.000Z`);
    const fimUTC = new Date(Date.UTC(inicioUTC.getUTCFullYear(), inicioUTC.getUTCMonth(), inicioUTC.getUTCDate() + 1));

    const pontosRef = await prisma.ponto.findMany({
      where: { empresaId: req.user.empresaId, data: { gte: inicioUTC, lt: fimUTC } },
    });
    const faltas = pontosRef.filter(p=>p.falta).length;
    const atrasos = pontosRef.filter(p=>p.atrasoMinutos>0).length;
    const horasExtras = pontosRef.reduce((s,p)=>s+p.horaExtraMinutos,0);
    // Media REAL dos atrasos do dia. A tela mostrava "Media 12min" fixo no JSX:
    // numero que nao vinha de lugar nenhum, e que mentia tanto quando o atraso real
    // era de 3 minutos quanto quando nao havia atraso nenhum.
    const minutosAtrasoHoje = pontosRef.reduce((s, p) => s + p.atrasoMinutos, 0);
    const mediaAtraso = atrasos > 0 ? Math.round(minutosAtrasoHoje / atrasos) : 0;
    // Taxa de absenteísmo DO DIA: quem faltou dividido pelo quadro. É a mesma
    // base do numerador, então o número significa "metade da empresa faltou".
    const absenteismo = total ? (faltas/total)*100 : 0;
    // Turnover simplificado: desligados no mês / total
    const desligadosMes = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId, dataDesligamento: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } });
    const turnover = total ? (desligadosMes/total)*100 : 0;
    // Série real dos últimos 6 meses para o gráfico do painel de Desempenho.
    // absenteismoMes = (faltas no mês ÷ funcionários ativos) × 100 — não é um
    // número decorativo: sai de Ponto.falta e do headcount ativo da empresa.
    const serieAbsenteismo = [];
    const agora = new Date();
    for (let i = 5; i >= 0; i--) {
      const inicio = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const fim = new Date(agora.getFullYear(), agora.getMonth() - i + 1, 1);
      const faltasMes = await prisma.ponto.count({ where: { empresaId: req.user.empresaId, falta: true, data: { gte: inicio, lt: fim } } });
      serieAbsenteismo.push({
        mes: inicio.toISOString().slice(0, 7),
        faltas: faltasMes,
        absenteismoMes: ativos ? Number(((faltasMes / ativos) * 100).toFixed(1)) : 0,
      });
    }
    return {
      totalFuncionarios: total, ativos, porSetor, faltas, atrasos, horasExtras, absenteismo,
      turnover, produtividade: 100 - absenteismo, desligadosMes, serieAbsenteismo, mediaAtraso,
      // Dia ao qual estes números se referem. A tela mostra: sem isso, o RH
      // lê "Faltas: 2" e não tem como saber se é de hoje ou do expediente
      // anterior — que é justamente a confusão que o D-1 veio eliminar.
      diaReferencia: refISO,
      expedienteFechado: true,
    };
  });

  // Controle de Ponto Seção 21
  app.get('/ponto', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'visualizar')] }, async (req:any, reply:any) => {
    const { funcionarioId, dataInicio, dataFim, take, skip } = req.query as any;
    const where:any = { empresaId: req.user.empresaId };
    if (funcionarioId) where.funcionarioId = funcionarioId;
    if (dataInicio && dataFim) {
      // `lt` do dia SEGUINTE, e não `lte` do dia pedido: `Ponto.data` é
      // `@db.Date` e o Prisma converte o parâmetro para data, o que faz `lte`
      // funcionar por acidente. Escrever o limite explícito tira a dependência
      // dessa conversão implícita — se um dia ela mudar, o fim de mês inteiro
      // continua entrando em vez de perder o último dia.
      const fimExclusivo = new Date(new Date(`${dataFim}T00:00:00.000Z`).getTime() + 86_400_000);
      where.data = { gte: new Date(`${dataInicio}T00:00:00.000Z`), lt: fimExclusivo };
    }
    // Paginação. O `take: 2000` fixo era um corte SILENCIOSO: com 500
    // funcionários x 30 dias são 15.000 linhas, a consulta devolvia 2.000 e a
    // tela mostrava "Registros (2000)" sem aviso de que faltava o resto. Agora o
    // tamanho é controlável e, quando a página vem cheia, a resposta carrega o
    // total e a marca de truncamento — o problema deixa de ser silencioso, que
    // era o que o tornava perigoso.
    const limite = Math.min(Math.max(Number(take) || 2000, 1), 5000);
    const offset = Math.max(Number(skip) || 0, 0);
    const registros = await prisma.ponto.findMany({
      where,
      include: { funcionario: { include: { cargo: true, departamento: true } } },
      orderBy: { data: 'desc' },
      take: limite,
      skip: offset,
    });
    if (registros.length === limite) {
      const total = await prisma.ponto.count({ where });
      reply.header('X-Total-Count', String(total));
      if (total > offset + registros.length) reply.header('X-Truncated', 'true');
    }
    // Fuso da empresa num header, pelo mesmo motivo do `X-Total-Count`: a rota
    // devolve um ARRAY e mudar o formato quebraria os consumidores que já leem
    // `/ponto` (a aba Ponto e a aba RH).
    //
    // A tela precisa do fuso para mostrar hora e data: `Ponto.data` é
    // `@db.Date` (meia-noite UTC), que em São Paulo é o dia ANTERIOR — e as
    // marcações são apuradas pelo servidor no fuso da empresa. Sem este header
    // a tela não tinha como saber qual fuso usar antes da primeira marcação.
    const empresaFuso = await prisma.empresa.findFirst({
      where: { id: req.user.empresaId },
      select: { fusoHorario: true },
    });
    reply.header('X-Fuso-Empresa', normalizarFuso(empresaFuso?.fusoHorario));
    return registros;
  });

  app.post('/ponto/manual', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'criar')] }, async (req:any) => {
    // `data` deixa de ser a data escolhida na tela: quem decide o dia é o
    // servidor, no fuso da empresa. Ela continua sendo aceita para corrigir um
    // lançamento antigo — sem ela, vale o dia real de agora.
    const schema = z.object({
      funcionarioId: z.string().min(1),
      tipo: z.enum(['ENTRADA', 'SAIDA_INTERVALO', 'RETORNO', 'SAIDA']),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const marcacao = schema.parse(req.body);
    const funcionario = await prisma.funcionario.findFirst({ where: { id: marcacao.funcionarioId, empresaId: req.user.empresaId } });
    if (!funcionario) throw new ErroDeNegocio('Funcionário inválido para esta empresa.', 404);

    // Fuso da empresa: é o que decide a que dia a batida pertence. Uma
    // máquina em UTC leria 23h30 de São Paulo como 02h30 do dia seguinte, e a
    // marcação da noite cairia no dia errado.
    const empresa = await prisma.empresa.findFirst({ where: { id: req.user.empresaId }, select: { fusoHorario: true } });
    const fuso = normalizarFuso(empresa?.fusoHorario);

    // INSTANTE REAL. O cliente não manda horário: mandaria o relógio do
    // navegador, que pode estar errado, e a marcação é um fato do instante em
    // que aconteceu.
    const instante = new Date();
    const dia = marcacao.data ?? dataNoFuso(instante, fuso);
    // `Ponto.data` é `@db.Date`: o Prisma grava a parte da data, e
    // `new Date('YYYY-MM-DDT00:00:00Z')` é a meia-noite UTC que o `GET /ponto`
    // devolve de volta — o mesmo registro, sem deslocamento de fuso.
    const dataPonto = new Date(`${dia}T00:00:00.000Z`);

    // O tipo da marcação é o NOME DA COLUNA que recebe o instante. A
    // correspondência é explícita de propósito: `RETORNO` grava em
    // `retornoIntervalo`, `SAIDA_INTERVALO` em `saidaIntervalo`, e
    // `ENTRADA`/`SAIDA` diferem das colunas só pelo caixa. Derivar por
    // transformação de texto gravaria em coluna errada — o Prisma aceitaria o
    // `update` e o registro ficaria com o campo a menos, sem erro visível.
    const COLUNA: Record<typeof marcacao.tipo, 'entrada' | 'saidaIntervalo' | 'retornoIntervalo' | 'saida'> = {
      ENTRADA: 'entrada',
      SAIDA_INTERVALO: 'saidaIntervalo',
      RETORNO: 'retornoIntervalo',
      SAIDA: 'saida',
    };
    const coluna = COLUNA[marcacao.tipo];

    const ponto = await prisma.ponto.upsert({
      where: { funcionarioId_data: { funcionarioId: funcionario.id, data: dataPonto } },
      // Só o campo do tipo é tocado. Os outros ficam: registrar a saída não pode
      // apagar a entrada do mesmo dia.
      update: { [coluna]: instante, origem: 'MANUAL' },
      create: {
        empresaId: req.user.empresaId,
        funcionarioId: funcionario.id,
        data: dataPonto,
        entrada: coluna === 'entrada' ? instante : null,
        saidaIntervalo: coluna === 'saidaIntervalo' ? instante : null,
        retornoIntervalo: coluna === 'retornoIntervalo' ? instante : null,
        saida: coluna === 'saida' ? instante : null,
        origem: 'MANUAL',
      },
    });
    // Atraso e hora extra sobre a jornada PREVIDA do funcionário.
    //
    // A referência agora vem do cadastro (`horarioEntradaPrevisto` /
    // `horarioSaidaPrevisto`), e não de 08:00/18:00 fixos no código: um
    // funcionário com entrada prevista às 09:00 recebia 08:00 de comparação e
    // era marcado como atrasado em toda batida. Sem horário cadastrado, cai
    // para 08:00/18:00 — o comportamento anterior, preservado como padrão.
    //
    // As horas esperadas são montadas NO FUSO DA EMPRESA: comparar a marcação
    // (instante real) com um "08:00" montado em UTC daria três horas de atraso
    // para quem chegou pontualmente.
    const entradaPrevista = horarioPrevistoDoFuncionario(funcionario, 'horarioEntradaPrevisto') ?? '08:00';
    const saidaPrevista = horarioPrevistoDoFuncionario(funcionario, 'horarioSaidaPrevisto') ?? '18:00';
    let atraso = 0;
    let horaExtra = 0;
    let inconsistencia: string | null = null;

    if (ponto.entrada) {
      const esperado = instanteNaHoraLocal(dia, entradaPrevista, fuso);
      const diff = Math.round((ponto.entrada.getTime() - esperado.getTime()) / 60000);
      atraso = diff > 0 ? diff : 0;
    }
    if (ponto.saida) {
      const esperado = instanteNaHoraLocal(dia, saidaPrevista, fuso);
      const diff = Math.round((ponto.saida.getTime() - esperado.getTime()) / 60000);
      horaExtra = diff > 0 ? diff : 0;
    }
    // Dia sem marcação é ausência de REGISTRO, não falta de trabalho: bater
    // ponto não pode acusar o funcionário de falta. A falta de verdade é apurada
    // por `ponto-fechamento.service.ts`, quando o expediente fecha — antes
    // disso, fechar o mesmo dia zeraria quem ainda vai bater ponto. Ver também
    // POST /ponto/fechar-expediente.
    const falta = false;
    if (ponto.entrada && ponto.saida && ponto.entrada > ponto.saida) {
      inconsistencia = 'Entrada após saída';
    }
    if (ponto.saida && !ponto.entrada) {
      inconsistencia = 'Saída sem entrada';
    }

    const pontoAtualizado = await prisma.ponto.update({
      where: { id: ponto.id },
      data: { atrasoMinutos: atraso, horaExtraMinutos: horaExtra, falta, inconsistencia },
    });

    // Fluxo: PONTO -> RH -> INDICADORES -> DASHBOARD -> IA (Seção 21)
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'Ponto', entidadeId: ponto.id, valorNovo: pontoAtualizado,
      origem: 'MANUAL', ip: req.ip,
      contexto: `Marcação ${marcacao.tipo} em ${dia} (fuso ${fuso}). Ponto -> RH -> Indicadores -> Dashboard -> IA`,
    });
    // `fuso` e `dia` voltam junto para a tela confirmar o que foi gravado, sem
    // precisar recalcular a data no navegador (e errar o fuso de novo).
    return { ...pontoAtualizado, fuso, dataMarcacao: dia };
  });

  /**
   * Fecha o expediente: apura a FALTA de quem não registrou batida.
   *
   * O agendador diário chama isto sozinho (ver `scripts/scheduler.ts`). A rota
   * existe para o RH fechar na hora — ao fim do turno, ou para apurar um
   * período antigo que ficou de fora.
   *
   * Aceita `data` (YYYY-MM-DD) como referência de fuso e `ate` como último dia
   * a apurar. `ate` é o que permite fechar só um mês antigo que ficou de fora;
   * sem ele a apuração cobre os 90 dias recentes. O expediente de HOJE nunca
   * é fechado por aqui: a apuração vai até o dia anterior, para não acusar
   * falta de quem ainda vai bater ponto (o serviço recusa `ate` >= `data`).
   */
  app.post('/ponto/fechar-expediente', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'editar')] }, async (req:any) => {
    const schema = z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    });
    const { data, ate } = schema.parse(req.body ?? {});
    if (ate && data && ate >= data) {
      throw new ErroDeNegocio('"ate" tem de ser anterior a "data": o expediente de hoje ainda nao fechou.', 400);
    }
    const resumo = await fecharExpediente(req.user.empresaId, data, ate);
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'Ponto', entidadeId: `fechamento-${resumo.ate}`, valorNovo: { ...resumo },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Fechamento de expediente de ${resumo.de} ate ${resumo.ate}: ${resumo.faltasMarcadas} falta(s) marcada(s) em ${resumo.diasUteis} dia(s) uteis.`,
    });
    return resumo;
  });

  // Integração ControlID iDClass: somente endpoints documentados pelo fabricante.
  app.post('/ponto/integracao', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'criar')] }, async (req:any) => {
    const data=z.object({nome:z.string().min(2),url:z.string().url(),usuario:z.string().min(1),senha:z.string().min(1)}).parse(req.body);
    const integracao=await prisma.integracaoPonto.create({data:{empresaId:req.user.empresaId,nome:data.nome,url:data.url.replace(/\/$/,''),usuario:data.usuario,senhaCriptografada:encryptSecret(data.senha),status:'NAO_CONFIGURADO'}});
    return {integracao:{...integracao,senhaCriptografada:undefined},aviso:'Credencial armazenada criptografada no backend. A sincronização usa somente /login.fcgi, /load_objects.fcgi e /logout.fcgi da API oficial Control iD.'};
  });

  app.post('/ponto/sincronizar/:integracaoId', { preHandler: [(app as any).authenticate, await permissaoMiddleware('ponto', 'editar')] }, async (req:any,reply) => {
    const {integracaoId}=req.params; const integracao=await prisma.integracaoPonto.findFirst({where:{id:integracaoId,empresaId:req.user.empresaId}}); if(!integracao)throw new Error('Integração não encontrada nesta empresa.');
    let session:string|undefined;
    try {
      if(!integracao.senhaCriptografada) throw new Error('Credencial da integração não configurada. Reconfigure a integração.'); const senha=decryptSecret(integracao.senhaCriptografada);
      const loginResp=await fetch(`${integracao.url}/login.fcgi`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:integracao.usuario,password:senha})});
      if(!loginResp.ok)throw new Error(`Falha no login do equipamento: HTTP ${loginResp.status}`);
      const loginBody:any=await loginResp.json(); session=loginBody.session; if(!session)throw new Error('Equipamento não retornou sessão.');
      const logs:any[]=[]; let offset=0; const ultimaSync=integracao.ultimaSincronizacao?Math.floor(integracao.ultimaSincronizacao.getTime()/1000):null;
      while(true){const body:any={object:'access_logs',fields:['id','time','event','user_id'],limit:1000,offset};if(ultimaSync)body.where=[{object:'access_logs',field:'time',operator:'>',value:ultimaSync}];const logsResp=await fetch(`${integracao.url}/load_objects.fcgi?session=${encodeURIComponent(session)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!logsResp.ok)throw new Error(`Falha ao carregar access_logs: HTTP ${logsResp.status}`);const logsBody:any=await logsResp.json();const page=Array.isArray(logsBody.access_logs)?logsBody.access_logs:[];logs.push(...page);if(page.length<1000)break;offset+=1000;}
      const logsValidos=logs.filter((l:any)=>Number(l.event)===7 && l.user_id!==undefined && l.time!==undefined).sort((a:any,b:any)=>Number(a.time)-Number(b.time));
      const porFuncionario=new Map<string,any[]>();
      for(const log of logsValidos){const func=await prisma.funcionario.findFirst({where:{empresaId:req.user.empresaId,idExternoPonto:String(log.user_id)}});if(!func)continue;const dataLog=new Date(Number(log.time)*1000);const dia=new Date(Date.UTC(dataLog.getUTCFullYear(),dataLog.getUTCMonth(),dataLog.getUTCDate()));const key=`${func.id}:${dia.toISOString().slice(0,10)}`;if(!porFuncionario.has(key))porFuncionario.set(key,[]);porFuncionario.get(key)!.push({func,dataLog,log,dia});}
      let processados=0;
      for(const batidas of porFuncionario.values()){const {func,dia}=batidas[0];const ordered=batidas.slice(0,4);const dados:any={entrada:ordered[0]?.dataLog||null,saidaIntervalo:ordered[1]?.dataLog||null,retornoIntervalo:ordered[2]?.dataLog||null,saida:ordered[3]?.dataLog||null,origem:'PONTO'};const ids=ordered.map((b:any)=>String(b.log.id));const inconsistencia=batidas.length>4?'Mais de quatro batidas no dia; somente as quatro primeiras foram vinculadas aos campos disponíveis.':null;await prisma.ponto.upsert({where:{funcionarioId_data:{funcionarioId:func.id,data:dia}},update:{...dados,idExterno:ids[ids.length-1],inconsistencia},create:{empresaId:req.user.empresaId,funcionarioId:func.id,data:dia,...dados,idExterno:ids[ids.length-1],inconsistencia}});processados++;}
      await prisma.integracaoPonto.update({where:{id:integracao.id},data:{status:'CONECTADO',ultimaSincronizacao:new Date(),qtdRegistros:processados,erros:Prisma.JsonNull}});
      await fetch(`${integracao.url}/logout.fcgi?session=${encodeURIComponent(session)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})}).catch(()=>undefined);
      await registrarAuditoria({usuarioId:req.user.id,empresaId:req.user.empresaId,acao:'SINCRONIZAR',entidade:'IntegracaoPonto',entidadeId:integracao.id,origem:'PONTO',ip:req.ip,contexto:`Control iD: ${processados} registros processados`});
      return {ok:true,processados,status:'CONECTADO',metodoOficial:['POST /login.fcgi','POST /load_objects.fcgi','POST /logout.fcgi']};
    } catch(error:any) {
      await prisma.integracaoPonto.update({where:{id:integracao.id},data:{status:'ERRO',erros:{message:error?.message||'Falha na sincronização'}}}).catch(()=>undefined);
      if(session) await fetch(`${integracao.url}/logout.fcgi?session=${encodeURIComponent(session)}`,{method:'POST'}).catch(()=>undefined);
      return reply.status(502).send({error:'Falha na sincronização com o equipamento.',detalhe:error?.message||'Erro desconhecido',status:'ERRO'});
    }
  });

  // ===== RH integrado: batidas, relógio, desempenho com vendas e documentos =====

  /** Batidas de ponto por dia (alimenta o calendário e a lista "Batidas de hoje"). */
  app.get('/rh/ponto', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const { dataInicio, dataFim } = req.query as any;
    const hoje = new Date();
    // `Ponto.data` é `@db.Date` (data pura, sem hora). O frontend manda
    // "2026-09-01" e "2026-09-30", e `new Date("2026-09-30")` vira 00:00 UTC.
    // Com `lt: fim` o dia 30 inteiro ficava de fora — o filtro perdia sempre o
    // último dia do mês. Aqui o fim é EXCLUSIVO no dia seguinte.
    const fim = dataFim
      ? new Date(new Date(`${dataFim}T12:00:00`).getTime() + 24 * 60 * 60 * 1000)
      : new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const inicio = dataInicio ? new Date(`${dataInicio}T12:00:00`) : new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const registros = await prisma.ponto.findMany({
      where: { empresaId: req.user.empresaId, data: { gte: inicio, lt: fim } },
      include: { funcionario: { select: { id: true, nome: true, idExternoPonto: true } } },
      orderBy: { data: 'desc' },
      take: 5000,
    });
    return registros.map((p) => ({
      id: p.id,
      funcionarioId: p.funcionarioId,
      funcionarioNome: p.funcionario?.nome ?? '—',
      idPonto: p.funcionario?.idExternoPonto ?? null,
      data: p.data,
      entrada: p.entrada,
      saidaIntervalo: p.saidaIntervalo,
      retornoIntervalo: p.retornoIntervalo,
      saida: p.saida,
      atrasoMinutos: p.atrasoMinutos,
      falta: p.falta,
      inconsistencia: p.inconsistencia,
      // `saida: null` = jornada aberta. A tela precisa distinguir "não saiu"
      // de "não bateram ponto": sem este campo, o frontend tratava a ausência
      // de saída como se fosse batida válida.
      jornadaFechada: Boolean(p.entrada && p.saida),
      batidas: [p.entrada, p.saidaIntervalo, p.retornoIntervalo, p.saida].filter(Boolean).map((d) => d!.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })).join(' • '),
    }));
  });

  /** Status real da integração com o relógio (healthcheck + último sync). */
  app.get('/rh/relogio', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const integracao = await prisma.integracaoPonto.findFirst({ where: { empresaId: req.user.empresaId }, orderBy: { createdAt: 'desc' } });
    const comIdPonto = await prisma.funcionario.count({ where: { empresaId: req.user.empresaId, idExternoPonto: { not: null } } });
    if (!integracao) {
      return { configurado: false, status: 'NAO_CONFIGURADO', funcionariosSincronizados: comIdPonto, biometriaAtiva: comIdPonto > 0 };
    }
    // Healthcheck real: tenta login na API oficial do equipamento (somente leitura).
    let status = integracao.status;
    let detalhe: string | null = (integracao.erros as any)?.message ?? null;
    try {
      if (!integracao.senhaCriptografada) throw new Error('Credencial do equipamento não configurada.');
      const senha = decryptSecret(integracao.senhaCriptografada);
      const resp = await fetch(`${integracao.url}/login.fcgi`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: integracao.usuario, password: senha }), signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        status = 'CONECTADO'; detalhe = null;
        const b: any = await resp.json().catch(() => null);
        if (b?.session) await fetch(`${integracao.url}/logout.fcgi?session=${encodeURIComponent(b.session)}`, { method: 'POST' }).catch(() => undefined);
      } else { status = 'ERRO'; detalhe = `Equipamento respondeu HTTP ${resp.status}`; }
    } catch (e: any) { status = 'ERRO'; detalhe = e?.message || 'Equipamento inacessível'; }
    if (status !== integracao.status) await prisma.integracaoPonto.update({ where: { id: integracao.id }, data: { status } }).catch(() => undefined);
    return {
      configurado: true,
      id: integracao.id,
      nome: integracao.nome,
      status,
      detalhe,
      ultimaSincronizacao: integracao.ultimaSincronizacao,
      qtdRegistros: integracao.qtdRegistros,
      funcionariosSincronizados: comIdPonto,
      biometriaAtiva: comIdPonto > 0,
    };
  });

  /** Desempenho por funcionário: vendas reais do PDV (via usuarioId) + presença (Ponto). */
  app.get('/rh/desempenho', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const { mes } = req.query as any;
    const ref = /^\d{4}-\d{2}$/.test(String(mes ?? '')) ? new Date(`${mes}-01T00:00:00`) : new Date();
    const inicio = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const funcionarios = await prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId },
      select: { id: true, nome: true, idExternoPonto: true, usuarioId: true, status: true },
    });
    const usuarioIds = funcionarios.map((f) => f.usuarioId).filter(Boolean) as string[];
    const vendas = usuarioIds.length ? await prisma.venda.groupBy({
      by: ['funcionarioId'],
      where: { empresaId: req.user.empresaId, funcionarioId: { in: usuarioIds }, createdAt: { gte: inicio, lt: fim }, status: { not: 'CANCELADA' } },
      _count: { id: true },
      _sum: { total: true },
    }) : [];
    const vendasPorUsuario = new Map(vendas.map((v) => [v.funcionarioId, { qtd: v._count.id, total: Number(v._sum.total ?? 0) }]));
    let diasUteis = 0;
    for (const d = new Date(inicio); d.getTime() < Math.min(Date.now(), fim.getTime()); d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) diasUteis++;
    if (diasUteis === 0) diasUteis = 1;
    const pontos = await prisma.ponto.findMany({
      where: { empresaId: req.user.empresaId, data: { gte: inicio, lt: fim } },
      select: { funcionarioId: true, falta: true, atrasoMinutos: true, entrada: true, saida: true },
    });
    const presenca = new Map<string, { faltas: number; atrasos: number; batidasCompletas: number }>();
    for (const p of pontos) {
      const e = presenca.get(p.funcionarioId) ?? { faltas: 0, atrasos: 0, batidasCompletas: 0 };
      if (p.falta) e.faltas++;
      if (p.atrasoMinutos > 0) e.atrasos++;
      // Só conta como batida válida quem TEM entrada E saída. Sem a saída a
      // jornada está incompleta e não pode virar "presença" — antes, um
      // registro com entrada e `saida: null` contava como dia presente.
      if (!p.falta && p.entrada && p.saida) e.batidasCompletas++;
      presenca.set(p.funcionarioId, e);
    }
    // Meta REAL, da tabela `Meta` (tipo VENDAS, mesmo mês, escopo FUNCIONARIO).
    // Antes usava a constante `META_MENSAL = 20000` escrita no código: um número
    // que não veio de lugar nenhum, e que o "% de meta" da tela media sem que
    // ninguém tivesse cadastrado meta nenhuma.
    const periodoMeta = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`;
    const metas = await prisma.meta.findMany({
      where: {
        empresaId: req.user.empresaId,
        tipo: 'VENDAS',
        periodo: periodoMeta,
        OR: [{ funcionarioId: { in: funcionarios.map((f) => f.id) } }, { funcionarioId: null }],
      },
      select: { funcionarioId: true, metaValor: true },
    });
    const metaPorFuncionario = new Map<string, number>();
    let metaGeral: number | null = null;
    for (const m of metas) {
      const valor = Number(m.metaValor);
      if (m.funcionarioId) metaPorFuncionario.set(m.funcionarioId, valor);
      else if (metaGeral === null) metaGeral = valor;
    }
    const linhas = funcionarios.map((f) => {
      const v = f.usuarioId ? vendasPorUsuario.get(f.usuarioId) : undefined;
      const pres = presenca.get(f.id) ?? { faltas: 0, atrasos: 0, batidasCompletas: 0 };
      // `metaPct` é nulo quando não há meta cadastrada: a tela mostra "—" em
      // vez de um percentual inventado a partir de uma meta que não existe.
      const meta = metaPorFuncionario.get(f.id) ?? metaGeral;
      return {
        funcionarioId: f.id,
        nome: f.nome,
        idPonto: f.idExternoPonto,
        vendasQtd: v?.qtd ?? 0,
        vendasTotal: v?.total ?? 0,
        metaValor: meta ?? null,
        metaPct: meta && meta > 0 && v ? Math.round((v.total / meta) * 100) : null,
        // Presença = batidas COMPLETAS sobre dias úteis. Uma entrada sem saída
        // não é presença: o jornada não se fechou.
        presencaPct: Math.max(0, Math.round((pres.batidasCompletas / diasUteis) * 100)),
        batidasCompletas: pres.batidasCompletas,
        diasUteis,
        atrasos: pres.atrasos,
        faltas: pres.faltas,
      };
    });
    const ativos = funcionarios.filter((f) => f.status === 'ATIVO').length;
    const comMeta = linhas.filter((l) => l.metaPct !== null);
    return {
      periodo: { inicio, fim, periodoMeta },
      // Quando ninguém cadastrou meta, `mediaMeta` é null (não 0): zero é um
      // número real de meta, null é "não existe meta". A tela decide o que exibir.
      semMetaCadastrada: comMeta.length === 0,
      resumo: {
        totalVendas: linhas.reduce((s, l) => s + l.vendasTotal, 0),
        mediaMeta: comMeta.length ? Math.round(comMeta.reduce((s, l) => s + (l.metaPct as number), 0) / comMeta.length) : null,
        mediaPresenca: linhas.length ? Math.round(linhas.reduce((s, l) => s + l.presencaPct, 0) / linhas.length) : 0,
        ativos,
        diasUteis,
      },
      linhas,
    };
  });

  /**
   * Documentos de RH — advertência, suspensão e desligamento.
   *
   * O QUE MUDOU
   * -----------
   * Antes estas três rotas só gravavam o NOME do arquivo no banco e devolviam
   * `{ documentoNome, documentoGeradoEm }`. Nenhum byte de PDF era gerado: não
   * havia biblioteca instalada, nenhuma linha montava o arquivo e não existia
   * rota de download. A tela exibia "📄 Termo-Advertencia-xxxx.pdf" e o botão
   * sumia — um documento que não existia, apresentado como gerado.
   *
   * AGORA cada rota monta o PDF de verdade (ver `gerarPdf` no topo do arquivo)
   * e responde com os bytes em `application/pdf` + `Content-Disposition`, de
   * modo que o navegador baixe o termo. O nome do arquivo inclui o nome do
   * funcionário, e não só o id: dois termos de pessoas diferentes não podem
   * colidir no mesmo nome.
   *
   * Os dados vêm do banco (empresa, funcionário, cargo, departamento e o
   * próprio ato disciplinar). Não há campo de exemplo: o que não existe no
   * cadastro sai em branco no documento.
   */

  /** Envia o PDF como anexo, com nome de arquivo legível. */
  const responderPdf = (reply: any, nomeArquivo: string, pdf: Buffer) => {
    // `filename*` (RFC 5987) é o que faz o navegador respeitar o nome
    // acentuado; o `filename` simples é o fallback para clientes antigos.
    const ascii = nomeArquivo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9.\-]/g, '-');
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nomeArquivo)}`)
      .header('Content-Length', String(pdf.length))
      .send(pdf);
  };

  /** Empresa da sessão — origem do cabeçalho dos documentos. */
  const empresaDoUsuario = async (empresaId: string) =>
    prisma.empresa.findFirst({ where: { id: empresaId }, select: { nome: true, cnpj: true } });

  app.post('/rh/advertencias/:id/documento', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any, reply:any) => {
    const a = await prisma.advertencia.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { funcionario: { include: { cargo: true, departamento: true } } },
    });
    if (!a) throw new ErroDeNegocio('Advertência não encontrada.', 404);
    const empresa = await empresaDoUsuario(req.user.empresaId);
    const func = a.funcionario;
    const rotuloTipo = a.tipo === 'ESCRITA' ? 'Advertência escrita' : a.tipo === 'SUSPENSAO' ? 'Advertência suspensiva' : 'Advertência verbal';

    const pdf = gerarPdf({
      titulo: 'TERMO DE ADVERTÊNCIA',
      subtitulo: empresa?.cnpj ? `CNPJ ${empresa.cnpj}` : undefined,
      rodape: `Documento gerado em ${dataBr(new Date())} por NEXUS OS.`,
      blocos: [
        { texto: `Funcionário: ${func?.nome ?? '—'}`, negrito: true, espacoAntes: 0 },
        { texto: `CPF: ${func?.cpf ?? '—'}`, espacoAntes: 6 },
        { texto: `Cargo: ${func?.cargo?.nome ?? '—'}    Departamento: ${func?.departamento?.nome ?? '—'}`, espacoAntes: 6 },
        { texto: `Admissão: ${dataBr(func?.dataAdmissao)}    Data da advertência: ${dataBr(a.data)}`, espacoAntes: 6 },
        { texto: `Tipo: ${rotuloTipo}`, espacoAntes: 6 },
        { texto: `Motivo: ${a.motivo}`, negrito: true, espacoAntes: 14 },
        ...(a.descricao ? [{ texto: a.descricao, espacoAntes: 8 }] : []),
        {
          texto:
            'Fica o empregado ciente de que a presente advertência foi lavrada em seu desfavor, ' +
            'ficando ciente de que a reincidência poderá ensejar a aplicação de penalidade mais grave, ' +
            'nos termos do artigo 482, incisos I a IX, da CLT.',
          espacoAntes: 18,
        },
        { texto: 'Declaro que recebi e tomei conhecimento deste termo na data de hoje.', espacoAntes: 20 },
        { texto: '_______________________________________     _______________________________________', espacoAntes: 44, tamanho: 10, semQuebra: true },
        { texto: `O empregado${' '.repeat(4)}Responsável pela aplicação`, espacoAntes: 6, tamanho: 9, semQuebra: true },
        ...(a.aplicadaPor ? [{ texto: `Aplicada por: ${a.aplicadaPor}`, espacoAntes: 16, tamanho: 10 }] : []),
      ],
    });

    const nome = `Termo-Advertencia-${(func?.nome ?? a.funcionarioId).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}-${a.id.slice(-6)}.pdf`;
    await prisma.advertencia.update({ where: { id: a.id }, data: { documentoNome: nome, documentoGeradoEm: new Date() } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'Advertencia', entidadeId: a.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Termo de advertência gerado em PDF (${nome}).`,
    });
    return responderPdf(reply, nome, pdf);
  });


  app.post('/rh/suspensoes/:id/documento', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any, reply:any) => {
    const s = await prisma.suspensao.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { funcionario: { include: { cargo: true, departamento: true } } },
    });
    if (!s) throw new ErroDeNegocio('Suspensão não encontrada.', 404);
    const empresa = await empresaDoUsuario(req.user.empresaId);
    const func = s.funcionario;

    const pdf = gerarPdf({
      titulo: 'NOTIFICAÇÃO DE SUSPENSÃO',
      subtitulo: empresa?.cnpj ? `CNPJ ${empresa.cnpj}` : undefined,
      rodape: `Documento gerado em ${dataBr(new Date())} por NEXUS OS.`,
      blocos: [
        { texto: `Funcionário: ${func?.nome ?? '—'}`, negrito: true, espacoAntes: 0 },
        { texto: `CPF: ${func?.cpf ?? '—'}`, espacoAntes: 6 },
        { texto: `Cargo: ${func?.cargo?.nome ?? '—'}    Departamento: ${func?.departamento?.nome ?? '—'}`, espacoAntes: 6 },
        { texto: `Período: ${dataBr(s.inicio)} a ${dataBr(s.fim)} — ${s.dias} dia${s.dias === 1 ? '' : 's'}`, negrito: true, espacoAntes: 10 },
        { texto: `Motivo: ${s.motivo}`, negrito: true, espacoAntes: 14 },
        {
          texto:
            'Comunicamos a aplicação de suspensão disciplinar pelo prazo acima informado, ' +
            'nos termos do artigo 474 da Consolidação das Leis do Trabalho, que limita a suspensão ' +
            'a 30 dias. Durante o período não serão prestados serviços nem devida remuneração.',
          espacoAntes: 18,
        },
        { texto: 'Declaro que recebi e tomei conhecimento desta notificação na data de hoje.', espacoAntes: 20 },
        { texto: '_______________________________________     _______________________________________', espacoAntes: 44, tamanho: 10, semQuebra: true },
        { texto: `O empregado${' '.repeat(4)}Responsável pela aplicação`, espacoAntes: 6, tamanho: 9, semQuebra: true },
        ...(s.aplicadaPor ? [{ texto: `Aplicada por: ${s.aplicadaPor}`, espacoAntes: 16, tamanho: 10 }] : []),
      ],
    });

    const nome = `Notificacao-Suspensao-${(func?.nome ?? s.funcionarioId).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}-${s.id.slice(-6)}.pdf`;
    await prisma.suspensao.update({ where: { id: s.id }, data: { documentoNome: nome, documentoGeradoEm: new Date() } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'Suspensao', entidadeId: s.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Notificação de suspensão gerada em PDF (${nome}).`,
    });
    return responderPdf(reply, nome, pdf);
  });

  // ==========================================================================
  //  Documentos (bucket S3 / Supabase) — ver seção acima
  // ==========================================================================

  /**
  // ==========================================================================
  //  Documentos em bucket (S3 / Supabase Storage)
  //
  //  Antes as colunas `documentos` de Advertência/Suspensão/Desligamento eram
  //  `String[]` guardando SÓ o nome do arquivo: o nome aparecia na tela e no
  //  dossie, mas o binário não existia em lugar nenhum — metadado de arquivo
  //  inexistente. Estas rotas guardam o arquivo de verdade e registram a chave
  //  real no bucket.
  //
  //  TRANSPORTE
  //  -----------
  //  O binário chega em base64 dentro do JSON, e não em multipart/form-data: o
  //  servidor não registra parser multipart, e o limite padrão do Fastify
  //  derrubaria a requisição antes de qualquer validação nossa. Base64 custa
  //  ~33% de overhead — o preço de não adicionar dependência.
  // ==========================================================================

  /** Entidades que podem receber anexo, e como validar a posse do registro. */
  const ENTIDADES_ANEXO: Record<string, (empresaId: string, id: string) => Promise<boolean>> = {
    Funcionario: (empresaId, id) =>
      prisma.funcionario.findFirst({ where: { id, empresaId }, select: { id: true } }).then((r) => !!r),
    Advertencia: (empresaId, id) =>
      prisma.advertencia.findFirst({ where: { id, empresaId }, select: { id: true } }).then((r) => !!r),
    Suspensao: (empresaId, id) =>
      prisma.suspensao.findFirst({ where: { id, empresaId }, select: { id: true } }).then((r) => !!r),
    Desligamento: (empresaId, id) =>
      prisma.desligamento.findFirst({ where: { id, empresaId }, select: { id: true } }).then((r) => !!r),
  };

  /** Descobre o funcionário dono de um registro, para o atalho do dossê. */
  async function funcionarioDoRegistro(entidadeTipo: string, entidadeId: string): Promise<string | null> {
    if (entidadeTipo === 'Funcionario') return entidadeId;
    const mapa: Record<string, { funcionarioId: string } | null> = {
      Advertencia: await prisma.advertencia.findUnique({ where: { id: entidadeId }, select: { funcionarioId: true } }),
      Suspensao: await prisma.suspensao.findUnique({ where: { id: entidadeId }, select: { funcionarioId: true } }),
      Desligamento: await prisma.desligamento.findUnique({ where: { id: entidadeId }, select: { funcionarioId: true } }),
    };
    return mapa[entidadeTipo]?.funcionarioId ?? null;
  }

  /**
   * Status do storage para a interface.
   *
   * A tela usa isto para desabilitar o botão de upload com mensagem clara
   * quando o bucket não está configurado, em vez de deixar o usuário descobrir
   * o erro só depois de escolher o arquivo.
   */
  app.get('/rh/documentos/storage', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async () => {
    if (!storageConfigurado()) {
      return {
        configurado: false,
        mensagem: 'Armazenamento não configurado. Defina STORAGE_PROVIDER e STORAGE_BUCKET no .env do backend.',
      };
    }
    const cfg = configStorage();
    return { configurado: true, provedor: cfg.provedor, bucket: cfg.bucket, tamanhoMaximo: TAMANHO_MAXIMO_BYTES };
  });

  /**
   * Anexa um documento.
   *
   * A chave é montada no servidor e nunca aceita do cliente (ver `montaChave`):
   * não há como escrever fora do prefixo da empresa nem colidir com o objeto de
   * outro tenant.
   */
  app.post('/rh/documentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const dados = z.object({
      entidadeTipo: z.enum(['Funcionario', 'Advertencia', 'Suspensao', 'Desligamento']),
      entidadeId: z.string().min(1),
      nomeArquivo: z.string().min(1).max(180),
      conteudoBase64: z.string().min(1),
      descricao: z.string().max(300).optional(),
    }).parse(req.body ?? {});

    const empresaId = req.user.empresaId;
    const valida = ENTIDADES_ANEXO[dados.entidadeTipo];
    // 404 e não 403: o registro de outra empresa não deve nem ser confirmado
    // como existente.
    if (!(await valida(empresaId, dados.entidadeId))) {
      throw new ErroDeNegocio('Registro não encontrado nesta empresa.', 404);
    }

    // Valida extensão e tipo ANTES de decodificar: um base64 enorme de um .exe
    // é recusado sem nunca virar buffer.
    const extensao = extensaoDe(dados.nomeArquivo);
    const contentType = contentTypeDe(dados.nomeArquivo);
    const bruto = Buffer.from(dados.conteudoBase64, 'base64');
    validaTamanho(bruto.length);

    const cfg = configStorage();
    const chave = montaChave(empresaId, dados.entidadeTipo, extensao);

    try {
      await enviarObjeto(chave, bruto, contentType);
    } catch (err: any) {
      // Falha de bucket NÃO é 500 genérico: o operador precisa saber que foi o
      // storage, e o registro não pode ser criado apontando para um objeto que
      // não subiu.
      throw new ErroDeNegocio(`Não foi possível gravar o arquivo no bucket: ${err?.message ?? 'erro desconhecido'}`, 502);
    }

    const documento = await prisma.documento.create({
      data: {
        empresaId,
        entidadeTipo: dados.entidadeTipo,
        entidadeId: dados.entidadeId,
        funcionarioId: await funcionarioDoRegistro(dados.entidadeTipo, dados.entidadeId),
        nomeOriginal: dados.nomeArquivo,
        chave,
        bucket: cfg.bucket,
        provedor: cfg.provedor,
        contentType,
        tamanho: bruto.length,
        descricao: dados.descricao || null,
        enviadoPorId: req.user.id,
      },
    });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId,
      acao: 'CRIAR',
      entidade: 'Documento',
      entidadeId: documento.id,
      valorNovo: { nome: dados.nomeArquivo, tamanho: bruto.length, entidade: `${dados.entidadeTipo}:${dados.entidadeId}` },
      origem: 'MANUAL',
      ip: req.ip,
      contexto: `Documento "${dados.nomeArquivo}" anexado a ${dados.entidadeTipo} ${dados.entidadeId}.`,
    });

    return documento;
  });

  /**
   * Lista os documentos de uma entidade (ou de um funcionário inteiro).
   *
   * Sempre filtrado por `empresaId`: é aqui que o isolamento por tenant é
   * aplicado na leitura, antes mesmo de o bucket ser consultado.
   */
  app.get('/rh/documentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    const q = z.object({
      entidadeTipo: z.enum(['Funcionario', 'Advertencia', 'Suspensao', 'Desligamento']).optional(),
      entidadeId: z.string().optional(),
      funcionarioId: z.string().optional(),
    }).parse(req.query ?? {});
    return prisma.documento.findMany({
      where: {
        empresaId: req.user.empresaId,
        ...(q.entidadeTipo ? { entidadeTipo: q.entidadeTipo } : {}),
        ...(q.entidadeId ? { entidadeId: q.entidadeId } : {}),
        ...(q.funcionarioId ? { funcionarioId: q.funcionarioId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  /**
   * Baixa o binario do bucket.
   *
   * O bucket e privado: o arquivo NUNCA vira URL publica. A rota busca o
   * registro filtrando por `empresaId`, so entao le o objeto — e devolve o
   * `Content-Type` gravado no upload, para o navegador abrir o arquivo certo.
   */
  app.get('/rh/documentos/:id/download', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any, reply:any) => {
    const documento = await prisma.documento.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!documento) throw new ErroDeNegocio('Documento não encontrado nesta empresa.', 404);

    const { corpo, contentType } = await baixarObjeto(documento.chave);
    // `Content-Disposition: attachment` impede que HTML anexado seja executado
    // no dominio do app: o navegador baixa em vez de abrir.
    return reply
      .header('Content-Type', documento.contentType || contentType)
      .header('Content-Length', String(corpo.length))
      .header('Content-Disposition', `attachment; filename="${documento.nomeOriginal.replace(/"/g, '')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(corpo);
  });

  /**
   * Remove o documento: apaga o objeto do bucket E o registro.
   *
   * Arquivamento (janela de 30 dias) NAO passa por aqui — ele apenas muda
   * `situacao`. Esta rota e a unica que apaga de fato, e por isso exige
   * permissao de exclusao.
   */
  app.delete('/rh/documentos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const documento = await prisma.documento.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
    });
    if (!documento) throw new ErroDeNegocio('Documento não encontrado nesta empresa.', 404);

    await removerObjeto(documento.chave);
    await prisma.documento.delete({ where: { id: documento.id } });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'EXCLUIR',
      entidade: 'Documento',
      entidadeId: documento.id,
      valorAnterior: { nome: documento.nomeOriginal, chave: documento.chave },
      origem: 'MANUAL',
      ip: req.ip,
      contexto: `Documento "${documento.nomeOriginal}" removido do bucket e do registro.`,
    });

    return { ok: true };
  });

  const desligamentoSchema = z.object({
    funcionarioId: z.string().min(1),
    data: z.string().min(8),
    tipo: z.enum(['sem-justa-causa', 'justa-causa', 'pedido', 'acordo']),
    motivo: z.string().min(3),
    // "trabalhado" entrou no schema: a tela já oferecia a opção, mas o backend
    // a rejeitava com 400. Aviso trabalhado não gera valor a pagar — o
    // `montarVerbas` trata isso — mas é uma escolha legítima do empregador.
    aviso: z.enum(['trabalhado', 'indenizado', 'dispensado']).default('indenizado'),
    saldoDias: z.number().int().min(0).max(365).default(0),
    alineas: z.array(z.string()).default([]),
    observacoes: z.string().optional(),
    documentos: z.array(z.string()).default([]),
  });

  /**
   *
   * O servidor é o único que calcula. O preview da tela, o valor gravado e o
   * PDF do termo saem todos daqui, então não há como os três divergirem.
   * (Antes o cliente tinha uma fórmula paralela: para salário R$ 3.000 com 10
   * dias de saldo a tela mostrava R$ 10.340 e o banco gravava R$ 5.296.)
   */
  async function apurarVerbas(req: any, entrada: {
    funcionarioId: string; data: string; tipo: string; aviso: TipoAviso; saldoDias: number;
  }) {
    const funcionario = await prisma.funcionario.findFirst({
      where: { id: entrada.funcionarioId, empresaId: req.user.empresaId },
      select: { id: true, nome: true, salario: true, dataAdmissao: true, dataDesligamento: true },
    });
    if (!funcionario) throw new ErroDeNegocio('Funcionário não encontrado nesta empresa.', 404);
    if (funcionario.dataDesligamento) throw new ErroDeNegocio('Este funcionário já possui desligamento registrado.', 409);

    // Meio-dia evita que o fuso do servidor empurre a data para o dia anterior
    // (mesma razão do `T12:00:00` usado nos outros pontos do RH).
    const dataDesligamento = new Date(`${entrada.data}T12:00:00`);
    if (Number.isNaN(dataDesligamento.getTime())) throw new ErroDeNegocio('Data de desligamento inválida.');
    if (funcionario.dataAdmissao && dataDesligamento < funcionario.dataAdmissao) {
      throw new ErroDeNegocio('A data de desligamento não pode ser anterior à data de admissão.', 422);
    }

    const verbas = montarVerbas({
      salario: Number(funcionario.salario ?? 0),
      dataAdmissao: funcionario.dataAdmissao,
      dataDesligamento,
      tipo: entrada.tipo,
      aviso: entrada.aviso,
      saldoDias: entrada.saldoDias,
    });
    return { funcionario, dataDesligamento, verbas };
  }

  /** Lista os desligamentos da empresa, com o funcionário embutido. */
  app.get('/rh/desligamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.desligamento.findMany({
      where: { empresaId: req.user.empresaId },
      include: {
        funcionario: {
          select: { id: true, nome: true, matricula: true, cpf: true, salario: true, cargo: { select: { nome: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  /**
   * Preview das verbas — o mesmo cálculo do POST, sem gravar nada.
   *
   * É esta rota que alimenta o formulário: enquanto o RH digita a data e o
   * aviso, a tela pede o valor ao servidor. Não existe fórmula no cliente, então
   * o que aparece no preview é exatamente o que será gravado e impresso.
   */
  app.post('/rh/desligamentos/preview', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    // O preview nao grava nada, entao nao exige `motivo` (que so e obrigatorio
    // na criacao real do registro).
    const d = desligamentoSchema.partial({ tipo: true, motivo: true }).parse(req.body ?? {});
    if (!d.funcionarioId || !d.data || !d.tipo) {
      throw new ErroDeNegocio('Informe funcionário, data e tipo para apurar as verbas.');
    }
    const { funcionario, dataDesligamento, verbas } = await apurarVerbas(req, {
      funcionarioId: d.funcionarioId,
      data: d.data,
      tipo: d.tipo,
      aviso: d.aviso ?? 'indenizado',
      saldoDias: d.saldoDias ?? 0,
    });
    return {
      verbas,
      apuracao: {
        salario: Number(funcionario.salario ?? 0),
        dataAdmissao: funcionario.dataAdmissao,
        dataDesligamento,
        diasContrato: diasDeContrato(funcionario.dataAdmissao, dataDesligamento),
        multaFgtsDevida: devePagarMulta(d.tipo, funcionario.dataAdmissao, dataDesligamento),
      },
    };
  });

  /** Registra um desligamento. 409 se o funcionário já estiver desligado. */
  app.post('/rh/desligamentos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'criar')] }, async (req:any) => {
    const d = desligamentoSchema.parse(req.body);
    const { funcionario, dataDesligamento, verbas } = await apurarVerbas(req, d);

    // Rótulo e enquadramento legal saem do TIPO, não do cliente: antes a tela
    // mandava `tipoLabel`/`art` e o banco guardava o que o navegador enviou.
    const tipo = TIPOS_DESLIGAMENTO[d.tipo];

    const desligamento = await prisma.$transaction(async (tx) => {
      const criado = await tx.desligamento.create({
        data: {
          empresaId: req.user.empresaId,
          funcionarioId: d.funcionarioId,
          data: dataDesligamento,
          tipo: d.tipo,
          tipoLabel: tipo.label,
          art: tipo.art,
          motivo: d.motivo,
          aviso: d.aviso,
          saldoDias: d.saldoDias,
          // Snapshot completo: o termo impresso precisa continuar fiel ao que
          // foi apurado, mesmo que salário e cadastro mudem depois.
          verbas13: verbas.decimoTerceiro,
          verbasFerias: verbas.feriasVencidas + verbas.feriasProporcionais,
          verbasAviso: verbas.avisoPrevio,
          verbasTerco: verbas.tercoConstitucional,
          verbasSaldo: verbas.saldoSalario,
          verbasFeriasProporc: verbas.feriasProporcionais,
          meses13: verbas.meses13,
          anosCompletos: verbas.anosCompletos,
          diasAviso: verbas.diasAviso,
          verbasTotal: verbas.total,
          // FGTS e multa: nulos de propósito (ver `montarVerbas`).
          saldoFgts: verbas.saldoFgts,
          multaFgts: verbas.multaFgts,
          fgtsApurado: verbas.fgtsApurado,
          alineas: d.alineas,
          observacoes: d.observacoes || null,
          documentos: d.documentos,
        },
      });
      // O funcionário passa a DESLIGADO e ganha a data — é o que o resto do
      // sistema lê para não gerar ponto ou venda para quem já saiu.
      await tx.funcionario.update({
        where: { id: d.funcionarioId },
        data: { dataDesligamento: dataDesligamento, status: 'DESLIGADO' },
      });
      return criado;
    });

    await registrarAuditoria({
      usuarioId: req.user.id,
      empresaId: req.user.empresaId,
      acao: 'CRIAR',
      entidade: 'Desligamento',
      entidadeId: desligamento.id,
      valorNovo: {
        funcionario: funcionario.nome,
        tipo: d.tipo,
        data: d.data,
        aviso: d.aviso,
        saldoDias: d.saldoDias,
        total: String(verbas.total),
      },
      origem: 'MANUAL',
      ip: req.ip,
      contexto: `Desligamento ${desligamento.id} registrado para ${funcionario.nome}. Verbas apuradas no servidor.`,
    });

    return desligamento;
  });

  /**
   * Atualiza status, observações, documentos e alíneas de um desligamento.
   *
   * O status é controlado e auditado; `CANCELADO` não é permitido por aqui (tem rota
   * própria, que também reativa o funcionário). As VERBAS não são editáveis: foram
   * apuradas no ato e são o snapshot do termo já impresso. Alterá-las exigiria
   * recalcular — e nesse caso o certo é cancelar e lançar de novo.
   */
  app.put('/rh/desligamentos/:id', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any) => {
    const { id } = req.params as { id: string };
    const d = z.object({
      status: z.enum(['PENDENTE', 'ASSINADO', 'HOMOLOGADO']).optional(),
      observacoes: z.string().nullable().optional(),
      documentos: z.array(z.string()).optional(),
      alineas: z.array(z.string()).optional(),
    }).parse(req.body ?? {});

    const anterior = await prisma.desligamento.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!anterior) throw new ErroDeNegocio('Desligamento não encontrado nesta empresa.', 404);
    if (anterior.status === 'CANCELADO') {
      throw new ErroDeNegocio('Desligamento cancelado não pode ser alterado. Registre um novo desligamento se necessário.', 409);
    }

    const atualizado = await prisma.desligamento.update({
      where: { id },
      data: {
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.observacoes !== undefined ? { observacoes: d.observacoes } : {}),
        ...(d.documentos !== undefined ? { documentos: d.documentos } : {}),
        ...(d.alineas !== undefined ? { alineas: d.alineas } : {}),
      },
    });

    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'Desligamento', entidadeId: id,
      valorAnterior: { status: anterior.status, observacoes: anterior.observacoes, documentos: anterior.documentos },
      valorNovo: { status: atualizado.status, observacoes: atualizado.observacoes, documentos: atualizado.documentos },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Desligamento ${id} atualizado.`,
    });

    return atualizado;
  });

  /**
   * Cancela um desligamento (art. 5 CLT) e reativa o funcionário.
   *
   * O registro NÃO é apagado: entra em `CANCELADO` com autor, data e motivo. Um
   * desligamento que chegou a ser assinado pela empresa tem valor de documento —
   * excluí-lo fisicamente destruiria o histórico. O que se desfaz é o EFEITO: o
   * funcionário volta a ATIVO e a data de desligamento é limpa.
   */
  app.post('/rh/desligamentos/:id/cancelar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const { id } = req.params as { id: string };
    const { motivo } = z.object({ motivo: z.string().min(5, 'Informe o motivo do cancelamento (mínimo 5 caracteres).') }).parse(req.body ?? {});

    const alvo = await prisma.desligamento.findFirst({ where: { id, empresaId: req.user.empresaId } });
    if (!alvo) throw new ErroDeNegocio('Desligamento não encontrado nesta empresa.', 404);
    if (alvo.status === 'CANCELADO') throw new ErroDeNegocio('Este desligamento já está cancelado.', 409);
    if (alvo.status === 'HOMOLOGADO') {
      throw new ErroDeNegocio('Desligamento homologado não pode ser cancelado por aqui: a rescisão já foi quitada.', 409);
    }

    const [cancelado] = await prisma.$transaction([
      prisma.desligamento.update({
        where: { id },
        data: { status: 'CANCELADO', canceladoEm: new Date(), canceladoPorId: req.user.id, motivoCancelamento: motivo },
      }),
      prisma.funcionario.update({
        where: { id: alvo.funcionarioId },
        data: { status: 'ATIVO', dataDesligamento: null },
      }),
    ]);

    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EXCLUIR',
      entidade: 'Desligamento', entidadeId: id,
      valorAnterior: { status: alvo.status, dataDesligamento: alvo.data },
      valorNovo: { status: 'CANCELADO', motivo },
      origem: 'MANUAL', ip: req.ip,
      contexto: `Desligamento ${id} cancelado por ${req.user.id}. Funcionário reativado como ATIVO. Motivo: ${motivo}`,
    });

    return cancelado;
  });

  // ==========================================================================
  //  Arquivamento e dossiê
  //
  //  Após 30 dias do desligamento o funcionário sai da operação (da lista de
  //  ativos) e passa a ARQUIVADO — mas cadastro, advertências, suspensões e
  //  documentos continuam preservados e consultáveis. Nada é apagado:
  //  arquivar é o oposto de excluir.
  // ==========================================================================

  /** Janela, em dias, em que o desligado continua com documentos disponíveis. */
  const JANELA_DOCUMENTOS_DIAS = 30;
  const msPorDia = 86400000;

  /** Instante em que o dossiê deixa de estar disponível para impressão. */
  const fimDeJanela = (dataDesligamento: Date) => new Date(dataDesligamento.getTime() + JANELA_DOCUMENTOS_DIAS * msPorDia);

  /**
   * Dossiê completo do funcionário em PDF: cadastro, advertências,
   * suspensões, desligamento e documentos.
   *
   * Só funciona dentro da janela de 30 dias. Após isso o registro vai para
   * ARQUIVADO e a rota recusa com 409 — o histórico continua no banco, mas sai
   * do acesso operacional diário de documentos, que é o que o prazo de
   * retenção do dossiê define.
   */
  app.post('/rh/funcionarios/:id/dossie', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any, reply:any) => {
    const func = await prisma.funcionario.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { cargo: true, departamento: true },
    });
    if (!func) throw new ErroDeNegocio('Funcionário não encontrado nesta empresa.', 404);

    const desligamento = await prisma.desligamento.findFirst({
      where: { funcionarioId: func.id, empresaId: req.user.empresaId, status: { not: 'CANCELADO' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!desligamento) throw new ErroDeNegocio('Este funcionário não possui desligamento registrado.', 409);

    if (desligamento.arquivadoEm) {
      throw new ErroDeNegocio(
        `Dossiê arquivado em ${dataBr(desligamento.arquivadoEm)}: a janela de ${JANELA_DOCUMENTOS_DIAS} dias para impressão de documentos encerrou. O histórico permanece no arquivo do RH.`,
        409,
      );
    }
    if (new Date() > fimDeJanela(desligamento.data)) {
      throw new ErroDeNegocio(
        `A janela de ${JANELA_DOCUMENTOS_DIAS} dias para impressão do dossiê encerrou. Execute o arquivamento do funcionário.`,
        409,
      );
    }

    const [empresa, advertencias, suspensoes, ponto] = await Promise.all([
      empresaDoUsuario(req.user.empresaId),
      prisma.advertencia.findMany({ where: { funcionarioId: func.id, empresaId: req.user.empresaId }, orderBy: { data: 'desc' } }),
      prisma.suspensao.findMany({ where: { funcionarioId: func.id, empresaId: req.user.empresaId }, orderBy: { inicio: 'desc' } }),
      prisma.ponto.count({ where: { funcionarioId: func.id, empresaId: req.user.empresaId } }),
    ]);

    const blocos: Bloco[] = [
      { texto: '1. CADASTRO', negrito: true, espacoAntes: 0 },
      { texto: `Nome: ${func.nome}`, espacoAntes: 6 },
      { texto: `CPF: ${func.cpf ?? '—'}`, espacoAntes: 4 },
      { texto: `Matrícula: ${func.matricula ?? '—'}`, espacoAntes: 4 },
      { texto: `Cargo: ${func.cargo?.nome ?? '—'}`, espacoAntes: 4 },
      { texto: `Departamento: ${func.departamento?.nome ?? '—'}`, espacoAntes: 4 },
      { texto: `Admissão: ${dataBr(func.dataAdmissao)}`, espacoAntes: 4 },
      { texto: `Situação: ${func.status}${func.dataDesligamento ? ` — desligado em ${dataBr(func.dataDesligamento)}` : ''}`, espacoAntes: 4 },

      { texto: `2. DESLIGAMENTO`, negrito: true, espacoAntes: 16 },
      { texto: `Tipo: ${desligamento.tipoLabel} (${desligamento.art})`, espacoAntes: 6 },
      { texto: `Data: ${dataBr(desligamento.data)}`, espacoAntes: 4 },
      { texto: `Status: ${desligamento.status}`, espacoAntes: 4 },
      { texto: `Documento gerado: ${desligamento.documentoNome ?? 'não gerado'}`, espacoAntes: 4 },
      { texto: `Total apurado: ${valorBr(desligamento.verbasTotal)}`, espacoAntes: 4 },

      { texto: `3. ADVERTÊNCIAS (${advertencias.length})`, negrito: true, espacoAntes: 16 },
      ...(advertencias.length
        ? advertencias.map((a) => ({ texto: `${dataBr(a.data)} — ${a.tipo}: ${a.motivo}`, espacoAntes: 5 }))
        : [{ texto: 'Nenhuma advertência registrada.', espacoAntes: 5 }]),

      { texto: `4. SUSPENSÕES (${suspensoes.length})`, negrito: true, espacoAntes: 16 },
      ...(suspensoes.length
        ? suspensoes.map((s) => ({ texto: `${dataBr(s.inicio)} à ${dataBr(s.fim)} (${s.dias} dia(s)) — ${s.motivo}`, espacoAntes: 5 }))
        : [{ texto: 'Nenhuma suspensão registrada.', espacoAntes: 5 }]),

      { texto: '5. PONTUAÇÃO', negrito: true, espacoAntes: 16 },
      { texto: `${ponto} registro(s) de ponto no período.`, espacoAntes: 5 },
    ];


    const pdf = gerarPdf({
      titulo: 'DOSSIÊ DE FUNCIONÁRIO',
      subtitulo: empresa?.cnpj ? `CNPJ ${empresa.cnpj}` : undefined,
      rodape: `Dossiê gerado em ${dataBr(new Date())}. Verbas de rescisão e documentos permanecem no arquivo do RH.`,
      blocos,
    });

    const nome = `Dossie-${func.nome.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}-${dataBr(desligamento.data).replace(/\//g, '-')}.pdf`;
    await prisma.desligamento.update({ where: { id: desligamento.id }, data: { dossieGeradoEm: new Date() } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'CRIAR',
      entidade: 'Desligamento', entidadeId: desligamento.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Dossiê completo gerado em PDF para ${func.nome} (${nome}).`,
    });
    return responderPdf(reply, nome, pdf);
  });
  /**
   * Arquiva um funcionário após a janela de 30 dias.
   *
   * Arquivar marca o desligamento e muda o funcionário para ARQUIVADO: ele sai da
   * lista de ativos e da operação diária, mas continua no banco, com
   * advertências, suspensões, documentos e termo. NADA é apagado.
   *
   * Recusa antes do prazo (409): arquivar cedo demais tiraria o funcionário da
   * operação enquanto o RH ainda precisa imprimir o dossiê.
   */
  app.post('/rh/desligamentos/:id/arquivar', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const { id } = req.params as { id: string };
    const alvo = await prisma.desligamento.findFirst({
      where: { id, empresaId: req.user.empresaId },
      include: { funcionario: { select: { id: true, nome: true } } },
    });
    if (!alvo) throw new ErroDeNegocio('Desligamento não encontrado nesta empresa.', 404);
    if (alvo.status === 'CANCELADO') throw new ErroDeNegocio('Desligamento cancelado não se arquiva.', 409);
    if (alvo.arquivadoEm) throw new ErroDeNegocio('Este funcionário já está arquivado.', 409);

    const fim = fimDeJanela(alvo.data);
    if (new Date() < fim) {
      throw new ErroDeNegocio(
        'A janela de ' + JANELA_DOCUMENTOS_DIAS + ' dias ainda não terminou: o dossiê de ' +
        alvo.funcionario.nome + ' pode ser impresso até ' + dataBr(fim) + '.',
        409,
      );
    }

    const [arquivado] = await prisma.$transaction([
      prisma.desligamento.update({ where: { id }, data: { arquivadoEm: new Date() } }),
      prisma.funcionario.update({ where: { id: alvo.funcionarioId }, data: { status: 'ARQUIVADO' } }),
    ]);

    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG',
      entidade: 'Desligamento', entidadeId: id, origem: 'MANUAL', ip: req.ip,
      contexto: 'Funcionário ' + alvo.funcionario.nome + ' arquivado após ' + JANELA_DOCUMENTOS_DIAS + ' dias. Histórico preservado.',
    });
    return arquivado;
  });

  /**
   * Funcionários ARQUIVADOS — área própria de consulta.
   *
   * Separada de `GET /funcionarios` de propósito: o arquivado sai da lista de
   * ativos, mas continua preservado e consultável por quem tem permissão de RH.
   */
  app.get('/rh/funcionarios/arquivados', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'visualizar')] }, async (req:any) => {
    return prisma.funcionario.findMany({
      where: { empresaId: req.user.empresaId, status: 'ARQUIVADO' },
      include: { cargo: true, departamento: true },
      orderBy: { dataDesligamento: 'desc' },
    });
  });

  /**
   * Arquiva todos os desligamentos que venceram a janela e continuam abertos.
   *
   * É explícito: o arquivamento é uma decisão de retenção, não efeito colateral de
   * passar o tempo. Deixar vazar sozinho seria tirar do acesso operacional sem
   * ninguém ter decidido isso.
   */
  app.post('/rh/funcionarios/arquivar-vencidos', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'excluir')] }, async (req:any) => {
    const agora = new Date();
    const candidatos = await prisma.desligamento.findMany({
      where: {
        empresaId: req.user.empresaId,
        arquivadoEm: null,
        status: { not: 'CANCELADO' },
        data: { lte: new Date(agora.getTime() - JANELA_DOCUMENTOS_DIAS * msPorDia) },
      },
      include: { funcionario: { select: { id: true, nome: true } } },
    });

    for (const c of candidatos) {
      await prisma.$transaction([
        prisma.desligamento.update({ where: { id: c.id }, data: { arquivadoEm: agora } }),
        prisma.funcionario.update({ where: { id: c.funcionarioId }, data: { status: 'ARQUIVADO' } }),
      ]);
      await registrarAuditoria({
        usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'ALTERAR_CONFIG',
        entidade: 'Desligamento', entidadeId: c.id, origem: 'MANUAL', ip: req.ip,
        contexto: 'Arquivamento automático de ' + c.funcionario.nome + ' (janela de ' + JANELA_DOCUMENTOS_DIAS + ' dias encerrada).',
      });
    }
    return { arquivados: candidatos.length };
  });

  app.post('/rh/desligamentos/:id/documento', { preHandler: [(app as any).authenticate, await permissaoMiddleware('rh', 'editar')] }, async (req:any, reply:any) => {
    const d = await prisma.desligamento.findFirst({
      where: { id: req.params.id, empresaId: req.user.empresaId },
      include: { funcionario: { include: { cargo: true, departamento: true } } },
    });
    if (!d) throw new ErroDeNegocio('Desligamento não encontrado nesta empresa.', 404);
    const empresa = await empresaDoUsuario(req.user.empresaId);
    const func = d.funcionario;
    const rotuloAviso = d.aviso === 'trabalhado' ? 'Cumprido (aviso prévio trabalhado)' : d.aviso === 'dispensado' ? 'Dispensado' : 'Indenizado';

    const pdf = gerarPdf({
      titulo: 'TERMO DE RESCISÃO',
      subtitulo: empresa?.cnpj ? `CNPJ ${empresa.cnpj}` : undefined,
      rodape: `Documento gerado em ${dataBr(new Date())} por NEXUS OS.`,
      blocos: [
        { texto: `Funcionário: ${func?.nome ?? '—'}`, negrito: true, espacoAntes: 0 },
        { texto: `CPF: ${func?.cpf ?? '—'}`, espacoAntes: 6 },
        { texto: `Cargo: ${func?.cargo?.nome ?? '—'}    Departamento: ${func?.departamento?.nome ?? '—'}`, espacoAntes: 6 },
        { texto: `Admissão: ${dataBr(func?.dataAdmissao)}    Data do desligamento: ${dataBr(d.data)}`, espacoAntes: 6 },
        { texto: `Motivo: ${d.tipoLabel} (${d.art})`, negrito: true, espacoAntes: 8 },
        { texto: `Aviso prévio: ${rotuloAviso}    Saldo de dias: ${d.saldoDias}`, espacoAntes: 6 },
        { texto: 'VERBAS RESCISÓRIAS (CLT art. 477)', negrito: true, espacoAntes: 16 },
        { texto: `13º salário proporcional (${d.meses13 ?? 0}/12): ${valorBr(d.verbas13)}`, espacoAntes: 6 },
        { texto: `Férias vencidas (${d.anosCompletos ?? 0} ano(s) completos): ${valorBr((Number(d.verbasFerias ?? 0) - Number(d.verbasFeriasProporc ?? 0)))}`, espacoAntes: 4 },
        { texto: `Férias proporcionais: ${valorBr(d.verbasFeriasProporc)}`, espacoAntes: 4 },
        { texto: `Adicional de 1/3 constitucional: ${valorBr(d.verbasTerco)}`, espacoAntes: 4 },
        { texto: `Saldo de salário (${d.saldoDias} dia(s)): ${valorBr(d.verbasSaldo)}`, espacoAntes: 4 },
        { texto: `Aviso prévio ${d.aviso === 'trabalhado' ? 'trabalhado' : d.aviso === 'dispensado' ? 'dispensado' : `indenizado (${d.diasAviso ?? 0} dias)`}: ${valorBr(d.verbasAviso)}`, espacoAntes: 4 },
        { texto: 'TOTAL DAS VERBAS APURADAS: ' + valorBr(d.verbasTotal), negrito: true, espacoAntes: 8 },
        // FGTS e multa dependem do saldo DEPOSITADO, que o NEXUS não tem.
        // Escrever 8% ou 40% aqui seria inventar número em documento legal.
        { texto: 'FGTS e multa rescisória: não apurados nesta etapa — dependem do saldo depositado do FGTS, que deve ser verificado no extrato da conta vinculada.', espacoAntes: 10, tamanho: 9 },
        ...(d.observacoes ? [{ texto: d.observacoes, espacoAntes: 14 }] : []),
        {
          texto:
            'Declaro ter recebido as verbas acima descritas e que a sua quitação é exclusiva ' +
            'quanto aos direitos decorrentes do contrato de trabalho ora rescindido, conforme o artigo ' +
            '477 da CLT, nada sendo a mais.',
          espacoAntes: 20,
        },
        { texto: '_______________________________________     _______________________________________', espacoAntes: 44, tamanho: 10, semQuebra: true },
        { texto: `O empregado${' '.repeat(4)}Responsável pelo RH`, espacoAntes: 6, tamanho: 9, semQuebra: true },
      ],
    });

    const nome = `Termo-Rescisao-${(func?.nome ?? d.funcionarioId).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}-${d.id.slice(-6)}.pdf`;
    await prisma.desligamento.update({ where: { id: d.id }, data: { documentoNome: nome, documentoGeradoEm: new Date() } });
    await registrarAuditoria({
      usuarioId: req.user.id, empresaId: req.user.empresaId, acao: 'EDITAR',
      entidade: 'Desligamento', entidadeId: d.id, origem: 'MANUAL', ip: req.ip,
      contexto: `Termo de rescisão gerado em PDF (${nome}).`,
    });
    return responderPdf(reply, nome, pdf);
  });

}
