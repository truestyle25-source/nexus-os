'use client';
/** Encontrar loja: clubes ativos e públicos; entrar liga a pessoa ao cadastro da loja pelo CPF. */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clubApi, escolherClube, type ClubeResumo } from '@/lib/club/api';
import { AppClube, Caixa, useSessaoClube } from '@/components/club/AppClube';
import { Aviso, BotaoSecundario } from '@/components/club/ui';

export default function LojasClube() {
  const router = useRouter();
  const { eu, erro } = useSessaoClube();
  const [busca, setBusca] = useState('');
  const [lojas, setLojas] = useState<Array<ClubeResumo & { participo: boolean }> | null>(null);
  const [msg, setMsg] = useState<{ tom: 'erro' | 'ok'; texto: string } | null>(null);
  const [entrando, setEntrando] = useState<string | null>(null);

  useEffect(() => {
    if (!eu) return;
    const t = setTimeout(() => { clubApi.lojas(busca.trim()).then(setLojas).catch((e) => setMsg({ tom: 'erro', texto: (e as Error).message })); }, 250);
    return () => clearTimeout(t);
  }, [eu, busca]);

  const entrar = async (id: string) => {
    setEntrando(id); setMsg(null);
    try {
      const r = await clubApi.entrar(id);
      escolherClube(id);
      if (r.status === 'PENDENTE_VINCULO') setMsg({ tom: 'ok', texto: 'Você entrou no clube. A loja vai confirmar o seu cadastro.' });
      router.push('/club/inicio');
    } catch (e) { setMsg({ tom: 'erro', texto: (e as Error).message }); }
    finally { setEntrando(null); }
  };

  return (
    <AppClube eu={eu} titulo="Encontrar loja" carregando={!eu && !erro}>
      {(erro || msg) && <Aviso tom={msg?.tom ?? 'erro'}>{erro || msg?.texto}</Aviso>}
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome da loja" aria-label="Buscar loja"
        className="w-full h-[46px] rounded-[14px] bg-[#12121F] border border-[#2A2A3E] px-4 text-[14px] text-white placeholder:text-[#4A4A6A] outline-none focus:border-[#7C3AED] mb-4" />
      {lojas == null && <p className="text-[13px] text-[#8B8BA7]">Carregando…</p>}
      {lojas?.length === 0 && <p className="text-[13px] text-[#8B8BA7]">Nenhuma loja encontrada. Algumas lojas só aceitam clientes convidados por elas.</p>}
      <div className="space-y-3">
        {lojas?.map((l) => (
          <Caixa key={l.id} className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[15px] truncate">{l.nome}</p>
              {l.beneficioPercentual ? <p className="text-[12px] text-[#A78BFA]">{l.beneficioPercentual.toLocaleString('pt-BR')}% de benefício para membros</p> : null}
            </div>
            {l.participo
              ? <span className="text-[12px] font-semibold text-emerald-300">Você participa</span>
              : <BotaoSecundario type="button" onClick={() => entrar(l.id)} disabled={entrando === l.id}>{entrando === l.id ? 'Entrando…' : 'Entrar no clube'}</BotaoSecundario>}
          </Caixa>
        ))}
      </div>
      <p className="mt-6 text-[12px] text-[#6B6B88]">Ao entrar, a loja passa a ver seu nome e contato no cadastro dela e as compras que você fizer lá. Ela não vê suas outras lojas.</p>
    </AppClube>
  );
}
