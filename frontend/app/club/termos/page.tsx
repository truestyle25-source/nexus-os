'use client';
/**
 * Novo aceite: os termos mudaram depois do cadastro (ex.: a minuta provisória deu lugar à
 * versão final). Até aceitar, o servidor só libera ver os próprios dados, aceitar ou sair.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clubApi, ROTULO_TERMO, type Termo } from '@/lib/club/api';
import { useSessaoClube } from '@/components/club/sessao';
import { Aviso, BotaoPrimario, BotaoSecundario, Cartao, PaginaClube, TextoTermo, Titulo } from '@/components/club/ui';

export default function TermosPendentesClube() {
  const router = useRouter();
  const { eu, erro: erroSessao, sair } = useSessaoClube({ permitirTermosPendentes: true });
  const [textos, setTextos] = useState<Record<string, Termo>>({});
  const [aceites, setAceites] = useState<Record<string, boolean>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!eu) return;
    if (!eu.termosPendentes.length) { router.replace('/club/inicio'); return; }
    clubApi.termosVigentes().then((r) => setTextos(Object.fromEntries(r.termos.map((t) => [t.id, t])))).catch((e) => setErro((e as Error).message));
  }, [eu, router]);

  const pendentes = eu?.termosPendentes ?? [];
  const tudo = pendentes.length > 0 && pendentes.every((t) => aceites[t.id]);

  const aceitar = async () => {
    setCarregando(true); setErro('');
    try { await clubApi.aceitarTermos(pendentes.map((t) => t.id)); router.replace('/club/inicio'); }
    catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  };

  return (
    <PaginaClube largura={560}>
      <Cartao>
        <Titulo sub="Para continuar usando o NEXUS CLUB, leia e aceite a nova versão.">Os termos mudaram</Titulo>
        {(erro || erroSessao) && <Aviso tom="erro">{erro || erroSessao}</Aviso>}
        {!eu && !erroSessao && <p className="text-[#8B8BA7] text-[14px]">Carregando…</p>}
        <div className="space-y-4 mb-6">
          {pendentes.map((t) => (
            <div key={t.id}>
              <p className="text-white font-semibold text-[15px] mb-2">{ROTULO_TERMO[t.tipo] ?? t.tipo} — versão {t.versao}</p>
              {textos[t.id] ? <TextoTermo texto={textos[t.id].texto} altura={220} /> : <p className="text-[#8B8BA7] text-[13px]">Carregando texto…</p>}
              <label className="flex items-start gap-3 mt-3 cursor-pointer">
                <input type="checkbox" checked={!!aceites[t.id]} onChange={(e) => setAceites((a) => ({ ...a, [t.id]: e.target.checked }))} className="mt-1 h-4 w-4 accent-[#7C3AED]" />
                <span className="text-[14px] text-[#C9C9E0]">Li e aceito os {ROTULO_TERMO[t.tipo] ?? t.tipo} (versão {t.versao}).</span>
              </label>
            </div>
          ))}
        </div>
        <BotaoPrimario onClick={aceitar} carregando={carregando} disabled={!tudo}>Aceitar e continuar</BotaoPrimario>
        <div className="mt-4 text-center"><BotaoSecundario type="button" onClick={sair}>Sair da conta</BotaoSecundario></div>
      </Cartao>
    </PaginaClube>
  );
}
