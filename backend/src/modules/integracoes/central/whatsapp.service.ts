/**
 * WhatsApp Business (Cloud API da Meta) — envio, webhook e histórico por empresa.
 *
 * Envio: POST https://graph.facebook.com/<versão>/<PHONE_NUMBER_ID>/messages
 *  - texto livre só dentro da janela de 24 h desde a última mensagem do cliente
 *    (fora dela a Meta recusa com o erro 131047 → use um modelo aprovado);
 *  - modelo (template) aprovado pela Meta: name + language.code + parâmetros do corpo.
 *  A resposta 200 significa "aceito pela Meta", não "entregue": a entrega/leitura chega
 *  depois pelo webhook de status.
 *
 * Webhook (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint):
 *  - GET: hub.mode=subscribe + hub.verify_token igual ao salvo → devolve hub.challenge;
 *  - POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo BRUTO, App Secret);
 *    comparação em tempo constante; sem App Secret salvo, o evento é recusado.
 *  - Só processa eventos cujo metadata.phone_number_id é o número DESTA empresa.
 *  - Idempotente: wamid é único por empresa (mensagem recebida repetida é ignorada;
 *    status só avança: ENVIADA → ENTREGUE → LIDA; FALHOU registra o erro).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { credenciaisInternas, credenciaisPorRegistro, registrarEvento } from './central.service.js';
import { lerErroGraph, versaoGraph } from './adaptadores.js';

const ORDEM_STATUS: Record<string, number> = { ENVIANDO: 0, ENVIADA: 1, ENTREGUE: 2, LIDA: 3, FALHOU: 4 };
const STATUS_META: Record<string, string> = { sent: 'ENVIADA', delivered: 'ENTREGUE', read: 'LIDA', played: 'LIDA', failed: 'FALHOU' };

/** Só dígitos, 10 a 15 (padrão E.164 sem "+"). Números brasileiros sem DDI ganham 55. */
export function telefoneWhatsApp(bruto: string): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export interface EnvioWhatsApp {
  para: string;
  tipo: 'TEXTO' | 'MODELO';
  texto?: string;
  modelo?: { nome: string; idioma: string; parametros: string[] };
  origem?: string;
}

