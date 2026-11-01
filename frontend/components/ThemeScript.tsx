// NEXUS OS — script BLOQUEANTE de tema.
//
// Roda dentro de <head>, antes de o navegador pintar qualquer pixel, para
// que um usuário com tema claro nunca veja um "flash" escuro ao abrir o app.
// Por isso é uma <script dangerouslySetInnerHTML> e não um useEffect: um
// efeito React só roda depois da hidratação, tarde demais.
//
// O corpo é uma cópia mínima e autocontida de `lib/theme.ts` (que é
// TypeScript e não roda no navegador). Mantemos as duas em sincronia: se
// você mudar a forma de ler a preferência, mude aqui também.

import { CHAVE_APARENCIA, APARENCIA_PADRAO, COR_PRINCIPAL_POR_TEMA } from '@/lib/theme';
import { CHAVE_PREFS } from '@/lib/prefs';

const CODIGO = `
(function () {
  try {
    var padrao = ${JSON.stringify(APARENCIA_PADRAO)};
    var porTema = ${JSON.stringify(COR_PRINCIPAL_POR_TEMA)};
    var theme = 'escuro', densidade = 'confortavel', cor = padrao.corPrincipal;
    try {
      var bruto = window.localStorage.getItem(${JSON.stringify(CHAVE_APARENCIA)});
      if (bruto) {
        var ap = JSON.parse(bruto);
        if (ap && ap.theme === 'claro') theme = 'claro';
        if (ap && ap.densidade === 'compacta') densidade = 'compacta';
        if (ap && typeof ap.corPrincipal === 'string' && /^#[0-9A-Fa-f]{6}$/.test(ap.corPrincipal)) {
          cor = ap.corPrincipal;
        } else {
          cor = porTema[theme] || cor;
        }
      } else {
        cor = porTema[theme] || cor;
      }
    } catch (e) { /* storage indisponível: segue com o padrão */ }

    var raiz = document.documentElement;
    raiz.setAttribute('data-theme', theme);
    raiz.setAttribute('data-densidade', densidade);
    raiz.style.setProperty('--nx-accent', cor);
    raiz.style.colorScheme = theme === 'claro' ? 'light' : 'dark';

    // Idioma da interface: precisa estar no <html> ANTES da hidratação, senao
    // o React hidrata com o rotulo em portugues e so depois troca (flicker).
    try {
      var brutoPrefs = window.localStorage.getItem(${JSON.stringify(CHAVE_PREFS)});
      var idioma = 'pt-BR';
      if (brutoPrefs) {
        var ap = JSON.parse(brutoPrefs);
        if (ap && (ap.idioma === 'en-US' || ap.idioma === 'es-ES')) idioma = ap.idioma;
      }
      raiz.setAttribute('lang', idioma);
    } catch (e) { /* sem preferencia: mantem pt-BR */ }
  } catch (e) { /* nunca derruba a renderização por causa do tema */ }
})();
`.trim();

export default function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: CODIGO }} />;
}