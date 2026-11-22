/**
 * Canais de envio do pedido de compra ao fornecedor: E-MAIL e WHATSAPP.
 *
 * ============================================================================
 * COMO CONFIGURAR (variáveis de ambiente do BACKEND, no Render — nunca na Vercel)
 * ============================================================================
 *
 * E-MAIL (Resend — mesma integração da recuperação de senha, lib/email.ts)
 *   RESEND_API_KEY      chave da API (https://resend.com → API Keys). Obrigatória.
 *   EMAIL_FROM          remetente, ex.: "Compras NEXUS <compras@suaempresa.com.br>".
 *                       O domínio precisa estar verificado na Resend; com o padrão
 *                       "onboarding@resend.dev" a Resend só entrega para o e-mail do
 *                       dono da conta (modo de teste).
 *   COMPRAS_EMAIL_RESPOSTA  (opcional) e-mail que recebe as respostas do fornecedor.
 *   Sem RESEND_API_KEY: o envio NÃO é simulado — fica registrado como NAO_CONFIGURADO.
 *
 * WHATSAPP (WhatsApp Business Cloud API — API oficial da Meta)
 *   WHATSAPP_TOKEN            token permanente de um System User (Meta Business →
 *                             Usuários do sistema), com whatsapp_business_messaging.
 *   WHATSAPP_PHONE_NUMBER_ID  id do número remetente (WhatsApp Manager → API Setup).
 *   WHATSAPP_TEMPLATE         (recomendado) nome de um template APROVADO pela Meta com
 *                             1 parâmetro no corpo (o texto do pedido) e cabeçalho de
 *                             DOCUMENTO (o PDF). Fora da janela de 24 h de conversa a
 *                             Meta só entrega mensagens de template.
 *   WHATSAPP_TEMPLATE_IDIOMA  (opcional) padrão "pt_BR".
 *   WHATSAPP_API_VERSION      (opcional) padrão "v21.0".
 *   Sem WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID: não há envio automático. A tela oferece
 *   "abrir conversa" (link wa.me com a mensagem pronta) e isso é registrado como
 *   CONVERSA_ABERTA — que NÃO significa mensagem entregue.
 *
 * Para trocar de provedor (ex.: Z-API, Twilio, SendGrid), troque só a implementação de
 * `enviarPorEmail` / `enviarPorWhatsApp` abaixo; rotas, telas e registros não mudam.
 * ============================================================================
 */
import { enviarEmail } from '../../lib/email.js';
import { logDe } from '../../lib/logger.js';

const log = logDe('compras-envio');

export type StatusEnvio = 'ENVIADO' | 'FALHOU' | 'NAO_CONFIGURADO' | 'CONVERSA_ABERTA';
export interface ResultadoCanal { status: StatusEnvio; provedor: string; provedorId?: string; erro?: string }

/** Situação de cada canal (a tela mostra o que está ativo e o que falta configurar). */
export function canaisConfigurados() {
  return {
    email: { configurado: !!process.env.RESEND_API_KEY, provedor: 'Resend', remetente: process.env.EMAIL_FROM || null },
    whatsapp: {
      configurado: !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      provedor: 'WhatsApp Business Cloud API (Meta)',
      template: process.env.WHATSAPP_TEMPLATE || null,
    },
  };
}

/** E-mail com o PDF do pedido em anexo. */
export async function enviarPorEmail(p: { para: string; assunto: string; html: string; texto: string; pdf: { nome: string; base64: string } }): Promise<ResultadoCanal> {
  if (!process.env.RESEND_API_KEY) return { status: 'NAO_CONFIGURADO', provedor: 'resend', erro: 'RESEND_API_KEY não configurada no servidor.' };
  const r = await enviarEmail({ para: p.para, assunto: p.assunto, html: p.html, texto: p.texto, anexos: [p.pdf], responderPara: process.env.COMPRAS_EMAIL_RESPOSTA || undefined });
  return r.enviado ? { status: 'ENVIADO', provedor: 'resend', provedorId: r.id } : { status: 'FALHOU', provedor: 'resend', erro: r.erro };
}

/** Telefone no formato internacional só com dígitos (Brasil: 55 + DDD + número). */
export function normalizarTelefone(tel: string): string | null {
  let d = tel.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 15 ? d : null;
}

/** Link wa.me com a mensagem pronta (envio manual pelo usuário). */
export function linkConversaWhatsApp(telefone: string, mensagem: string): string | null {
  const numero = normalizarTelefone(telefone);
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : null;
}

/**
 * Envio automático pela API oficial. O PDF vai como documento: é enviado antes à Meta
 * (endpoint /media) e referenciado pelo id. Sem template configurado, manda texto + documento
 * (só funciona dentro da janela de 24 h de conversa aberta pelo fornecedor).
 */
export async function enviarPorWhatsApp(p: { telefone: string; mensagem: string; pdf: { nome: string; base64: string } }): Promise<ResultadoCanal> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { status: 'NAO_CONFIGURADO', provedor: 'whatsapp-cloud', erro: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID não configurados no servidor.' };
  const para = normalizarTelefone(p.telefone);
  if (!para) return { status: 'FALHOU', provedor: 'whatsapp-cloud', erro: 'Telefone do fornecedor inválido para WhatsApp.' };
  const base = `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}/${phoneId}`;
  try {
    // 1) Sobe o PDF e obtém o media id.
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([Buffer.from(p.pdf.base64, 'base64')], { type: 'application/pdf' }), p.pdf.nome);
    const up = await fetch(`${base}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(20_000) });
    const upJson = (await up.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!up.ok || !upJson.id) return { status: 'FALHOU', provedor: 'whatsapp-cloud', erro: `Upload do PDF: ${upJson.error?.message ?? `HTTP ${up.status}`}` };

    // 2) Mensagem: template aprovado (recomendado) ou documento com legenda.
    const template = process.env.WHATSAPP_TEMPLATE;
    const corpo = template
      ? {
          messaging_product: 'whatsapp', to: para, type: 'template',
          template: {
            name: template, language: { code: process.env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR' },
            components: [
              { type: 'header', parameters: [{ type: 'document', document: { id: upJson.id, filename: p.pdf.nome } }] },
              { type: 'body', parameters: [{ type: 'text', text: p.mensagem.slice(0, 1000) }] },
            ],
          },
        }
      : { messaging_product: 'whatsapp', to: para, type: 'document', document: { id: upJson.id, filename: p.pdf.nome, caption: p.mensagem.slice(0, 1000) } };
    const r = await fetch(`${base}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20_000) });
    const j = (await r.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    if (!r.ok) {
      log.error({ status: r.status, erro: j.error?.message, evento: 'integracao_falhou', integracao: 'whatsapp' }, 'falha ao enviar pedido por WhatsApp');
      return { status: 'FALHOU', provedor: 'whatsapp-cloud', erro: j.error?.message ?? `HTTP ${r.status}` };
    }
    // "Aceito pela Meta" — a confirmação de entrega/leitura chega depois por webhook (não implementado).
    return { status: 'ENVIADO', provedor: 'whatsapp-cloud', provedorId: j.messages?.[0]?.id };
  } catch (e) {
    return { status: 'FALHOU', provedor: 'whatsapp-cloud', erro: e instanceof Error ? e.message : String(e) };
  }
}