export async function enviarWhatsApp(empresaId: string, usuarioId: string | null, envio: EnvioWhatsApp) {
  const cred = await credenciaisInternas(empresaId, 'whatsapp');
  if (!cred || cred.status !== 'CONECTADO') throw new ErroDeNegocio('O WhatsApp Business não está conectado. Configure e teste a conexão na Central de Integrações.', 409);
  const para = telefoneWhatsApp(envio.para);
  if (!para) throw new ErroDeNegocio('Telefone inválido. Use DDD + número (ex.: 11 99999-8888) ou o formato internacional.', 400);
  let corpo: Record<string, unknown>;
  let resumo: string;
  if (envio.tipo === 'TEXTO') {
    const texto = (envio.texto ?? '').trim();
    if (!texto || texto.length > 4096) throw new ErroDeNegocio('Mensagem de texto vazia ou longa demais (máx. 4096).', 400);
    corpo = { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'text', text: { preview_url: false, body: texto } };
    resumo = texto;
  } else {
    const m = envio.modelo;
    if (!m || !/^[a-z0-9_]{1,512}$/.test(m.nome) || !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(m.idioma)) throw new ErroDeNegocio('Informe o nome do modelo aprovado (minúsculas e _) e o idioma (ex.: pt_BR).', 400);
    corpo = {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'template',
      template: { name: m.nome, language: { code: m.idioma }, ...(m.parametros.length ? { components: [{ type: 'body', parameters: m.parametros.map((t) => ({ type: 'text', text: t.slice(0, 1024) })) }] } : {}) },
    };
    resumo = `Modelo ${m.nome}${m.parametros.length ? ` (${m.parametros.join(' · ')})` : ''}`;
  }
  const msg = await prisma.whatsappMensagem.create({ data: { empresaId, direcao: 'ENVIADA', telefone: para, tipo: envio.tipo === 'TEXTO' ? 'text' : 'template', conteudo: resumo.slice(0, 1000), status: 'ENVIANDO', origem: envio.origem ?? 'CENTRAL', usuarioId } });
  const inicio = Date.now();
  let r: Response;
  try {
    r = await fetch(`https://graph.facebook.com/${versaoGraph(cred.config)}/${cred.config.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${cred.segredos.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
  } catch {
    await prisma.whatsappMensagem.update({ where: { id: msg.id }, data: { status: 'FALHOU', erro: 'Sem comunicação com a Meta (timeout ou rede).' } });
    await registrarEvento({ empresaId, provedor: 'whatsapp', operacao: 'SINCRONIZAR', ok: false, codigoErro: 'FALHA_COMUNICACAO', mensagem: 'Envio de mensagem: sem comunicação com a Meta.', duracaoMs: Date.now() - inicio, usuarioId });
    return { id: msg.id, status: 'FALHOU', erro: 'Sem comunicação com a Meta. Tente novamente.' };
  }
  if (r.ok) {
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[] };
    const wamid = j.messages?.[0]?.id ?? null;
    await prisma.whatsappMensagem.update({ where: { id: msg.id }, data: { status: 'ENVIADA', waMessageId: wamid } });
    return { id: msg.id, status: 'ENVIADA', waMessageId: wamid };
  }
  const e = await lerErroGraph(r);
  const erro = e.code === 131047 ? 'Fora da janela de 24 h: o cliente não escreveu nas últimas 24 horas. Use um modelo aprovado.'
    : e.code === 190 ? 'Access Token expirado ou inválido (erro 190). Reconecte o WhatsApp.'
    : `Recusado pela Meta${e.code ? ` (erro ${e.code})` : ''}: ${(e.message ?? `HTTP ${r.status}`).slice(0, 200)}`;
  await prisma.whatsappMensagem.update({ where: { id: msg.id }, data: { status: 'FALHOU', erro } });
  if (e.code === 190) await prisma.integracaoExterno.update({ where: { id: cred.id }, data: { status: 'EXPIRADO', erros: { code: 'CREDENCIAL_INVALIDA', message: erro } } });
  return { id: msg.id, status: 'FALHOU', erro };
}

export async function listarMensagens(empresaId: string, filtro: { direcao?: string; limite?: number }) {
  return prisma.whatsappMensagem.findMany({
    where: { empresaId, ...(filtro.direcao ? { direcao: filtro.direcao } : {}) },
    orderBy: { createdAt: 'desc' }, take: Math.min(filtro.limite ?? 50, 200),
    select: { id: true, direcao: true, telefone: true, nomeContato: true, tipo: true, conteudo: true, status: true, erro: true, origem: true, createdAt: true, atualizadoEm: true },
  });
}

// ------------------------------- Webhook ------------------------------------

export async function verificarAssinaturaWebhook(registroId: string) {
  return credenciaisPorRegistro(registroId, 'WHATSAPP');
}

export function assinaturaValida(corpoBruto: Buffer, cabecalho: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !cabecalho?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoBruto).digest();
  let recebido: Buffer;
  try { recebido = Buffer.from(cabecalho.slice(7), 'hex'); } catch { return false; }
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export function desafioValido(query: Record<string, unknown>, verifyToken: string | undefined): string | null {
  const modo = query['hub.mode'];
  const token = query['hub.verify_token'];
  const desafio = query['hub.challenge'];
  if (modo !== 'subscribe' || typeof token !== 'string' || typeof desafio !== 'string' || !verifyToken) return null;
  const a = Buffer.from(token); const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? desafio.slice(0, 200) : null;
}

type Valor = {
  metadata?: { phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: { from?: string; id?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: unknown }[];
  statuses?: { id?: string; status?: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string }[] }[];
};

/** Processa um payload já autenticado. Devolve contagens (para o histórico). */
export async function processarWebhook(empresaId: string, phoneNumberId: string, payload: unknown) {
  const res = { recebidas: 0, duplicadas: 0, status: 0, ignorados: 0 };
  const entradas = (payload as { entry?: { changes?: { field?: string; value?: Valor }[] }[] })?.entry ?? [];
  for (const entrada of entradas) {
    for (const mudanca of entrada.changes ?? []) {
      const v = mudanca.value;
      if (!v || v.metadata?.phone_number_id !== phoneNumberId) { res.ignorados++; continue; }
      for (const m of v.messages ?? []) {
        if (!m.id || !m.from) continue;
        const nome = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const conteudo = m.text?.body ?? m.button?.text ?? `[${m.type ?? 'mensagem'}]`;
        const criado = await prisma.whatsappMensagem.createMany({
          data: [{ empresaId, direcao: 'RECEBIDA', telefone: m.from.replace(/\D/g, '').slice(0, 20), nomeContato: nome?.slice(0, 120) ?? null, tipo: (m.type ?? 'text').slice(0, 30), conteudo: conteudo.slice(0, 1000), waMessageId: m.id.slice(0, 200), status: 'RECEBIDA', origem: 'WEBHOOK' }],
          skipDuplicates: true,
        });
        if (criado.count) res.recebidas++; else res.duplicadas++;
      }
      for (const s of v.statuses ?? []) {
        const novo = s.status ? STATUS_META[s.status] : undefined;
        if (!s.id || !novo) continue;
        const erro = novo === 'FALHOU' ? (s.errors?.[0] ? `Erro ${s.errors[0].code ?? ''}: ${s.errors[0].title ?? s.errors[0].message ?? ''}`.slice(0, 300) : 'Falha na entrega informada pela Meta.') : null;
        // Status só avança (webhooks chegam fora de ordem, repetidos e até ao mesmo tempo).
        // A condição vai NO PRÓPRIO UPDATE (atômico no Postgres): ler e depois gravar deixava
        // "entregue" sobrescrever "lida" quando os dois avisos eram processados juntos.
        const anteriores = Object.keys(ORDEM_STATUS).filter((k) => k !== 'FALHOU' && ORDEM_STATUS[k] < ORDEM_STATUS[novo]);
        const atualizou = await prisma.whatsappMensagem.updateMany({
          where: { empresaId, waMessageId: s.id, direcao: 'ENVIADA', status: novo === 'FALHOU' ? { not: 'FALHOU' } : { in: anteriores } },
          data: { status: novo, ...(erro ? { erro } : {}) },
        });
        if (atualizou.count) { res.status++; continue; }
        const existe = await prisma.whatsappMensagem.count({ where: { empresaId, waMessageId: s.id, direcao: 'ENVIADA' } });
        if (existe) res.duplicadas++; else res.ignorados++;
      }
    }
  }
  return res;
}
