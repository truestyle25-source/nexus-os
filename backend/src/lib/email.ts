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

interface ResultadoEnvio {
  enviado: boolean;
  erro?: string;
}

async function enviarEmail(params: { para: string; assunto: string; html: string; texto: string }): Promise<ResultadoEnvio> {
  const apiKey = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_FROM || 'NEXUS OS <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY não configurada — e-mail para ${params.para} NÃO foi enviado. ` +
        'Configure RESEND_API_KEY e EMAIL_FROM no .env para habilitar o envio real.',
    );
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
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      console.error(`[email] falha ao enviar para ${params.para}: HTTP ${resposta.status} — ${corpo}`);
      return { enviado: false, erro: `HTTP ${resposta.status}` };
    }

    return { enviado: true };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error(`[email] erro de rede ao enviar para ${params.para}: ${mensagem}`);
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
