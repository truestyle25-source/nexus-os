import { redirect } from 'next/navigation';

/**
 * Rede de segurança: se o navegador tentar acessar /login/auth/* (URL digitada
 * errada ou atalho antigo), devolve o usuário para a tela de login real.
 */
export default function LoginAuthCatchAll() {
  redirect('/login');
}
