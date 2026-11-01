import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { permissaoMiddleware } from '../../middlewares/auth.js';
import { ErroDeNegocio, NaoEncontrado } from '../../lib/erros.js';
import {
  obterConfiguracoes,
  iniciarCadastroOauth,
  finalizarOAuth,
  testarConectividade,
  revogarCadastro,
} from './mercadolivre.service.js';
import {
  sincronizarProdutos,
  sincronizarEstoque,
  sincronizarPedidos,
} from './mercadolivre-sync.service.js';
import { enfileirarNotificacaoML } from './mercadolivre-notificacoes.service.js';
import { consultarAgendamentoML } from './agendador-ml.js';
import {
  consultarUsuarioML,
  atualizarUsuarioML,
  consultarUsuarioLogadoML,
  consultarEnderecosML,
  consultarMetodosPagamentoML,
  consultarAplicacaoML,
  consultarMarcasML,
  consultarPacotesPromocaoML,
  consultarNotificacoesPerdidasML,
  type UsuarioML,
  type AtualizarUsuarioMLInput,
  type EnderecoML,
  type MeioPagamentoML,
  type AplicacaoML,
  type MarcaML,
  type PacotePromocaoML,
  type NotificacaoPerdidaML,
} from './mercadolivre-consulta.service.js';

/**
 * Mapeia o `status` bruto do IntegracaoExterno para os três estados que a
 * Central entende (CONECTADO / ERRO / NAO_CONFIGURADO). REAUTENTICAR e
 * EXPIRADO viram ERRO de propósito: a conta existe mas não funciona —
 * mostrar "NÃO CONFIGURADO" esconderia um problema real do usuário.
 */
function statusDaCentral(status: string | null | undefined): 'CONECTADO' | 'ERRO' | 'NAO_CONFIGURADO' {
  if (status === 'CONECTADO') return 'CONECTADO';
  if (status === 'EXPIRADO' || status === 'REAUTENTICAR' || status === 'ERRO') return 'ERRO';
  return 'NAO_CONFIGURADO';
}

/**
 * Central de Integrações (Seção 35 do prompt mestre).
 *
 * Antes desta rodada, cada integração vivia isolada na sua própria tela
 * (`GET /pdv/integracoes`, `GET /ponto/integracao`) — não havia um único
 * lugar que mostrasse PDV + Ponto + IA + E-mail juntos, com nome, status,
 * configuração, última sincronização e erros, como o prompt pede.
 *
 * Este endpoint só agrega o que já existe — não inventa histórico nem
 * finge sincronização de nada. IA e E-mail não têm um "registro de
 * sincronização" (são chamadas por requisição, não integrações que
 * sincronizam periodicamente), então para elas o "status" reflete
 * apenas se a credencial está configurada no ambiente (`GEMINI_API_KEY`,
 * `RESEND_API_KEY`) — não testamos a chave de verdade aqui para não gastar
 * uma chamada de API a cada carregamento da tela.
 */
