/**
 * E-mail pela conta da própria empresa (SMTP) e leitura da caixa de entrada (IMAP).
 *  - Envio: HTML e/ou texto, anexos (até 10 MB no total), Reply-To opcional. O histórico
 *    (EmailEnvio) guarda destinatários, assunto, status e o Message-ID — nunca corpo/anexo.
 *  - Recebimento: com "Receber e-mails" = Sim, lista os cabeçalhos (remetente, assunto,
 *    data) das mensagens mais recentes da INBOX. O conteúdo das mensagens não é baixado.
 *  - Os hosts passam de novo pela proteção SSRF a cada uso (o DNS pode ter mudado).
 */
import { prisma } from '../../../lib/prisma.js';
import { ErroDeNegocio } from '../../../lib/erros.js';
import { credenciaisInternas, registrarEvento } from './central.service.js';
import { opcoesImap, opcoesSmtp, validarDestinosEmail } from './adaptadores.js';

const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;
const LIMITE_ANEXOS = 10 * 1024 * 1024;

export interface EnvioEmail {
  para: string[];
  cc?: string[];
  assunto: string;
  html?: string;
  texto?: string;
  responderPara?: string;
  anexos?: { nome: string; base64: string; tipo?: string }[];
  origem?: string;
}

/** Valida e normaliza o pedido de envio (sem rede). Exportada para os testes. */
export function validarEnvio(e: EnvioEmail) {
  const para = [...new Set((e.para ?? []).map((x) => x.trim()).filter(Boolean))];
  const cc = [...new Set((e.cc ?? []).map((x) => x.trim()).filter(Boolean))];
  if (!para.length || para.length + cc.length > 50) throw new ErroDeNegocio('Informe de 1 a 50 destinatários.', 400);
  const invalido = [...para, ...cc, ...(e.responderPara ? [e.responderPara] : [])].find((x) => !EMAIL.test(x));
  if (invalido) throw new ErroDeNegocio(`E-mail inválido: ${invalido.slice(0, 80)}`, 400);
  const assunto = (e.assunto ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!assunto || assunto.length > 300) throw new ErroDeNegocio('Assunto vazio ou longo demais (máx. 300).', 400);
  if (!e.html?.trim() && !e.texto?.trim()) throw new ErroDeNegocio('Informe o conteúdo do e-mail.', 400);
  let total = 0;
  const anexos = (e.anexos ?? []).map((a) => {
    const conteudo = Buffer.from(a.base64 ?? '', 'base64');
    total += conteudo.length;
    const nome = (a.nome ?? '').replace(/[\\/\r\n"]/g, '_').trim().slice(0, 150);
    if (!nome || !conteudo.length) throw new ErroDeNegocio('Anexo sem nome ou vazio.', 400);
    return { filename: nome, content: conteudo, ...(a.tipo ? { contentType: a.tipo.slice(0, 100) } : {}) };
  });
  if (anexos.length > 10 || total > LIMITE_ANEXOS) throw new ErroDeNegocio('Anexos: no máximo 10 arquivos e 10 MB no total.', 400);
  return { para, cc, assunto, anexos };
}

async function contaEmail(empresaId: string) {
  const cred = await credenciaisInternas(empresaId, 'email-conta');
  if (!cred || cred.status !== 'CONECTADO') throw new ErroDeNegocio('A conta de e-mail não está conectada. Configure e teste a conexão na Central de Integrações.', 409);
  // Resolve e valida de novo a cada uso (o DNS pode ter mudado desde o teste); devolve os IPs.
  const destinos = await validarDestinosEmail(cred.config);
  if (destinos.erro) throw new ErroDeNegocio(destinos.erro.mensagem, 400);
  return { ...cred, destinos };
}

export async function enviarEmail(empresaId: string, usuarioId: string | null, e: EnvioEmail) {
  const { para, cc, assunto, anexos } = validarEnvio(e);
  const cred = await contaEmail(empresaId);
  const remetente = cred.config.nomeExibicao ? `"${cred.config.nomeExibicao.replace(/["\r\n]/g, '')}" <${cred.config.emailRemetente}>` : cred.config.emailRemetente;
  const { default: nodemailer } = await import('nodemailer');
  const transporte = nodemailer.createTransport(opcoesSmtp(cred.config, cred.segredos, cred.destinos.smtpIp));
  const inicio = Date.now();
  try {
    const info = await transporte.sendMail({ from: remetente, to: para, ...(cc.length ? { cc } : {}), ...(e.responderPara ? { replyTo: e.responderPara } : {}), subject: assunto, ...(e.html ? { html: e.html } : {}), ...(e.texto ? { text: e.texto } : {}), attachments: anexos });
    const reg = await prisma.emailEnvio.create({ data: { empresaId, para: [...para, ...cc].join(', ').slice(0, 2000), assunto, anexos: anexos.length, status: 'ENVIADO', messageId: info.messageId?.slice(0, 300) ?? null, origem: e.origem ?? 'CENTRAL', usuarioId } });
    return { id: reg.id, status: 'ENVIADO', messageId: info.messageId };
  } catch (err: any) {
    const erro = err?.code === 'EAUTH' ? 'Usuário ou senha recusados pelo servidor SMTP.' : err?.responseCode ? `Servidor recusou (${err.responseCode}).` : 'Falha de comunicação com o servidor SMTP.';
    const reg = await prisma.emailEnvio.create({ data: { empresaId, para: [...para, ...cc].join(', ').slice(0, 2000), assunto, anexos: anexos.length, status: 'FALHOU', erro, origem: e.origem ?? 'CENTRAL', usuarioId } });
    await registrarEvento({ empresaId, provedor: 'email-conta', operacao: 'SINCRONIZAR', ok: false, codigoErro: err?.code ?? 'FALHA', mensagem: `Envio de e-mail: ${erro}`, duracaoMs: Date.now() - inicio, usuarioId });
    return { id: reg.id, status: 'FALHOU', erro };
  } finally {
    transporte.close();
  }
}

export async function listarEnvios(empresaId: string, limite = 50) {
  return prisma.emailEnvio.findMany({ where: { empresaId }, orderBy: { createdAt: 'desc' }, take: Math.min(limite, 200), select: { id: true, para: true, assunto: true, anexos: true, status: true, erro: true, origem: true, createdAt: true } });
}

/** Cabeçalhos das mensagens mais recentes da caixa de entrada (somente leitura). */
export async function caixaDeEntrada(empresaId: string, limite = 20) {
  const cred = await contaEmail(empresaId);
  if (cred.config.receber !== 'SIM') throw new ErroDeNegocio('O recebimento (IMAP) não está habilitado nesta conta.', 409);
  const { ImapFlow } = await import('imapflow');
  if (!cred.destinos.imapIp) throw new ErroDeNegocio('Servidor IMAP não configurado.', 409);
  const cliente = new ImapFlow(opcoesImap(cred.config, cred.segredos, cred.destinos.imapIp));
  cliente.on('error', () => {});
  const itens: { uid: number; de: string | null; assunto: string | null; data: Date | null; lida: boolean }[] = [];
  try {
    await cliente.connect();
    const trava = await cliente.getMailboxLock('INBOX', { readOnly: true } as any);
    try {
      const total = (cliente.mailbox && typeof cliente.mailbox === 'object' ? cliente.mailbox.exists : 0) ?? 0;
      if (total > 0) {
        const inicio = Math.max(1, total - Math.min(limite, 50) + 1);
        for await (const m of cliente.fetch(`${inicio}:*`, { uid: true, envelope: true, flags: true })) {
          const de = m.envelope?.from?.[0];
          itens.push({ uid: m.uid, de: de ? (de.name ? `${de.name} <${de.address}>` : de.address ?? null) : null, assunto: m.envelope?.subject ?? null, data: m.envelope?.date ? new Date(m.envelope.date) : null, lida: Boolean(m.flags?.has('\\Seen')) });
        }
      }
    } finally { trava.release(); }
  } catch (err: any) {
    throw new ErroDeNegocio(err?.authenticationFailed ? 'IMAP: usuário ou senha recusados.' : 'IMAP: falha de comunicação com o servidor.', 502);
  } finally {
    await cliente.logout().catch(() => {});
  }
  return itens.reverse();
}
