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
  const texto = String(bruto ?? '').trim();
  let d = texto.replace(/\D/g, '');
  // Número com "+" ou "00" na frente já traz o código do país: nunca prefixa 55.
  // Sem código do país (10 ou 11 dígitos: DDD + número) assume Brasil.
  if (texto.startsWith('+')) return d.length >= 8 && d.length <= 15 ? d : null;
  if (texto.startsWith('00')) { d = d.slice(2); return d.length >= 8 && d.length <= 15 ? d : null; }
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

export interface EnvioWhatsApp {
  para: string;
  tipo: 'TEXTO' | 'MODELO';
  texto?: string;
  modelo?: { nome: string; idioma: string; parametros: string[] };
  origem?: string;
  /** O usuário confirma que o contato autorizou receber mensagens (LGPD / política da Meta). */
  consentimento?: boolean;
}

export async function enviarWhatsApp(empresaId: string, usuarioId: string | null, envio: EnvioWhatsApp) {
  const cred = await credenciaisInternas(empresaId, 'whatsapp');
  if (!cred || cred.status !== 'CONECTADO') throw new ErroDeNegocio('O WhatsApp Business não está conectado. Configure e teste a conexão na Central de Integrações.', 409);
  const para = telefoneWhatsApp(envio.para);
  const base = para ? await baseDeConsentimento(empresaId, para, Boolean(envio.consentimento)) : null;
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
  const msg = await prisma.whatsappMensagem.create({ data: { empresaId, direcao: 'ENVIADA', telefone: para, tipo: envio.tipo === 'TEXTO' ? 'text' : 'template', conteudo: resumo.slice(0, 1000), status: 'ENVIANDO', origem: envio.origem ?? 'CENTRAL', consentimento: base, usuarioId } });
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
          data: [{ empresaId, direcao: 'RECEBIDA', telefone: m.from.replace(/\D/g, '').slice(0, 20), nomeContato: nome?.slice(0, 120) ?? null, tipo: (m.type ?? 'text').slice(0, 30), conteudo: conteudo.slice(0, 1000), waMessageId: m.id.slice(0, 200), status: 'RECEBIDA', origem: 'WEBHOOK', consentimento: 'RECEBIDA' }],
          skipDuplicates: true,
        });
        if (criado.count) res.recebidas++; else res.duplicadas++;
        if (criado.count) await aplicarPalavraChave(empresaId, m.from, m.text?.body ?? m.button?.text ?? '');
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

/**
 * Documento (PDF) pela conta da empresa — usado por módulos como Compras.
 * 1) POST /<PHONE_NUMBER_ID>/media (multipart) → id da mídia;
 * 2) mensagem: modelo aprovado com cabeçalho de DOCUMENTO e 1 parâmetro no corpo, quando
 *    configurado em "Modelo para documentos" (entrega fora da janela de 24 h); senão
 *    documento com legenda (só dentro da janela de 24 h).
 * Registra em WhatsappMensagem (origem = módulo) para o histórico e o status de entrega.
 */
export async function enviarDocumentoWhatsApp(empresaId: string, usuarioId: string | null, p: { para: string; legenda: string; pdf: { nome: string; base64: string }; origem: string }) {
  const cred = await credenciaisInternas(empresaId, 'whatsapp');
  if (!cred || cred.status !== 'CONECTADO') return { status: 'NAO_CONECTADO' as const };
  const para = telefoneWhatsApp(p.para);
  if (para && (await descadastrado(empresaId, para))) return { status: 'FALHOU' as const, erro: 'O contato pediu para não receber mensagens por WhatsApp (descadastro).' };
  if (!para) return { status: 'FALHOU' as const, erro: 'Telefone inválido para WhatsApp.' };
  const base = `https://graph.facebook.com/${versaoGraph(cred.config)}/${cred.config.phoneNumberId}`;
  const auth = { Authorization: `Bearer ${cred.segredos.accessToken}` };
  const modelo = /^[a-z0-9_]{1,512}$/.test(cred.config.modeloDocumento ?? '') ? cred.config.modeloDocumento : null;
  const msg = await prisma.whatsappMensagem.create({ data: { empresaId, direcao: 'ENVIADA', telefone: para, tipo: modelo ? 'template' : 'document', conteudo: `${p.pdf.nome} — ${p.legenda}`.slice(0, 1000), status: 'ENVIANDO', origem: p.origem, consentimento: 'FORNECEDOR', usuarioId } });
  const falhar = async (erro: string) => {
    await prisma.whatsappMensagem.update({ where: { id: msg.id }, data: { status: 'FALHOU', erro } });
    return { status: 'FALHOU' as const, erro, mensagemId: msg.id };
  };
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([Buffer.from(p.pdf.base64, 'base64')], { type: 'application/pdf' }), p.pdf.nome);
    const up = await fetch(`${base}/media`, { method: 'POST', headers: auth, body: form, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!up.ok) { const e = await lerErroGraph(up); return falhar(`Upload do PDF recusado pela Meta${e.code ? ` (erro ${e.code})` : ''}.`); }
    const mediaId = ((await up.json().catch(() => ({}))) as { id?: string }).id;
    if (!mediaId) return falhar('A Meta não devolveu o id da mídia.');
    const corpo = modelo
      ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'template', template: { name: modelo, language: { code: cred.config.idiomaModelo || 'pt_BR' }, components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename: p.pdf.nome } }] },
          { type: 'body', parameters: [{ type: 'text', text: p.legenda.slice(0, 1000) }] },
        ] } }
      : { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'document', document: { id: mediaId, filename: p.pdf.nome, caption: p.legenda.slice(0, 1000) } };
    const r = await fetch(`${base}/messages`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      const e = await lerErroGraph(r);
      return falhar(e.code === 131047 ? 'Fora da janela de 24 h: configure um modelo aprovado para documentos na Central de Integrações.' : `Recusado pela Meta${e.code ? ` (erro ${e.code})` : ''}: ${(e.message ?? `HTTP ${r.status}`).slice(0, 200)}`);
    }
    const wamid = ((await r.json().catch(() => ({}))) as { messages?: { id: string }[] }).messages?.[0]?.id ?? null;
    await prisma.whatsappMensagem.update({ where: { id: msg.id }, data: { status: 'ENVIADA', waMessageId: wamid } });
    return { status: 'ENVIADA' as const, waMessageId: wamid, mensagemId: msg.id };
  } catch {
    return falhar('Sem comunicação com a Meta (timeout ou rede).');
  }
}

