'use client';
// Aba "Sincronização" do WooCommerce: importa os pedidos mais recentes da loja para Vendas,
// na filial escolhida (baixa de estoque nessa filial). O relatório mostra pedido a pedido o
// que aconteceu — inclusive os que não entraram (SKU sem produto no NEXUS, status ignorado).
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import api from '@/lib/api';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import { comunicacaoApi } from '@/lib/integracoes-central';

type Item = { pedido: string; vendaId: string | null; acao: string; detalhe?: string };
type Resultado = { resumo: { consultados: number; importados: number; atualizados: number; duplicados: number; semVinculo: number; ignorados: number; erros: number }; relatorio: Item[] };

const entrada = 'h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] focus:outline-none focus:border-[var(--nx-accent)]';
const ROTULO: Record<string, string> = { importada: 'Importada', atualizada: 'Status atualizado', duplicada: 'Já existia', semVinculoProduto: 'Sem produto (SKU)', ignorado: 'Ignorado', moedaNaoSuportada: 'Moeda não suportada', erro: 'Erro' };

export function ImportarPedidosWoo({ conectado, ultimoSyncEm, config, onAlterado }: { conectado: boolean; ultimoSyncEm: string | null; config: Record<string, string>; onAlterado: () => void }) {
  const automatico = config.importarAutomatico === 'SIM';
  const [salvandoAuto, setSalvandoAuto] = useState(false);
  const [filiais, setFiliais] = useState<{ id: string; nome: string }[]>([]);
  const [filialId, setFilialId] = useState('');
  const [limite, setLimite] = useState(50);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [res, setRes] = useState<Resultado | null>(null);

  useEffect(() => {
    api.get<{ filiais?: { id: string; nome: string }[] } | { id: string; nome: string }[]>('/filiais')
      .then(({ data }) => { const l = Array.isArray(data) ? data : data.filiais ?? []; setFiliais(l); setFilialId((f) => f || l[0]?.id || ''); })
      .catch(() => setFiliais([]));
  }, []);

  async function alternarAutomatico() {
    setErro(null); setSalvandoAuto(true);
    try { await comunicacaoApi.wooAutomatico(!automatico, filialId); onAlterado(); }
    catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível alterar a importação automática.')); } finally { setSalvandoAuto(false); }
  }

  async function importar() {
    setErro(null); setRes(null); setOcupado(true);
    try { setRes((await api.post<Resultado>('/integracoes/central/woocommerce/pedidos/importar', { filialId, limite })).data); }
    catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível importar os pedidos.')); } finally { setOcupado(false); }
  }

  if (!conectado) return <p className="text-[13px] text-[var(--nx-ink-3)]">Conecte e valide a loja na aba Configuração para importar pedidos.</p>;
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--nx-ink-3)]">Os pedidos viram vendas no NEXUS. Cada item é casado pelo SKU: cadastre os produtos com o mesmo SKU da loja. A baixa de estoque acontece na filial escolhida, só para pedidos feitos depois da conexão. Reimportar não duplica.</p>
      <p className="text-[12px] text-[var(--nx-ink-2)]">Última importação: {ultimoSyncEm ? formatDateTime(ultimoSyncEm) : '—'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block sm:col-span-2"><span className="text-[12px] text-[var(--nx-ink-2)]">Filial (estoque)</span>
          <select className={`${entrada} mt-1`} value={filialId} onChange={(e) => setFilialId(e.target.value)} aria-label="Filial do estoque">
            {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Quantidade de pedidos</span>
          <input className={`${entrada} mt-1`} type="number" min={1} max={200} value={limite} onChange={(e) => setLimite(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} aria-label="Quantidade de pedidos" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-[12px] text-[var(--nx-ink-2)]"><input type="checkbox" checked={automatico} disabled={salvandoAuto || !filialId} onChange={() => void alternarAutomatico()} className="mt-0.5" aria-label="Importar automaticamente" />Importar automaticamente a cada 15 minutos{automatico && config.filialPedidos ? ` (filial: ${filiais.find((f) => f.id === config.filialPedidos)?.nome ?? config.filialPedidos})` : ' na filial escolhida acima'}.</label>
      <button type="button" onClick={importar} disabled={ocupado || !filialId} className="h-10 px-4 rounded-[10px] bg-[var(--nx-accent)] text-[13px] font-medium text-[var(--nx-ink)] hover:bg-[var(--nx-accent-2)] disabled:opacity-50 inline-flex items-center gap-2"><Download className="w-4 h-4" />{ocupado ? 'Importando…' : 'Importar pedidos'}</button>
      {erro && <p role="alert" className="rounded-[10px] border border-[color-mix(in_srgb,var(--nx-amber)_40%,var(--nx-border))] px-3 py-2 text-[12px] text-[var(--nx-amber)]">{erro}</p>}
      {res && (
        <div className="space-y-2" data-testid="relatorio-woo">
          <p role="status" className="text-[12px] text-[var(--nx-ink)]">{res.resumo.consultados} consultado(s): {res.resumo.importados} importado(s), {res.resumo.atualizados} atualizado(s), {res.resumo.duplicados} já existente(s), {res.resumo.semVinculo} sem produto, {res.resumo.ignorados} ignorado(s), {res.resumo.erros} com erro.</p>
          <ul className="divide-y divide-[var(--nx-border)] max-h-64 overflow-y-auto">
            {res.relatorio.map((i) => (
              <li key={i.pedido} className="py-2 text-[12px]"><span className="text-[var(--nx-ink)]">Pedido #{i.pedido}</span> · <span className={i.acao === 'erro' || i.acao === 'semVinculoProduto' ? 'text-[var(--nx-amber)]' : 'text-[var(--nx-ink-2)]'}>{ROTULO[i.acao] ?? i.acao}</span>{i.detalhe && <span className="block text-[var(--nx-ink-3)] break-words">{i.detalhe}</span>}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
