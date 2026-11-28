/**
 * E-mails do NEXUS CLUB (mesmo envio real de lib/email.ts). O token bruto só existe aqui,
 * a caminho do e-mail: no banco fica o hash. Links apontam para a primeira URL de FRONTEND_URLS.
 */
import { enviarEmail, type ResultadoEnvio } from '../../lib/email.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const baseFront = () => (process.env.FRONTEND_URLS || '').split(',')[0]?.trim() || 'http://localhost:3000';

export function enviarEmailVerificacaoClube(p: { para: string; nome: string; tokenBruto: string }): Promise<ResultadoEnvio> {
  const link = `${baseFront()}/club/verificar-email?token=${encodeURIComponent(p.tokenBruto)}`;
  return enviarEmail({
    para: p.para,
    assunto: 'Confirme seu e-mail — NEXUS CLUB',
    texto: `Olá, ${p.nome}.\n\nPara ativar sua conta no NEXUS CLUB, confirme seu e-mail (link válido por 24 horas):\n${link}\n\nSe não foi você, ignore este e-mail.`,
    html: `<p>Olá, ${esc(p.nome)}.</p><p>Para ativar sua conta no <strong>NEXUS CLUB</strong>, <a href="${link}">confirme seu e-mail</a> (link válido por 24 horas).</p><p>Se não foi você, ignore este e-mail.</p>`,
  });
}

export function enviarEmailRedefinicaoClube(p: { para: string; nome: string; tokenBruto: string }): Promise<ResultadoEnvio> {
  const link = `${baseFront()}/club/redefinir-senha?token=${encodeURIComponent(p.tokenBruto)}`;
  return enviarEmail({
    para: p.para,
    assunto: 'Redefinir senha — NEXUS CLUB',
    texto: `Olá, ${p.nome}.\n\nRecebemos um pedido para redefinir a senha da sua conta NEXUS CLUB (link válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html: `<p>Olá, ${esc(p.nome)}.</p><p>Recebemos um pedido para redefinir a senha da sua conta <strong>NEXUS CLUB</strong>. <a href="${link}">Criar nova senha</a> (link válido por 1 hora).</p><p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
  });
}

/** Alguém tentou criar conta com o e-mail ou CPF de quem já tem conta: avisa o dono, sem dizer a quem tentou. */
export function enviarEmailTentativaCadastroClube(p: { para: string; nome: string }): Promise<ResultadoEnvio> {
  const link = `${baseFront()}/login`;
  return enviarEmail({
    para: p.para,
    assunto: 'Tentativa de cadastro com seus dados — NEXUS CLUB',
    texto: `Olá, ${p.nome}.\n\nAlguém tentou criar uma conta no NEXUS CLUB com o seu e-mail ou CPF. Você já tem conta: entre em ${link} (aba "Sou cliente NEXUS") ou use "Esqueci minha senha".\n\nSe não foi você, nenhuma conta nova foi criada.`,
    html: `<p>Olá, ${esc(p.nome)}.</p><p>Alguém tentou criar uma conta no <strong>NEXUS CLUB</strong> com o seu e-mail ou CPF. Você já tem conta: <a href="${link}">entre</a> (aba "Sou cliente NEXUS") ou use "Esqueci minha senha".</p><p>Se não foi você, nenhuma conta nova foi criada.</p>`,
  });
}