// ------------------------------- LGPD ---------------------------------------
// Política: só se escreve para quem autorizou. O contato que já escreveu para a empresa
// (mensagem RECEBIDA) conta como iniciador; fora disso, o usuário precisa confirmar a
// autorização (fica gravada na mensagem). Quem respondeu SAIR/PARAR/STOP não recebe nada
// até responder VOLTAR. Fornecedores (Compras) são comunicação comercial B2B.
export const PALAVRAS_SAIR = ['sair', 'parar', 'stop', 'cancelar', 'descadastrar'];
export const PALAVRAS_VOLTAR = ['voltar', 'start', 'reativar'];

export async function descadastrado(empresaId: string, telefone: string): Promise<boolean> {
  return (await prisma.whatsappDescadastro.count({ where: { empresaId, telefone } })) > 0;
}

async function baseDeConsentimento(empresaId: string, telefone: string, declarado: boolean): Promise<string> {
  if (await descadastrado(empresaId, telefone)) throw new ErroDeNegocio('O contato pediu para não receber mensagens por WhatsApp (respondeu SAIR). Nada foi enviado.', 409);
  const iniciou = await prisma.whatsappMensagem.count({ where: { empresaId, telefone, direcao: 'RECEBIDA' } });
  if (iniciou) return 'CLIENTE_INICIOU';
  if (declarado) return 'DECLARADO';
  throw new ErroDeNegocio('Confirme que o contato autorizou receber mensagens da empresa pelo WhatsApp.', 409);
}

export async function aplicarPalavraChave(empresaId: string, telefoneBruto: string, texto: string) {
  const telefone = telefoneBruto.replace(/\D/g, '').slice(0, 20);
  const palavra = texto.trim().toLowerCase();
  if (PALAVRAS_SAIR.includes(palavra)) {
    await prisma.whatsappDescadastro.upsert({ where: { empresaId_telefone: { empresaId, telefone } }, create: { empresaId, telefone, origem: 'PALAVRA_CHAVE' }, update: {} });
  } else if (PALAVRAS_VOLTAR.includes(palavra)) {
    await prisma.whatsappDescadastro.deleteMany({ where: { empresaId, telefone } });
  }
}

export async function listarDescadastros(empresaId: string) {
  return prisma.whatsappDescadastro.findMany({ where: { empresaId }, orderBy: { createdAt: 'desc' }, take: 200, select: { telefone: true, origem: true, createdAt: true } });
}

/** Descadastro manual (ex.: o cliente pediu por telefone) ou reativação. */
export async function definirDescadastro(empresaId: string, telefoneBruto: string, descadastrar: boolean) {
  const telefone = telefoneWhatsApp(telefoneBruto);
  if (!telefone) throw new ErroDeNegocio('Telefone inválido.', 400);
  if (descadastrar) await prisma.whatsappDescadastro.upsert({ where: { empresaId_telefone: { empresaId, telefone } }, create: { empresaId, telefone, origem: 'MANUAL' }, update: {} });
  else await prisma.whatsappDescadastro.deleteMany({ where: { empresaId, telefone } });
  return { telefone, descadastrado: descadastrar };
}
