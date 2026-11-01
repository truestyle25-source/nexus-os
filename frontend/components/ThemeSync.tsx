'use client';

import { useEffect } from 'react';
import {
  aplicarAparencia,
  lerAparencia,
  EVENTO_APARENCIA,
  type Aparencia,
} from '@/lib/theme';
import { EVENTO_PREFS } from '@/lib/prefs';
import { getIdioma } from '@/lib/i18n';

/**
 * Mantém tema e idioma do documento em dia depois da primeira pintura.
 *
 * O `ThemeScript` já aplicou ambos antes do paint (evitando flash); este
 * componente cuida do que vem DEPOIS:
 *
 * 1. quando a aba Configurações salva uma escolha nova, no mesmo instante
 *    (evento `nexus:aparencia`);
 * 2. quando outra aba do navegador salva (evento `storage`, que não
 *    dispara na aba que escreveu);
 * 3. quando a tela é restaurada do cache do navegador (bfcache) ou volta
 *    de segundo plano, aplicando de novo o que estiver salvo agora.
 */
export default function ThemeSync() {
  useEffect(() => {
    /**
     * Aplica aparência e o atributo `lang` do <html>.
     *
     * Não invalidamos o cache de `lib/prefs` aqui de propósito: quem grava
     * (`gravarPrefs`) já atualiza o cache, e o `lib/prefs` escuta o evento
     * `storage` sozinho para as outras abas. Invalidar aqui só forçaria uma
     * leitura do localStorage a cada `visibilitychange`.
     */
    const reaplicar = () => {
      aplicarAparencia(lerAparencia());
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('lang', getIdioma());
      }
    };

    const aoSalvar = (evento: Event) => {
      const detalhe = (evento as CustomEvent<Aparencia>).detail;
      // Usa o detalhe quando veio íntegro; senão relê do storage.
      aplicarAparencia(detalhe && detalhe.theme ? detalhe : lerAparencia());
    };

    // A preferência acabou de ser gravada NESTA aba: o cache já está certo,
    // basta repintar o atributo `lang` (e o `t()` já lê o valor novo).
    // IMPORTANTE: não chamar `gravarPrefs` aqui — realimentaria o evento.
    const aoSalvarPrefs = () => reaplicar();

    const aoMudarStorage = (evento: StorageEvent) => {
      // Outra aba salvou. O `lib/prefs` já anulou o cache no próprio listener
      // de `storage`; aqui só repintamos o documento.
      if (evento.key === null) reaplicar();
      else if (evento.key === 'nexus_aparencia' || evento.key === 'nexus_prefs') reaplicar();
    };

    const aoVoltar = () => reaplicar();

    reaplicar();
    window.addEventListener(EVENTO_APARENCIA, aoSalvar as EventListener);
    window.addEventListener(EVENTO_PREFS, aoSalvarPrefs);
    window.addEventListener('storage', aoMudarStorage);
    window.addEventListener('pageshow', aoVoltar);
    document.addEventListener('visibilitychange', aoVoltar);

    return () => {
      window.removeEventListener(EVENTO_APARENCIA, aoSalvar as EventListener);
      window.removeEventListener(EVENTO_PREFS, aoSalvarPrefs);
      window.removeEventListener('storage', aoMudarStorage);
      window.removeEventListener('pageshow', aoVoltar);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, []);

  return null;
}