import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware, permissaoQualquerDas } from '../../middlewares/auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.service.js';
import { NaoAutorizado, NaoEncontrado, Conflito } from '../../lib/erros.js';
import { criarEstoqueParaFilial } from '../estoque/estoque.service.js';
import { isValidCnpj } from '../../domain/cnpj.js';

const origemSchema = z.enum(['MANUAL', 'IMPORTADO', 'API', 'AUTOMATICO']);

/**
 * Campos cadastrais que a tela de Configurações pode editar.
 *
 * `id`, `status`, `origem` e as relações NÃO entram aqui de propósito:
 *   • `status`/`origem` são decisão de ciclo de vida, não dado cadastral;
 *   • o usuário logado NUNCA edita outra empresa — o filtro é sempre
 *     `id === req.user.empresaId` (isolamento multi-tenant).
 *
 * `cnpj` e `cep` são normalizados para só dígitos (clean) e o CNPJ passa
 * pelo dígito verificador oficial, exatamente como no POST
 * /auth/register-company — nada de gravar CNPJ inválido.
 */
const empresaEditableSchema = z
  .object({
    nome: z.string().min(2).max(160).optional(),
    razaoSocial: z.string().max(160).nullable().optional(),
    cnpj: z.string().max(20).nullable().optional(),
    inscricaoEstadual: z.string().max(32).nullable().optional(),
    responsavelCpf: z.string().max(20).nullable().optional(),
    responsavelRg: z.string().max(32).nullable().optional(),
    cep: z.string().max(12).nullable().optional(),
    endereco: z.string().max(200).nullable().optional(),
    cidade: z.string().max(120).nullable().optional(),
    estado: z.string().max(2).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nenhum campo para atualizar.' });

/** Vazio -> null: o banco guarda "não informado" como NULL, não como ''. */
const vazioParaNulo = (v?: string | null): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const limpo = v.trim();
  return limpo.length === 0 ? null : limpo;
};

/**
 * Documento/CEP normalizado para só dígitos, já no formato do banco.
 * `undefined` = campo não veio no corpo (não tocar);
 * `null`       = o campo veio e deve ser apagado.
 */
const digitosOuNulo = (v?: string | null): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const limpo = v.replace(/\D/g, '');
  return limpo.length === 0 ? null : limpo;
};