export async function integracoesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/integracoes',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')] },
    async (req: any) => {
      const cfg = obterConfiguracoes();
      const [pdv, ponto, ml] = await Promise.all([
        prisma.integracaoPDV.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { createdAt: 'desc' } }),
        prisma.integracaoPonto.findMany({ where: { empresaId: req.user.empresaId }, orderBy: { createdAt: 'desc' } }),
        prisma.integracaoExterno.findFirst({ where: { empresaId: req.user.empresaId, tipo: 'MERCADO_LIVRE' } }),
      ]);

      const itens = [
        ...pdv.map((i: any) => ({
          categoria: 'PDV', nome: i.nome, status: i.status, configurado: true,
          ultimaSincronizacao: i.ultimaSincronizacao, proximaSincronizacao: i.proximaSincronizacao,
          qtdRegistros: i.qtdRegistros, erros: i.erros,
        })),
        ...ponto.map((i: any) => ({
          categoria: 'CONTROLE_DE_PONTO', nome: i.nome, status: i.status, configurado: true,
          ultimaSincronizacao: i.ultimaSincronizacao, proximaSincronizacao: null,
          qtdRegistros: i.qtdRegistros, erros: i.erros,
        })),
        {
          categoria: 'IA_GEMINI', nome: 'NEXUS AI (Google Gemini)',
          status: process.env.GEMINI_API_KEY ? 'CONECTADO' : 'NAO_CONFIGURADO',
          configurado: Boolean(process.env.GEMINI_API_KEY),
          ultimaSincronizacao: null, proximaSincronizacao: null, qtdRegistros: null, erros: null,
        },
        {
          categoria: 'EMAIL_TRANSACIONAL', nome: 'E-mail (Resend — recuperação de senha)',
          status: process.env.RESEND_API_KEY ? 'CONECTADO' : 'NAO_CONFIGURADO',
          configurado: Boolean(process.env.RESEND_API_KEY),
          ultimaSincronizacao: null, proximaSincronizacao: null, qtdRegistros: null, erros: null,
        },
        {
          // O `match` do card no frontend é regex em /mercado\s*livre/i — o nome
          // precisa continuar batendo mesmo quando há conta vinculada.
          categoria: 'MERCADO_LIVRE',
          nome: ml ? `Mercado Livre${ml.accountName ? ` — ${ml.accountName}` : ''}` : 'Mercado Livre',
          status: statusDaCentral(ml?.status),
          configurado: ml?.status === 'CONECTADO',
          // true = o servidor tem as 3 variáveis oficiais no .env e o fluxo de
          // autorização PODE ser iniciado. false = "aguardando configuração no
          // servidor" — a UI usa isto para não oferecer um botão "Conectar"
          // que sempre falharia. Booleano: a resposta nunca carrega valor de
          // credencial.
          configuradoAmbiente: Boolean(cfg?.clientId && cfg?.clientSecret && cfg?.redirectUri),
          ultimaSincronizacao: ml?.ultimoSyncEm ?? null,
          proximaSincronizacao: null,
          qtdRegistros: null,
          erros: ml?.erros ?? null,
        },
      ];

      const resumo = {
        conectadas: itens.filter((i) => i.status === 'CONECTADO').length,
        comErro: itens.filter((i) => i.status === 'ERRO').length,
        naoConfiguradas: itens.filter((i) => i.status === 'NAO_CONFIGURADO').length,
        total: itens.length,
      };

      return { itens, resumo };
    },
  );

  // ===========================================================================
  // Mercado Livre — OAuth 2.0 (authorization code grant, server side)
  //
  // Fluxo real: POST /conectar grava `state` (nonce de 24 bytes/192 bits, 10
  // min, uso único) e devolve a authUrl oficial -> usuário autoriza no Mercado Livre ->
  // o ML redireciona o BROWSER para GET /callback (SEM sessão: a âncora de
  // segurança é exclusivamente o `state` persistido + expiração) -> redirect
  // de volta para /central-integracoes com o resultado.
  //
  // Regras: empresaId SEMPRE vem da sessão autenticada (nunca do body); tokens
  // são criptografados em `secrets.ts` e NUNCA aparecem em resposta alguma.
  // ===========================================================================

  /** Registro único (unique por empresaId+tipo) da conta ML desta empresa. */
  async function registroMl(empresaId: string) {
    return prisma.integracaoExterno.findFirst({ where: { empresaId, tipo: 'MERCADO_LIVRE' } });
  }

  app.get(
    '/integracoes/mercadolivre',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')] },
    async (req: any) => {
      const cfg = obterConfiguracoes();
      const registro = await registroMl(req.user.empresaId);
      // Contrato deliberadamente enxuto: sem clientId/clientSecret/accessToken/
      // refreshToken. O front só precisa saber se está conectado e se o
      // ambiente tem credenciais para iniciar o fluxo.
      return {
        configuradoAmbiente: Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri),
        status: statusDaCentral(registro?.status),
        statusDetalhe: registro?.status ?? 'NAO_CONFIGURADO',
        conta: registro?.accountId
          ? { accountId: registro.accountId, accountName: registro.accountName }
          : null,
        tokenExpiry: registro?.tokenExpiry ?? null,
        ultimoTesteEm: registro?.ultimoTesteEm ?? null,
        ultimoSyncEm: registro?.ultimoSyncEm ?? null,
        erros: registro?.erros ?? null,
      };
    },
  );

  app.post(
    '/integracoes/mercadolivre/conectar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'criar')] },
    async (req: any) => {
      const { nome } = z
        .object({ nome: z.string().trim().min(1).max(120).default('Mercado Livre') })
        .parse(req.body ?? {});
      const { authUrl } = await iniciarCadastroOauth({
        empresaId: req.user.empresaId,
        usuarioId: req.user.id,
        nome,
      });
      return { authUrl };
    },
  );

  /**
   * Callback PÚBLICO (sem preHandler de autenticação): o Mercado Livre
   * redireciona o browser do usuário para cá direto da tela de login do ML,
   * portanto não existe sessão NEXUS OS para validar aqui. A segurança vem do
   * `state` — nonce aleatório de 24 bytes (192 bits), validade de 10 minutos, consumo
   * atômico de uso único (ver `finalizarOAuth`). Nunca devolve JSON de erro
   * com detalhe interno: sempre redireciona para a Central com o motivo.
   */
  app.get('/integracoes/mercadolivre/callback', async (req: any, reply: any) => {
    const base =
      (process.env.FRONTEND_URLS || '').split(',')[0]?.trim() || 'http://localhost:3000';
    const ir = (resultado: 'conectado' | 'erro', motivo?: string) =>
      reply.redirect(
        `${base}/central-integracoes?ml=${resultado}${motivo ? `&motivo=${encodeURIComponent(motivo)}` : ''}`,
      );
    // `safeParse` + redirect: o contrato desta rota é SEMPRE redirecionar.
    // Com `.parse`, uma query malformada (ex.: ?code=a&code=b — parâmetro
    // repetido vira array no Node) lançava ZodError e o errorHandler global
    // respondia 400 JSON com `detalhes` do schema interno — o usuário ficava
    // preso numa página de JSON no meio do login do Mercado Livre.
    const parseado = z
      .object({
        code: z.string().min(1).optional(),
        state: z.string().min(1).optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .safeParse(req.query);
    if (!parseado.success) {
      return ir('erro', 'Parâmetros de retorno inválidos. Inicie a conexão novamente.');
    }
    const q = parseado.data;

    // `error_description` vem do provedor (ou de link forjado): limita o
    // motivo antes de montar o redirect para não gerar um Location gigante.
    const motivoDoProvedor = (q.error_description || q.error || '').slice(0, 300) || undefined;
    if (q.error || !q.code || !q.state) {
      return ir('erro', motivoDoProvedor || 'Parâmetros de retorno ausentes.');
    }
    // O state é o ÚNICO vínculo com uma empresa (é ele que conecta o callback
    // à tentativa pendente). Sem ele bater, o fluxo nem inicia.
    const candidato = await prisma.integracaoExterno.findFirst({
      where: { state: q.state, tipo: 'MERCADO_LIVRE' },
      select: { empresaId: true },
    });
    if (!candidato) {
      return ir('erro', 'Estado de autenticação inválido ou expirado. Inicie a conexão novamente.');
    }
    try {
      await finalizarOAuth({ empresaId: candidato.empresaId, state: q.state, code: q.code });
      return ir('conectado');
    } catch (err) {
      const motivo =
        err instanceof ErroDeNegocio ? err.message : 'Falha ao concluir a autenticação com o Mercado Livre.';
      return ir('erro', motivo);
    }
  });

  app.post(
    '/integracoes/mercadolivre/testar',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'editar')] },
    async (req: any) => {
      const registro = await registroMl(req.user.empresaId);
      if (!registro) {
        throw NaoEncontrado('Nenhuma conta do Mercado Livre vinculada a esta empresa.');
      }
      return testarConectividade(req.user.empresaId, registro.id);
    },
  );

  app.delete(
    '/integracoes/mercadolivre',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'excluir')] },
    async (req: any) => {
      const registro = await registroMl(req.user.empresaId);
      if (!registro) {
        throw NaoEncontrado('Nenhuma conta do Mercado Livre vinculada a esta empresa.');
      }
      return revogarCadastro(req.user.empresaId, registro.id);
    },
  );

  // ===========================================================================
  // Sincronização manual — Etapas 2-4 do plano Mercado Livre
  // (produtos, estoque e pedidos; todas exigem permissão integracoes:editar e
  // reutilizam a trava de sync + Importacao/Auditoria do serviço.)
  // ===========================================================================

  /**
   * Sincroniza o catálogo de anúncios do ML para o cadastro interno (ETAPA 2).
   * `limiteAnuncios` opcional: padrão 100, teto 1000 (mesmo teto do serviço).
   * Anúncio removido do ML NÃO apaga produto interno algum.
   */
  app.post(
    '/integracoes/mercadolivre/sync/produtos',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'editar')] },
    async (req: any) => {
      const body = z
        .object({ limiteAnuncios: z.number().int().min(1).max(1000).optional() })
        .safeParse(req.body ?? {});
      if (!body.success) {
        throw new ErroDeNegocio('limiteAnuncios deve ser um inteiro entre 1 e 1000.', 400);
      }
      return sincronizarProdutos({
        empresaId: req.user.empresaId,
        usuarioId: req.user.id,
        ...(body.data.limiteAnuncios !== undefined ? { limiteAnuncios: body.data.limiteAnuncios } : {}),
      });
    },
  );

  /**
   * Empurra o estoque NEXUS → ML (ETAPA 3): só produtos espelho INTEGRACAO
   * com SKU `ML-` participam; saldo NUNCA é baixado internamente por aqui.
   */
  app.post(
    '/integracoes/mercadolivre/sync/estoque',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'editar')] },
    async (req: any) => {
      const { filialId } = z.object({ filialId: z.string().min(1) }).parse(req.body ?? {});
      return sincronizarEstoque({ empresaId: req.user.empresaId, usuarioId: req.user.id, filialId });
    },
  );

  /**
   * Importa pedidos recentes do ML como vendas internas (ETAPA 4).
   * Idempotente por pedido (IdempotencyKey `ml:order:{id}`); duplicatas
   * recebem o desfecho gravado, sem segunda venda. `limite` opcional:
   * padrão 50, teto 500.
   */
  app.post(
    '/integracoes/mercadolivre/sync/pedidos',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'editar')] },
    async (req: any) => {
      const body = z
        .object({
          filialId: z.string().min(1),
          limite: z.number().int().min(1).max(500).optional(),
        })
        .parse(req.body ?? {});
      return sincronizarPedidos({
        empresaId: req.user.empresaId,
        usuarioId: req.user.id,
        filialId: body.filialId,
        ...(body.limite !== undefined ? { limite: body.limite } : {}),
      });
    },
  );

  /**
   * Observabilidade da sincronização AUTOMÁTICA (agendador persistente).
   *
   * Somente LEITURA do estado das tarefas da PRÓPRIA empresa (`where:
   * { empresaId }` na origem) — nunca vaza tarefa/erro de outra empresa, e a
   * resposta não contém token, segredo, accountId ou cabeçalho algum: o
   * `ultimoErro` chega já redigido (somente motivo/em/permanente).
   *
   * Expõe: última execução/sucesso, próxima execução prevista, estado atual,
   * processados/falhas da última, tentativas, tarefas recuperadas (lease
   * expirado = restart), pausadas (conta desconectada) e períodos configurados.
   */
  app.get(
    '/integracoes/mercadolivre/sync/agendamento',
    { preHandler: [(app as any).authenticate, await permissaoMiddleware('integracoes', 'visualizar')] },
    async (req: any) => consultarAgendamentoML(req.user.empresaId),
  );

  // ============================================================================
  // Rotas de consulta de dados do usuário — API oficial do Mercado Livre
  // ============================================================================

  /** 1. GET /integracoes/mercadolivre/users/{userId} — dados de qualquer usuário pelo ID. */
  app.get(
    '/integracoes/mercadolivre/users/:userId',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { userId } = req.params as { userId: string };
      const dados = await consultarUsuarioML(req.user.empresaId, userId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 2. PUT /integracoes/mercadolivre/users/me — atualizar dados do usuário logado. */
  app.put(
    '/integracoes/mercadolivre/users/me',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'editar'),
      ],
    },
    async (req: any, reply: any) => {
      // Validação de corpo EM RUNTIME (padrão do arquivo: safeParse + 400).
      // Antes existia apenas um cast de TypeScript (`req.body as ...`), que não
      // sobrevive à compilação: qualquer chave do JSON — ex.: `id`, `empresaId` —
      // era encaminhada direto para a API do Mercado Livre.
      // Este `strictObject` é a allowlist em espelho com
      // `AtualizarUsuarioMLInput` (mercadolivre-consulta.service.ts): chaves
      // fora da lista ou tipos errados são rejeitados ANTES de qualquer
      // chamada externa. Todos os campos são opcionais — corpo vazio `{}` é
      // contrato válido da API (atualização parcial).
      const corpo = z
        .strictObject({
          first_name: z.string().optional(),
          last_name: z.string().optional(),
          phone: z
            .strictObject({ area_code: z.string().optional(), number: z.string().optional() })
            .optional(),
          address: z
            .strictObject({
              address: z.string().optional(),
              city: z.string().optional(),
              state: z.string().optional(),
              zip_code: z.string().optional(),
            })
            .optional(),
          company: z
            .strictObject({
              corporate_name: z.string().optional(),
              brand_name: z.string().optional(),
            })
            .optional(),
        })
        .safeParse(req.body ?? {});
      if (!corpo.success) {
        throw new ErroDeNegocio(
          'Dados inválidos: campos permitidos são first_name, last_name, phone, address e company.',
          400,
        );
      }
      const dados = corpo.data as AtualizarUsuarioMLInput;
      const atualizado = await atualizarUsuarioML(req.user.empresaId, dados);
      return reply.send({ ok: true, dados: atualizado });
    },
  );

  /** 3. GET /integracoes/mercadolivre/users/me — dados do usuário logado (pelo token). */
  app.get(
    '/integracoes/mercadolivre/users/me',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const dados = await consultarUsuarioLogadoML(req.user.empresaId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 4. GET /integracoes/mercadolivre/users/{userId}/addresses — endereços do usuário. */
  app.get(
    '/integracoes/mercadolivre/users/:userId/addresses',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { userId } = req.params as { userId: string };
      const dados = await consultarEnderecosML(req.user.empresaId, userId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 5. GET /integracoes/mercadolivre/users/{userId}/accepted_payment_methods — meios de pagamento aceitos. */
  app.get(
    '/integracoes/mercadolivre/users/:userId/accepted_payment_methods',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { userId } = req.params as { userId: string };
      const dados = await consultarMetodosPagamentoML(req.user.empresaId, userId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 6. GET /integracoes/mercadolivre/applications/{applicationId} — dados da aplicação. */
  app.get(
    '/integracoes/mercadolivre/applications/:applicationId',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { applicationId } = req.params as { applicationId: string };
      const dados = await consultarAplicacaoML(req.user.empresaId, applicationId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 7. GET /integracoes/mercadolivre/users/{userId}/brands — marcas do usuário. */
  app.get(
    '/integracoes/mercadolivre/users/:userId/brands',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { userId } = req.params as { userId: string };
      const dados = await consultarMarcasML(req.user.empresaId, userId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 8. GET /integracoes/mercadolivre/users/{userId}/classifieds_promotion_packs — pacotes de promoção. */
  app.get(
    '/integracoes/mercadolivre/users/:userId/classifieds_promotion_packs',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { userId } = req.params as { userId: string };
      const dados = await consultarPacotesPromocaoML(req.user.empresaId, userId);
      return reply.send({ ok: true, dados });
    },
  );

  /** 9. GET /integracoes/mercadolivre/missed_feeds — notificações perdidas (sincronização).
   * Query: ?app_id={APP_ID}&user_id={USER_ID(opcional)}
   */
  app.get(
    '/integracoes/mercadolivre/missed_feeds',
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware('integracoes', 'visualizar'),
      ],
    },
    async (req: any, reply: any) => {
      const { user_id } = req.query as { user_id?: string };
      const dados = await consultarNotificacoesPerdidasML(
        req.user.empresaId,
        user_id,
      );
      return reply.send({ ok: true, dados });
    },
  );

  // Webhook público: Mercado Livre não assina as notificações tradicionais.
  // A aplicação e a conta são conferidas; ponteiro é persistido antes do 200.
  app.post('/integracoes/mercadolivre/webhook', async (req: any, reply: any) => {
    const parseado = z
      .object({
        resource: z.string().min(1).max(200),
        user_id: z.union([z.number(), z.string()]),
        topic: z.string().min(1).max(60),
        id: z.union([z.number(), z.string().max(100)]).nullish(),
        _id: z.union([z.number(), z.string().max(100)]).nullish(),
        application_id: z.union([z.number(), z.string().max(32)]).nullish(),
        at: z.string().nullish(),
        attempts: z.number().nullish(),
      })
      .safeParse(req.body);
    if (!parseado.success) {
      return reply.code(200).send({ processada: false, motivo: 'Payload de notificação inválido.' });
    }
    const appId = String(process.env.MERCADOLIVRE_CLIENT_ID ?? '').trim();
    const notificacaoAppId = parseado.data.application_id == null ? '' : String(parseado.data.application_id);
    if (appId && notificacaoAppId && notificacaoAppId !== appId) {
      req.log.warn({ application_id: notificacaoAppId || undefined }, 'webhook ML ignorado: aplicação não corresponde ao servidor.');
      return reply.code(200).send({ processada: false, motivo: 'Aplicação da notificação não corresponde.' });
    }
    const evento = parseado.data;
    const topic = evento.topic.toLowerCase();
    const recursoPedido = /^\/orders\/\d+$/.test(evento.resource);
    const recursoPagamento = /^\/collections\/\d+$/.test(evento.resource);
    const recursoItem = /^\/items\/[A-Za-z0-9]+$/.test(evento.resource);
    if (!((recursoPedido && ['order', 'orders', 'orders_v2'].includes(topic))
      || (recursoPagamento && topic === 'payments')
      || (recursoItem && ['item', 'items'].includes(topic)))) {
      return reply.code(200).send({ processada: false, motivo: 'Recurso ou tópico fora do escopo de sincronização.' });
    }
    try {
      const resultado = await enfileirarNotificacaoML(evento);
      return reply.code(200).send({
        accepted: true,
        queued: resultado.enfileirada,
        duplicate: resultado.duplicada,
        ...(resultado.ignorada
          ? { ignored: resultado.ignorada, motivo: resultado.ignorada }
          : { motivo: resultado.duplicada ? 'Notificação duplicada já enfileirada.' : 'Notificação persistida para processamento automático.' }),
      });
    } catch (err) {
      req.log.error({ err }, 'falha ao persistir webhook do Mercado Livre');
      return reply.code(503).send({ accepted: false, queued: false, retry: true });
    }
  });
}
