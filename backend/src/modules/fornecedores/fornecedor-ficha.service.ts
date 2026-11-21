import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { Conflito, ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import { isValidCnpj, normalizeCnpj } from '../../domain/cnpj.js';
import { isValidCpf } from '../../domain/cpf.js';

/**
 * Cadastro completo de fornecedores (ficha por abas, 2026-11-21).
 *
 * - O escopo vem SEMPRE do JWT (empresaId); o RLS do banco isola as empresas também.
 * - As rotas antigas (/fornecedores usada por Compras e /api/v1/fornecedores da listagem) continuam
 *   valendo; a ficha valida o cadastro completo (campos obrigatórios, CNPJ/CPF, contato).
 * - Dados bancários só são lidos/alterados com fornecedores.administrar; sem ela vêm mascarados.
 * - Os campos de auditoria (criado/alterado por e quando) são preenchidos só aqui, nunca pelo corpo.
 */

type Tx = Prisma.TransactionClient;

export const STATUS_FICHA = ['Ativo', 'Inativo', 'Bloqueado', 'Crítico'] as const;
/** Status que podem receber pedido de compra. Bloqueado e Inativo não recebem. */
export const STATUS_QUE_RECEBEM_PEDIDO = ['Ativo', 'Crítico'];

export const CAMPOS_BANCARIOS = [
  'chavePix', 'tipoChavePix', 'banco', 'codigoBanco', 'agencia', 'conta', 'contaDigito', 'tipoConta', 'titular', 'titularDocumento',
] as const;

const texto = (max: number) => z.string().trim().max(max).nullable().optional();
const data = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional();
const uf = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras.').nullable().optional();
const cep = z.string().trim().transform((v) => v.replace(/\D/g, '')).refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos.').nullable().optional();
const emailOpc = z.union([z.literal(''), z.string().trim().email('E-mail inválido.')]).nullable().optional();
const endereco = z.object({
  cep: z.string().trim().max(9).optional(), logradouro: texto(160), numero: texto(20), complemento: texto(80),
  bairro: texto(80), cidade: texto(80), uf: z.string().trim().toUpperCase().max(2).optional(), codigoIbge: texto(10),
}).nullable().optional();

export const contatoSchema = z.object({
  nome: z.string().trim().min(2, 'Nome do contato é obrigatório.').max(120),
  cargo: texto(80), departamento: texto(80), telefone: texto(30), celular: texto(30), whatsapp: texto(30),
  email: emailOpc,
  principal: z.boolean().optional(),
});

/** Campos da ficha (todos opcionais aqui; os obrigatórios são conferidos no estado final). */
export const fichaSchema = z.object({
  // Cabeçalho
  filialId: z.string().min(1).nullable().optional(),
  status: z.enum(STATUS_FICHA).optional(),
  tipoPessoa: z.enum(['JURIDICA', 'FISICA']).optional(),
  documento: z.string().trim().max(20).optional(),
  nome: z.string().trim().min(2, 'Razão social / nome é obrigatório.').max(160).optional(),
  nomeFantasia: texto(160),
  // Dados cadastrais
  inscricaoEstadual: texto(30), ieIsento: z.boolean().optional(), inscricaoMunicipal: texto(30),
  cnae: z.string().trim().max(12).regex(/^[\d./-]*$/, 'CNAE inválido.').nullable().optional(),
  dataAbertura: data, regimeTributario: texto(40), categoria: z.string().trim().min(1).max(60).optional(), segmento: texto(80),
  // Endereço
  cep, logradouro: texto(160), numero: texto(20), complemento: texto(80), bairro: texto(80), cidade: texto(80), uf,
  pais: z.string().trim().max(60).optional(), codigoIbge: z.string().trim().regex(/^\d{0,7}$/, 'Código IBGE inválido.').nullable().optional(),
  enderecoCobranca: endereco, enderecoAlternativo: endereco,
  // Contatos complementares
  site: texto(160), emailPedidos: emailOpc, emailNfe: emailOpc,
  // Financeiro
  condicaoPagamento: texto(40), formaPagamento: z.enum(['BOLETO', 'PIX', 'TRANSFERENCIA', 'CARTAO']).nullable().optional(),
  chavePix: texto(140), tipoChavePix: z.enum(['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'ALEATORIA']).nullable().optional(),
  banco: texto(80), codigoBanco: z.string().trim().regex(/^\d{0,3}$/, 'Código do banco: até 3 dígitos.').nullable().optional(),
  agencia: z.string().trim().regex(/^[\dXx-]{0,10}$/, 'Agência inválida.').nullable().optional(),
  conta: z.string().trim().regex(/^[\d-]{0,20}$/, 'Conta inválida.').nullable().optional(),
  contaDigito: z.string().trim().regex(/^[\dXx]{0,2}$/, 'Dígito inválido.').nullable().optional(),
  tipoConta: z.enum(['CORRENTE', 'POUPANCA', 'PAGAMENTO']).nullable().optional(),
  titular: texto(160), titularDocumento: texto(20),
  limiteCredito: z.number().finite().min(0).max(1e12).nullable().optional(),
  naturezaFinanceira: texto(60), planoContas: texto(60), centroCusto: texto(60),
  // Fiscal
  contribuinteIcms: z.boolean().nullable().optional(), optanteSimples: z.boolean().nullable().optional(),
  retemIrrf: z.boolean().optional(), retemPis: z.boolean().optional(), retemCofins: z.boolean().optional(),
  retemCsll: z.boolean().optional(), retemIss: z.boolean().optional(), retemInss: z.boolean().optional(),
  cfopEntrada: z.string().trim().regex(/^(\d\.?\d{3})?$/, 'CFOP deve ter 4 dígitos.').nullable().optional(),
  observacoesFiscais: texto(1000),
  // Compras e logística
  prazoEntregaDias: z.number().int().min(0).max(3650).nullable().optional(),
  pedidoMinimo: z.number().finite().min(0).max(1e12).nullable().optional(),
  modalidadeFrete: z.enum(['CIF', 'FOB']).nullable().optional(),
  transportadora: texto(120), compradorId: z.string().min(1).nullable().optional(),
  condicoesComerciais: texto(1000), observacoesLogisticas: texto(1000),
  // Qualidade
  homologado: z.boolean().optional(), dataHomologacao: data, homologadoPor: texto(120),
  validadeCndFederal: data, validadeFgts: data, validadeCndt: data,
  // Observações internas
  observacoes: texto(4000), infoComerciais: texto(4000), restricoesAtendimento: texto(4000), orientacoesCompradores: texto(4000),
});
export type DadosFicha = z.infer<typeof fichaSchema>;

const CAMPOS_DATA = ['dataAbertura', 'dataHomologacao', 'validadeCndFederal', 'validadeFgts', 'validadeCndt'] as const;

/** Código exibido (F000123). */
export const codigoExibido = (codigo: number | null | undefined) => (codigo == null ? null : `F${String(codigo).padStart(6, '0')}`);

/** Próximo código sequencial da empresa, sob trava transacional (sem colisão entre requisições simultâneas). */
export async function proximoCodigo(tx: Tx, empresaId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fornecedor-codigo:${empresaId}`}))`;
  const max = await tx.fornecedor.aggregate({ where: { empresaId }, _max: { codigo: true } });
  return (max._max.codigo ?? 0) + 1;
}

/** Documento: só dígitos, validado pelo tipo de pessoa. */
export function validarDocumento(tipoPessoa: 'JURIDICA' | 'FISICA', documento: string): string {
  const d = normalizeCnpj(documento);
  if (tipoPessoa === 'JURIDICA') {
    if (!isValidCnpj(d)) throw new ErroDeNegocio('CNPJ inválido.', 400);
  } else if (!isValidCpf(d)) {
    throw new ErroDeNegocio('CPF inválido.', 400);
  }
  return d;
}

async function documentoDuplicado(empresaId: string, documento: string, excetoId?: string) {
  const existente = await prisma.fornecedor.findFirst({
    where: { empresaId, cnpj: documento, ...(excetoId ? { NOT: { id: excetoId } } : {}) },
    select: { id: true, nome: true },
  });
  if (existente) throw Conflito(`Já existe um fornecedor com este CNPJ/CPF nesta empresa (${existente.nome}).`);
}

/** Converte o corpo validado para o formato do Prisma (datas, nulos, documento). */
function paraPrisma(d: DadosFicha): Prisma.FornecedorUncheckedUpdateInput {
  const { documento: _doc, ...resto } = d;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(resto)) {
    if (v === undefined) continue;
    if ((CAMPOS_DATA as readonly string[]).includes(k)) saida[k] = v ? new Date(v as string) : null;
    else if (typeof v === 'string' && k !== 'status' && k !== 'tipoPessoa' && k !== 'categoria' && k !== 'nome') saida[k] = v === '' ? null : v;
    else saida[k] = v;
  }
  if (saida.uf === '') saida.uf = null;
  return saida as Prisma.FornecedorUncheckedUpdateInput;
}

/** Campos obrigatórios mínimos no estado FINAL do cadastro. */
function conferirObrigatorios(f: { tipoPessoa: string; cnpj: string | null; nome: string; cep: string | null; cidade: string | null; uf: string | null }, contatos: number) {
  const faltando: string[] = [];
  if (!f.tipoPessoa) faltando.push('tipo de pessoa');
  if (!f.cnpj) faltando.push(f.tipoPessoa === 'FISICA' ? 'CPF' : 'CNPJ');
  if (!f.nome?.trim()) faltando.push(f.tipoPessoa === 'FISICA' ? 'nome' : 'razão social');
  if (!f.cep) faltando.push('CEP');
  if (!f.cidade) faltando.push('cidade');
  if (!f.uf) faltando.push('UF');
  if (contatos < 1) faltando.push('ao menos um contato');
  if (faltando.length) throw new ErroDeNegocio(`Campos obrigatórios: ${faltando.join(', ')}.`, 422);
}

async function conferirReferencias(empresaId: string, d: DadosFicha) {
  if (d.filialId) {
    const f = await prisma.filial.findFirst({ where: { id: d.filialId, empresaId }, select: { id: true } });
    if (!f) throw NaoEncontrado('Loja/filial inválida para esta empresa.');
  }
  if (d.compradorId) {
    const u = await prisma.usuario.findFirst({ where: { id: d.compradorId, empresaId }, select: { id: true } });
    if (!u) throw NaoEncontrado('Comprador inválido para esta empresa.');
  }
}

/** Remove os campos bancários do corpo quando o usuário não tem fornecedores.administrar. */
export function exigirPermissaoBancaria(d: DadosFicha, podeBancario: boolean) {
  const tocados = CAMPOS_BANCARIOS.filter((c) => d[c] !== undefined);
  if (tocados.length && !podeBancario) throw new ErroDeNegocio('Sem permissão para alterar dados bancários (fornecedores.administrar).', 403);
}

/** Mascara os dados bancários para quem não tem a permissão (mostra só os 2 últimos caracteres). */
export function mascararBancario<T extends Record<string, unknown>>(f: T, podeBancario: boolean): T {
  if (podeBancario) return f;
  const copia: Record<string, unknown> = { ...f };
  for (const c of CAMPOS_BANCARIOS) {
    const v = copia[c];
    if (typeof v === 'string' && v) copia[c] = v.length <= 2 ? '••' : `${'•'.repeat(Math.min(6, v.length - 2))}${v.slice(-2)}`;
  }
  return copia as T;
}

/** Diferenças campo a campo para a auditoria (dados bancários registrados como "alterado", sem o valor). */
export function diferencas(antes: Record<string, unknown>, depois: Record<string, unknown>, campos: string[]) {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v instanceof Prisma.Decimal ? v.toString() : v ?? null);
  const lista: Array<{ campo: string; anterior: unknown; novo: unknown }> = [];
  for (const c of campos) {
    const a = norm(antes[c]); const n = norm(depois[c]);
    if (JSON.stringify(a) === JSON.stringify(n)) continue;
    const sensivel = (CAMPOS_BANCARIOS as readonly string[]).includes(c);
    lista.push({ campo: c, anterior: sensivel ? (a ? '(protegido)' : null) : a, novo: sensivel ? (n ? '(protegido)' : null) : n });
  }
  return lista;
}

export async function criarFicha(empresaId: string, usuarioId: string, d: DadosFicha, contatos: Array<z.infer<typeof contatoSchema>>) {
  const tipoPessoa = d.tipoPessoa ?? 'JURIDICA';
  if (!d.documento) throw new ErroDeNegocio(`Campos obrigatórios: ${tipoPessoa === 'FISICA' ? 'CPF' : 'CNPJ'}.`, 422);
  const documento = validarDocumento(tipoPessoa, d.documento);
  if (!d.nome) throw new ErroDeNegocio('Campos obrigatórios: razão social / nome.', 422);
  conferirObrigatorios({ tipoPessoa, cnpj: documento, nome: d.nome, cep: d.cep || null, cidade: d.cidade || null, uf: d.uf || null }, contatos.length);
  await documentoDuplicado(empresaId, documento);
  await conferirReferencias(empresaId, d);
  return prisma.$transaction(async (tx) => {
    const codigo = await proximoCodigo(tx, empresaId);
    const f = await tx.fornecedor.create({
      data: {
        ...(paraPrisma(d) as Prisma.FornecedorUncheckedCreateInput),
        empresaId, codigo, tipoPessoa, nome: d.nome!, cnpj: documento,
        status: d.status ?? 'Ativo', categoria: d.categoria ?? 'Outros',
        criadoPorId: usuarioId, atualizadoPorId: usuarioId, origem: 'MANUAL',
      },
    });
    const temPrincipal = contatos.some((c) => c.principal);
    await tx.fornecedorContato.createMany({
      data: contatos.map((c, i) => ({ ...c, email: c.email || null, empresaId, fornecedorId: f.id, principal: temPrincipal ? !!c.principal : i === 0 })),
    });
    // Espelha o contato principal nos campos legados (a listagem e Compras ainda os leem).
    const p = contatos.find((c) => c.principal) ?? contatos[0];
    await tx.fornecedor.update({ where: { id: f.id }, data: { contato: p.nome, telefone: p.telefone || null, whatsapp: p.whatsapp || p.celular || null, email: p.email || null } });
    return f;
  });
}

export async function atualizarFicha(empresaId: string, usuarioId: string, id: string, d: DadosFicha) {
  const anterior = await prisma.fornecedor.findFirst({ where: { id, empresaId } });
  if (!anterior) throw NaoEncontrado('Fornecedor não encontrado nesta empresa.');
  const tipoPessoa = (d.tipoPessoa ?? anterior.tipoPessoa) as 'JURIDICA' | 'FISICA';
  let documento = anterior.cnpj;
  if (d.documento !== undefined || d.tipoPessoa !== undefined) {
    const bruto = d.documento ?? anterior.cnpj ?? '';
    documento = bruto ? validarDocumento(tipoPessoa, bruto) : null;
    if (documento && documento !== anterior.cnpj) await documentoDuplicado(empresaId, documento, id);
  }
  await conferirReferencias(empresaId, d);
  const contatos = await prisma.fornecedorContato.count({ where: { empresaId, fornecedorId: id } });
  const final = { ...anterior, ...paraPrisma(d), tipoPessoa, cnpj: documento } as typeof anterior;
  conferirObrigatorios(final, contatos);
  const atualizado = await prisma.$transaction(async (tx) => {
    const codigo = anterior.codigo ?? (await proximoCodigo(tx, empresaId));
    return tx.fornecedor.update({
      where: { id },
      data: { ...paraPrisma(d), tipoPessoa, cnpj: documento, codigo, atualizadoPorId: usuarioId, updatedAt: new Date() },
    });
  });
  return { anterior, atualizado };
}

/** Sincroniza os campos legados (contato/telefone/whatsapp/email) com o contato principal. */
export async function espelharContatoPrincipal(tx: Tx, empresaId: string, fornecedorId: string) {
  const p = await tx.fornecedorContato.findFirst({ where: { empresaId, fornecedorId }, orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] });
  await tx.fornecedor.update({
    where: { id: fornecedorId },
    data: p ? { contato: p.nome, telefone: p.telefone, whatsapp: p.whatsapp || p.celular, email: p.email } : { contato: null },
  });
}

/** Situação de um documento/certidão pela validade. */
export function situacaoValidade(validade: Date | null, hoje = new Date()): 'SEM_VALIDADE' | 'VALIDO' | 'A_VENCER' | 'VENCIDO' {
  if (!validade) return 'SEM_VALIDADE';
  const dias = Math.floor((validade.getTime() - hoje.getTime()) / 86_400_000);
  if (dias < 0) return 'VENCIDO';
  if (dias <= 30) return 'A_VENCER';
  return 'VALIDO';
}