export async function empresaRoutes(app: FastifyInstance): Promise<void> {
  // Não existe endpoint para criar uma empresa nova a partir de uma sessão já
  // autenticada: o único jeito de nascer uma Empresa é POST /auth/register-
  // company (auth.routes.ts), que também cria a filial, o usuário fundador
  // e a assinatura na mesma transação. Um endpoint solto "POST /empresas"
  // existia aqui antes: ele criava uma Empresa órfã (sem filial, sem
  // usuário, sem assinatura) e ficava acessível a qualquer usuário com a
  // permissão genérica empresa.criar — que hoje é todo usuário fundador,
  // já que o cadastro concede todas as permissões. Isso não é uma segunda
  // empresa "legítima" no modelo atual (1 usuário pertence a exatamente 1
  // empresa via Usuario.empresaId): era código morto/inconsistente com o
  // isolamento por tenant, então foi removido nesta fase. Se no futuro o
  // NEXUS OS precisar de multiempresa POR USUÁRIO (ex.: um contador
  // atendendo várias empresas) ou de um papel de administrador de
  // plataforma, isso é uma decisão de schema (tabela de associação
  // Usuario<->Empresa) que precisa ser tomada explicitamente — não recriar
  // este endpoint sem resolver isso primeiro.

  // Retorna a empresa do usuário autenticado (nunca outra, mesmo que
  // alguém tente adivinhar um id — o filtro é sempre req.user.empresaId).
  app.get(
    '/empresas',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.empresa.findMany({ where: { id: req.user.empresaId }, include: { filiais: true, setores: true } });
    },
  );

  // Edição dos dados cadastrais — usada pela aba "Empresa" de Configurações.
  //
  // Regras de isolamento e de segurança (Seção 6 e multi-tenant):
  //   1. o `:id` da rota é confrontado com `req.user.empresaId`. Se não bater,
  //      é 403 — nunca 404 "not found", que vazaria a existência do id;
  //   2. `where: { id: req.user.empresaId }` no filtro do banco, então nem
  //      um id adivinhado alcança outra empresa;
  //   3. toda alteração fica registrada na auditoria com valor anterior e
  //      novo — dado cadastral é o que o contador/fiscal mais vai questionar.
  app.put(
    '/empresas/:id',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'editar')] },
    async (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      if (id !== req.user.empresaId) throw NaoAutorizado('Você só pode editar a empresa da sua sessão.');

      const corpo = empresaEditableSchema.parse(req.body ?? {});

      // Normaliza documento/CEP e valida o CNPJ antes de tocar no banco.
      const cnpj = digitosOuNulo(corpo.cnpj);
      if (cnpj) {
        if (!isValidCnpj(cnpj)) throw new Error('CNPJ inválido — confira os dígitos verificadores.');
        const dono = await prisma.empresa.findUnique({ where: { cnpj }, select: { id: true } });
        if (dono && dono.id !== req.user.empresaId) throw Conflito('Este CNPJ já pertence a outra empresa.');
      }
      if (corpo.estado !== undefined && corpo.estado !== null && !/^[A-Za-z]{2}$/.test(corpo.estado.trim())) {
        throw new Error('UF inválida: use as duas letras do estado (ex.: SP).');
      }

      const data: Record<string, unknown> = {};
      if (corpo.nome !== undefined) data.nome = corpo.nome.trim();
      if (corpo.razaoSocial !== undefined) data.razaoSocial = vazioParaNulo(corpo.razaoSocial);
      if (cnpj !== undefined) data.cnpj = cnpj;
      if (corpo.inscricaoEstadual !== undefined) data.inscricaoEstadual = vazioParaNulo(corpo.inscricaoEstadual);
      if (corpo.responsavelCpf !== undefined) data.responsavelCpf = digitosOuNulo(corpo.responsavelCpf);
      if (corpo.responsavelRg !== undefined) data.responsavelRg = vazioParaNulo(corpo.responsavelRg);
      if (corpo.cep !== undefined) data.cep = digitosOuNulo(corpo.cep);
      if (corpo.endereco !== undefined) data.endereco = vazioParaNulo(corpo.endereco);
      if (corpo.cidade !== undefined) data.cidade = vazioParaNulo(corpo.cidade);
      if (corpo.estado !== undefined) {
        const uf = vazioParaNulo(corpo.estado);
        data.estado = uf ? uf.toUpperCase() : null;
      }

      const anterior = await prisma.empresa.findFirst({
        where: { id: req.user.empresaId },
        select: {
          nome: true, razaoSocial: true, cnpj: true, inscricaoEstadual: true,
          responsavelCpf: true, responsavelRg: true, cep: true,
          endereco: true, cidade: true, estado: true,
        },
      });
      if (!anterior) throw NaoEncontrado('Empresa não encontrada.');

      const empresa = await prisma.empresa.update({ where: { id: req.user.empresaId }, data });

      // Auditoria só com os campos que de fato mudaram de valor — evita
      // poluir o histórico com "cidade: mesma cidade".
      const antesDe = anterior as unknown as Record<string, unknown>;
      const camposAlterados = Object.fromEntries(
        Object.entries(data).filter(
          ([campo, valor]) => (antesDe[campo] ?? null) !== (valor ?? null),
        ),
      );
      const listaDeCampos = Object.keys(camposAlterados);

      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: req.user.empresaId,
        acao: 'EDITAR',
        entidade: 'Empresa',
        entidadeId: req.user.empresaId,
        valorAnterior: Object.fromEntries(
          listaDeCampos.map((campo) => [campo, antesDe[campo] ?? null]),
        ) as Prisma.InputJsonValue,
        valorNovo: camposAlterados as Prisma.InputJsonValue,
        origem: 'MANUAL',
        ip: req.ip,
        contexto: `Dados cadastrais da empresa atualizados (${listaDeCampos.join(', ')}).`,
      });

      return empresa;
    },
  );

  // Filiais - Seção 4

  /**
   * GET /filiais — a lista de filiais da empresa do usuário.
   *
   * POR QUE ESTA ROTA EXISTIA FALTANDO
   * ----------------------------------
   * O `POST /filiais` estava pronto desde a Seção 4, mas não havia NENHUMA
   * rota de leitura. Três telas precisavam da lista e nenhuma conseguia:
   *
   *   1. PDV (`pdv/page.tsx`) — chama `/filiais` para montar o seletor de
   *      filial do balcão, e engole o 404 num catch vazio ("seguirá sem
   *      filiais"). Com a rota ausente, a lista vinha vazia, `filialId`
   *      ficava `''` e TODO o PDV morria: `carregarProdutos` começa com
   *      `if (!filialId) return;` e `abrirCaixa` responde "Selecione a
   *      filial". Ou seja: a falha de uma rota ausente aparecia como "o PDV
   *      está quebrado", sem nenhuma pista.
   *   2. Estoque — hoje contorna chamando `GET /estoque` (que embute
   *      `filiais`), o que amarra a lista de cadastro a uma permissão e a uma
   *      consulta pesada de estoque só para obter dois campos.
   *   3. Vendas — contorna com `GET /empresas` e `e[0].filiais`, o que
   *      funciona só porque o fundador tem todas as permissões; um vendedor
   *      sem `empresa:visualizar` receberia 403.
   *
   * POR QUE `permissaoQualquerDas` E NÃO UM MÓDULO SÓ
   * -------------------------------------------------
   * A lista de filiais é dado de REFERÊNCIA, consumido por módulos diferentes:
   * quem opera um caixa precisa dela (`pdv`), quem mexe em estoque também
   * (`estoque`), quem vende também (`vendas`), e quem administra a empresa
   * também (`empresa`). Exigir `empresa:visualizar` — o módulo "dono" da
   * entidade — quebraria justamente o PDV, cujo usuário é o caixa: ele recebe
   * permissões granulares via `PUT /usuarios/:id/permissoes` e quase nunca tem
   * `empresa:visualizar`. O sintoma seria o mesmo de hoje, só que com 403 em
   * vez de 404.
   *
   * Isto NÃO amplia acesso a nada: a resposta é a lista da PRÓPRIA empresa
   * (`empresaId` do token, nunca um id da query) e devolve só o mínimo
   * necessário para escolher uma filial — conforme o aviso do próprio
   * `permissaoQualquerDas`, cada rota que o usa tem de devolver o mínimo.
   * Por isso NÃO entra o CNPJ aqui: ele é dado cadastral/financeiro e continua
   * disponível em `GET /empresas`, que é `empresa:visualizar`.
   *
   * FILTRAGEM
   * ---------
   * Por padrão devolve só as filiais ATIVAS. Filial inativa ou arquivada não
   * é destino de transferência nem balcão válido, e mostrá-la num seletor
   * gera erro na hora de usar. `?incluirInativas=true` traz todas, para telas
   * administrativas (Configurações → Empresa), que precisam ver o histórico.
   */
  app.get(
    '/filiais',
    {
      preHandler: [
        app.authenticate,
        await permissaoQualquerDas([
          { modulo: 'empresa', acao: 'visualizar' },
          { modulo: 'estoque', acao: 'visualizar' },
          { modulo: 'pdv', acao: 'visualizar' },
          { modulo: 'vendas', acao: 'visualizar' },
        ]),
      ],
    },
    async (req: FastifyRequest) => {
      const query = z
        .object({
          // A querystring é sempre string, então o parâmetro é `z.enum` de texto e não
          // booleano: `?incluirInativas=1` (ou `=sim`) seria recusado com 422 em
          // vez de ser silenciosamente entendido como `true` por um
          // `Boolean("1")`. O `.transform` converte uma vez, na fronteira.
          incluirInativas: z
            .enum(['true', 'false'])
            .optional()
            .transform((v) => v === 'true'),
        })
        .parse(req.query ?? {});

      const filiais = await prisma.filial.findMany({
        // Multi-tenant: o filtro vem SEMPRE do token. Aceitar `empresaId` da
        // query permitiria listar as filiais de outra empresa.
        where: {
          empresaId: req.user.empresaId,
          ...(query.incluirInativas ? {} : { status: 'ATIVO' }),
        },
        // `select` e não `include`: mesmo princípio do gate de custos em
        // `GET /estoque` — o que não é devolvido por esta rota não sai do
        // banco. Sem `cnpj`, `origem`, `createdAt`/`updatedAt`.
        select: { id: true, nome: true, cidade: true, estado: true, status: true },
        orderBy: { nome: 'asc' },
      });

      return { filiais, total: filiais.length };
    },
  );

  app.post(
    '/filiais',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({
        empresaId: z.string(),
        nome: z.string().min(2),
        cnpj: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        origem: origemSchema.default('MANUAL'),
      });
      const data = schema.parse(req.body);
      if (data.empresaId !== req.user.empresaId) throw NaoAutorizado('Empresa inválida para esta sessão.');
      const filial = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const nova = await tx.filial.create({
          data: { empresaId: data.empresaId, nome: data.nome, cnpj: data.cnpj, cidade: data.cidade, estado: data.estado, origem: data.origem },
        });
        // Mantém o invariante Produto×Filial (ver estoque.service.ts):
        // uma filial nova precisa de uma linha de Estoque (quantidade 0)
        // para cada produto ativo já existente na empresa.
        await criarEstoqueParaFilial(tx, data.empresaId, nova.id);
        return nova;
      });
      await registrarAuditoria({
        usuarioId: req.user.id,
        empresaId: data.empresaId,
        acao: 'CRIAR',
        entidade: 'Filial',
        entidadeId: filial.id,
        valorNovo: filial,
        origem: data.origem,
        ip: req.ip,
      });
      return filial;
    },
  );

  // Setores - Seção 4
  app.post(
    '/setores',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'criar')] },
    async (req: FastifyRequest) => {
      const schema = z.object({ empresaId: z.string(), filialId: z.string().optional(), nome: z.string().min(2), descricao: z.string().optional() });
      const data = schema.parse(req.body);
      if (data.empresaId !== req.user.empresaId) throw NaoAutorizado('Empresa inválida para esta sessão.');
      if (data.filialId) {
        const filial = await prisma.filial.findFirst({ where: { id: data.filialId, empresaId: req.user.empresaId } });
        if (!filial) throw NaoEncontrado('Filial inválida para esta empresa.');
      }
      return prisma.setor.create({ data });
    },
  );

  app.get(
    '/setores',
    { preHandler: [app.authenticate, await permissaoMiddleware('empresa', 'visualizar')] },
    async (req: FastifyRequest) => {
      return prisma.setor.findMany({ where: { empresaId: req.user.empresaId } });
    },
  );
}
