/**
 * Envio de e-mail transacional real (Seção 5 / DEBITO-TECNICO item 4).
 *
 * Usa a API HTTP da Resend (https://resend.com) via `fetch` nativo do Node
 * 18+, sem dependência nova no package.json. Se preferir outro provedor
 * (SendGrid, Postmark, SES), troque só a implementação de `enviarEmail`
 * abaixo — o resto do código (rota de recuperação de senha) não muda.
 *
 * Comportamento deliberado:
 * - Sem RESEND_API_KEY configurada: NÃO finge sucesso. Loga um aviso claro
 *   no servidor e retorna `{ enviado: false }`. A rota que chama isso
 *   continua respondendo a mesma mensagem genérica ao usuário (para não
 *   permitir enumeração de contas), mas quem opera o sistema vê no log que
 *   o e-mail não saiu de verdade.
 * - Falha na chamada HTTP: loga o erro com detalhes e retorna
 *   `{ enviado: false, erro }`. Nunca lança exceção para não quebrar o
 *   fluxo de recuperação de senha (a resposta ao usuário já é genérica).
 */

import { logDe } from './logger.js';

const log = logDe('email');

/** E-mail mascarado para log (LGPD): mantém 2 letras e o domínio. */
export function mascararEmail(email: string): string {
  const [usuario = '', dominio = ''] = String(email).split('@');
  return `${usuario.slice(0, 2)}***@${dominio}`;
}

export interface ResultadoEnvio {
  enviado: boolean;
  erro?: string;
  /** Id da mensagem no provedor (Resend), quando aceita. */
  id?: string;
}

/** Anexo (conteúdo em base64), no formato aceito pela API da Resend. */
export interface AnexoEmail { nome: string; base64: string }

/** Exportado para outros módulos (ex.: envio do pedido de compra ao fornecedor). */
export async function enviarEmail(params: { para: string; assunto: string; html: string; texto: string; anexos?: AnexoEmail[]; responderPara?: string }): Promise<ResultadoEnvio> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_FROM || 'NEXUS OS <onboarding@resend.dev>';

  if (!apiKey) {
    log.warn({ para: mascararEmail(params.para), evento: 'email_nao_enviado' }, 'RESEND_API_KEY não configurada: e-mail NÃO foi enviado');
    return { enviado: false, erro: 'RESEND_API_KEY não configurada' };
  }

  try {
    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: remetente,
        to: [params.para],
        subject: params.assunto,
        html: params.html,
        text: params.texto,
        ...(params.anexos?.length ? { attachments: params.anexos.map((a) => ({ filename: a.nome, content: a.base64 })) } : {}),
        ...(params.responderPara ? { reply_to: params.responderPara } : {}),
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      log.error({ para: mascararEmail(params.para), status: resposta.status, corpo: corpo.slice(0, 500), evento: 'integracao_falhou', integracao: 'resend' }, 'falha ao enviar e-mail');
      return { enviado: false, erro: `HTTP ${resposta.status}` };
    }

    const corpo = (await resposta.json().catch(() => ({}))) as { id?: string };
    return { enviado: true, id: corpo.id };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    log.error({ para: mascararEmail(params.para), mensagem, evento: 'integracao_falhou', integracao: 'resend' }, 'erro de rede ao enviar e-mail');
    return { enviado: false, erro: mensagem };
  }
}

/**
 * E-mail de recuperação de senha. O link aponta para
 * `FRONTEND_URLS` (primeira URL da lista) + `/redefinir-senha?token=...`.
 * O front precisa ter essa rota lendo o token da query string e chamando
 * `POST /auth/redefinir-senha`.
 */
export async function enviarEmailRecuperacaoSenha(params: { para: string; nome: string; tokenBruto: string }): Promise<ResultadoEnvio> {
  const frontendBase = (process.env.FRONTEND_URLS || '').split(',')[0]?.trim() || 'http://localhost:3000';
  const link = `${frontendBase}/redefinir-senha?token=${params.tokenBruto}`;

  return enviarEmail({
    para: params.para,
    assunto: 'Recuperação de senha — NEXUS OS',
    texto: `Olá, ${params.nome}.\n\nRecebemos uma solicitação para redefinir sua senha no NEXUS OS.\nAcesse o link abaixo para criar uma nova senha (válido por 1 hora):\n${link}\n\nSe você não solicitou isso, ignore este e-mail.`,
    html: `
      <p>Olá, ${params.nome}.</p>
      <p>Recebemos uma solicitação para redefinir sua senha no <strong>NEXUS OS</strong>.</p>
      <p><a href="${link}">Clique aqui para criar uma nova senha</a> (link válido por 1 hora).</p>
      <p>Se você não solicitou isso, pode ignorar este e-mail com segurança.</p>
    `,
  });
}
