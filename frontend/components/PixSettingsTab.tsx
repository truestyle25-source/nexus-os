'use client';

import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { Panel, SectionTitle } from '@/components/ui';

type TipoChave = 'CPF' | 'CNPJ' | 'PHONE' | 'EMAIL' | 'RANDOM';

interface PixCfg {
  enabled: boolean;
  providerConfigured: boolean;
  keyType: TipoChave;
  pixKey: string;
  pixKeyMasked: string;
  merchantName: string;
  merchantCity: string;
  document: string;
}

const TIPOS: Array<{ v: TipoChave; l: string }> = [
  { v: 'CPF', l: 'CPF' },
  { v: 'CNPJ', l: 'CNPJ' },
  { v: 'PHONE', l: 'Celular' },
  { v: 'EMAIL', l: 'E-mail' },
  { v: 'RANDOM', l: 'Aleatória' },
];

export default function PixSettingsTab({
  aoCarregar,
}: {
  /** Recebe a configuração real carregada do servidor (após ler e após salvar). */
  aoCarregar?: (resumo: PixCfg) => void;
} = {}) {
  const [cfg, setCfg] = useState<PixCfg>({
    enabled: false, providerConfigured: false, keyType: 'RANDOM', pixKey: '', pixKeyMasked: '',
    merchantName: '', merchantCity: '', document: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // ---- POR QUE ESTE ARQUIVO USOU UM REF ----
  // A primeira versão recebia `aoCarregar` e o usava direto no useEffect.
  // O pai passa uma arrow inline (`aoCarregar={(c) => setPix(c)}`), que é uma
  // função NOVA a cada render. Isso fazia o useEffect re-executar a cada tecla
  // digitada, o `api.get` responder de novo e o `setCfg` sobrescrever o que o
  // usuário tinha digitado — daí "o campo engole a primeira letra e trava".
  // Guardar o callback num ref e buscar a config só na montagem resolve sem
  // depender de identidade de função.
  const callbackRef = useRef(aoCarregar);
  callbackRef.current = aoCarregar;

  // Carrega a configuração real UMA vez. Também protege contra resposta
  // fora de ordem e evita setState depois do unmount.
  useEffect(() => {
    let vivo = true;
    api
      .get<PixCfg>('/api/v1/settings/pix')
      .then(({ data }) => {
        if (!vivo) return;
        const config: PixCfg = { ...data, pixKey: '' };
        setCfg(config);
        callbackRef.current?.({ ...config, pixKey: '' });
      })
      .catch((e: any) => {
        if (vivo) setErro(e?.message || 'Não foi possível carregar o PIX.');
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  async function salvar() {
    setErro(null);
    setOk(null);
    if (!cfg.pixKey.trim()) {
      setErro('Digite a chave PIX para salvar.');
      return;
    }
    if (cfg.merchantName.trim().length === 0 || cfg.merchantName.trim().length > 25) {
      setErro('Nome do recebedor: 1 a 25 caracteres.');
      return;
    }
    if (cfg.merchantCity.trim().length === 0 || cfg.merchantCity.trim().length > 15) {
      setErro('Cidade: 1 a 15 caracteres.');
      return;
    }
    setSaving(true);
    try {
      await api.put<{ ok: boolean }>('/api/v1/settings/pix', {
        enabled: cfg.enabled,
        keyType: cfg.keyType,
        pixKey: cfg.pixKey.trim(),
        merchantName: cfg.merchantName.trim(),
        merchantCity: cfg.merchantCity.trim(),
        document: cfg.document.trim() || undefined,
      });
      setOk(cfg.providerConfigured
        ? 'Configuração PIX salva.'
        : 'Chave PIX salva. Cobrança e confirmação seguem indisponíveis até configurar um provider oficial.');
      // Relê o registro para refletir (e mostrar) o que ficou gravado.
      const { data } = await api.get<PixCfg>('/api/v1/settings/pix');
      const config: PixCfg = { ...data, pixKey: '' };
      setCfg(config);
      callbackRef.current?.({ ...config, pixKey: '' });
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível salvar o PIX.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Panel><p className="text-[13px] text-white/60">Carregando PIX…</p></Panel>;


  return (
    <Panel>
      <SectionTitle kicker="Configurações • PIX / Recebimentos">PIX no Estoque</SectionTitle>
      <p className="mt-2 text-[12px] leading-relaxed text-amber-200/90 rounded-[10px] bg-amber-500/10 border border-amber-500/20 px-3 py-2">
        {cfg.providerConfigured
          ? 'Provider oficial conectado. A confirmação do pagamento depende do status informado pelo provider.'
          : 'Nenhum provider PIX oficial está configurado. Salvar a chave não habilita cobrança nem confirmação no Estoque.'}
      </p>
      {erro && <p className="mt-3 text-[12px] text-red-300">{erro}</p>}
      {ok && <p className="mt-3 text-[12px] text-emerald-300">{ok}</p>}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center justify-between gap-3 rounded-[10px] bg-[#121221] border border-white/[0.05] px-3 py-2.5 text-[13px] md:col-span-2">
          <span className="text-white/70">Ativar PIX no Estoque</span>
          <button
            type="button" role="switch" aria-checked={cfg.enabled} disabled={!cfg.providerConfigured}
            onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
            className={`h-6 w-11 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${cfg.enabled ? 'bg-emerald-500' : 'bg-white/10'}`}
          >
            <span className={`block h-5 w-5 rounded-full bg-white transition ${cfg.enabled ? 'translate-x-5' : 'translate-x-0.5'} mt-0.5`} />
          </button>
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-white/60">
          Tipo de chave
          <select
            value={cfg.keyType}
            onChange={(e) => setCfg((c) => ({ ...c, keyType: e.target.value as TipoChave }))}
            className="h-10 rounded-[10px] bg-[#121221] border border-white/10 px-3 text-[13px] text-white/85"
          >
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-white/60">
          CPF/CNPJ titular
          <input
            value={cfg.document}
            onChange={(e) => setCfg((c) => ({ ...c, document: e.target.value }))}
            placeholder="Somente registro"
            maxLength={18}
            className="h-10 rounded-[10px] bg-[#121221] border border-white/10 px-3 text-[13px] text-white/85"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-white/60 md:col-span-2">
          Chave PIX {cfg.pixKeyMasked && <span className="text-white/35">(atual: {cfg.pixKeyMasked})</span>}
          <input
            value={cfg.pixKey}
            onChange={(e) => setCfg((c) => ({ ...c, pixKey: e.target.value }))}
            placeholder="Digite a chave para salvar ou trocar"
            className="h-10 rounded-[10px] bg-[#121221] border border-white/10 px-3 text-[13px] text-white/85"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-white/60">
          Nome do recebedor (máx. 25)
          <input
            value={cfg.merchantName}
            onChange={(e) => setCfg((c) => ({ ...c, merchantName: e.target.value }))}
            maxLength={25}
            className="h-10 rounded-[10px] bg-[#121221] border border-white/10 px-3 text-[13px] text-white/85"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12px] text-white/60">
          Cidade (máx. 15)
          <input
            value={cfg.merchantCity}
            onChange={(e) => setCfg((c) => ({ ...c, merchantCity: e.target.value }))}
            maxLength={15}
            className="h-10 rounded-[10px] bg-[#121221] border border-white/10 px-3 text-[13px] text-white/85"
          />
        </label>
      </div>
      <button
        type="button" onClick={salvar} disabled={saving}
        className="mt-4 h-10 px-5 rounded-[10px] bg-emerald-500 text-black text-[13px] font-semibold disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'Salvar PIX'}
      </button>
    </Panel>
  );
}
