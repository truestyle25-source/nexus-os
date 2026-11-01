import { redirect } from 'next/navigation';

/**
 * Rede de segurança: se o navegador tentar acessar /auth/* diretamente (é um
 * caminho da API, não de página), devolve o usuário para a tela de login.
 */
export default function AuthCatchAll() {
  redirect('/login');
}
