'use client';

/**
 * Painel de Pontuação Configurável — Ciclo 5.
 *
 * Entra na aba GAMIFICAÇÃO do Radar, junto da Loja. Não cria aba nova.
 *
 * A REGRA QUE ESTA TELHA NÃO QUEBRA
 * ---------------------------------
 * O NEXUS não tem opinião sobre quanto vale absenceiro. Antes, a aba mostrava
 * uma lista fixa de 7 regras com valores gravados no código (50/30/20/15/40/
 * -20/-30), igual para toda empresa, e o botão de ligar/desligar só mexia no
 * estado do navegador — nada era gravado, nada mudava o saldo.
 *
 * Aqui a empresa define a SUA política: quais eventos contam, qual condição
 * cada um exige, quantos pontos vale e em que período. O NEXUS só mede o dado
 * real, compara e credita o valor que aparece neste formulário.
 *
 * SEM PADRÃO IMPOSTO
 * ------------------
 * A lista começa vazia, e a tela escreve isso. Não há botão de "usar exemplo"
 * nem valor sugerido: a empresa que não configurou nada tem saldo zero, e
 * fingir o contrário seria o sistema inventando política em nome dela.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Criterio = {
  id: string; nome: string; descricao: string | null;
  evento: string; eventoRotulo: string; eventoExplicacao: string; unidade: string;
  operador: string; operadorRotulo: string;
  valor: number; pontos: number;
  periodo: string; periodoRotulo: string;
  ativo: boolean; creditos: number;
};
type EventoInfo = { evento: string; rotulo: string; unidade: string; explicacao: string };
type OperadorInfo = { operador: string; rotulo: string };
type PeriodoInfo = { periodo: string; rotulo: string };
type LinhaHist = {
  id: string; criterioId: string | null; criterio: string | null;
  funcionario: string; evidencia: string; pontos: number;
  periodo: string; origem: string;
};

const FORM_VAZIO = { nome: '', evento: '', operador: 'IGUAL', valor: '0', pontos: '', periodo: 'MENSAL' };

export default function PontuacaoConfigPainel({
  onToast,
}: {
  onToast: (t: string, m: string, k?: 'ok' | 'warn') => void;
}) {
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [eventos, setEventos] = useState<EventoInfo[]>([]);
  const [operadores, setOperadores] = useState<OperadorInfo[]>([]);
  const [periodos, setPeriodos] = useState<PeriodoInfo[]>([]);
  const [historico, setHistorico] = useState<{ apuracoes: LinhaHist[]; manuais: LinhaHist[] }>({
    apuracoes: [], manuais: [],
  });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [apurando, setApurando] = useState<'simular' | 'aplicar' | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ mensagem: string; itens: any[]; simulado: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [c, h] = await Promise.all([
        api.get<any>('/rh/pontuacao/criterios'),
        api.get<any>('/rh/pontuacao/historico?take=40'),
      ]);
      const cd = c.data;
      setCriterios(cd.criterios ?? []);
      setEventos(cd.eventos ?? []);
      setOperadores(cd.operadores ?? []);
      setPeriodos(cd.periodos ?? []);
      setHistorico({
        apuracoes: h.data?.apuracoes ?? [],
        manuais: h.data?.manuais ?? [],
      });
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível ler a política de pontos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const eventoSelecionado = eventos.find((e) => e.evento === form.evento);

  const criar = useCallback(async () => {
    setSalvando(true); setErro(null);
    try {
      await api.post('/rh/pontuacao/criterios', {
        nome: form.nome.trim(),
        evento: form.evento,
        operador: form.operador,
        valor: Number(form.valor),
        pontos: Number(form.pontos),
        periodo: form.periodo,
      });
      setForm(FORM_VAZIO);
      onToast('Critério cadastrado', 'A empresa define o valor; o NEXUS só verifica o evento.');
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? 'Verifique os campos.');
    } finally { setSalvando(false); }
  }, [form, carregar, onToast]);

  const alternar = useCallback(async (c: Criterio) => {
    try {
      await api.patch('/rh/pontuacao/criterios/' + c.id, { ativo: !c.ativo });
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível atualizar', e?.message ?? '', 'warn');
    }
  }, [carregar, onToast]);

  const apagar = useCallback(async (c: Criterio) => {
    // Confirmação explícita: apagar um critério tira a regra da empresa, e
    // quem decide isso é ela — não um clique acidental.
    if (typeof window !== 'undefined' && !window.confirm(
      'Remover o critério "' + c.nome + '"?\n\nOs pontos já creditados continuam no saldo e no histórico — só a apuração futura para.',
    )) return;
    try {
      await api.delete('/rh/pontuacao/criterios/' + c.id);
      onToast('Critério removido', 'O histórico creditado foi preservado.');
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível remover', e?.message ?? '', 'warn');
    }
  }, [carregar, onToast]);

  const avaliar = useCallback(async (simular: boolean) => {
    setApurando(simular ? 'simular' : 'aplicar'); setErro(null); setResultado(null);
    try {
      const r = await api.post<any>('/rh/pontuacao/avaliar', { periodo: 'MENSAL', simular });
      const d = r.data;
      setResultado({ mensagem: d.mensagem, itens: d.itens ?? [], simulado: !!d.simulado });
      if (!simular && d.creditos > 0) {
        onToast('Apuração concluída', d.mensagem);
        await carregar();
      }
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível apurar.');
    } finally { setApurando(null); }
  }, [carregar, onToast]);


  const card = 'rounded-[16px] border border-[#2a2a4a] bg-[#1c1c32] p-4';
  const campo = 'h-[34px] w-full rounded-[10px] border border-[#23233f] bg-[#121224] px-2.5 text-[12px] text-white outline-none focus:border-\[#7C3AED\] disabled:opacity-50';
  const rot = 'mb-1 block text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]';

  if (carregando) return <p className="text-[12px] text-white/50">Carregando a política de pontos…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[14px] font-bold text-white">Política de Pontuação da Empresa</h2>
        <p className="mt-1 text-[11px] text-[#6a6a8a]">
          Cada empresa define os seus critérios, condições e valores. O NEXUS verifica o evento
          real do funcionário e credita a quantidade configurada aqui — não existe valor padrão.
        </p>
      </div>

      {erro && <p className="rounded-[12px] border border-[#4a1a1a] bg-[#1f1010] p-3 text-[12px] text-[#f0a0a0]">{erro}</p>}

      {criterios.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] text-[#8a8ab0]">
          Nenhum critério configurado. Enquanto a empresa não definir a sua política, ninguém
          ganha pontos — o NEXUS não tem valor padrão para aplicar no lugar dela.
        </p>
      ) : (
        <div className="space-y-2">
          {criterios.map((c) => (
            <div key={c.id} className={`${card} flex flex-wrap items-center justify-between gap-3 ${c.ativo ? '' : 'opacity-55'}`}>
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-white">
                  {c.nome}
                  {c.ativo ? '' : <span className="ml-2 text-[10px] font-bold text-[#6a6a8a]">INATIVO</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8a8ab0]">
                  {c.eventoRotulo} {c.operadorRotulo} {c.valor} {c.unidade} • {c.periodoRotulo}
                </p>
                {c.creditos > 0 && (
                  <p className="mt-0.5 text-[10.5px] text-white/35">
                    {c.creditos} crédito(s) já apurado(s).
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="text-[14px] font-bold"
                  style={{ color: c.pontos < 0 ? '#f87171' : '#a78bfa' }}
                >
                  {c.pontos > 0 ? '+' : ''}{c.pontos} pts
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.ativo}
                  aria-label={'Ativar ou desativar o critério ' + c.nome}
                  onClick={() => alternar(c)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition ${c.ativo ? 'bg-\[#7C3AED\]' : 'bg-[#2a2a4a]'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${c.ativo ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => apagar(c)}
                  className="h-8 rounded-[8px] border border-[#23233f] px-3 text-[11px] font-bold text-[#8a8ab0] hover:text-white"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={card}>
        <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">
          Novo critério da empresa
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <label className={rot} htmlFor="pc-nome">Nome do critério</label>
            <input id="pc-nome" className={campo} value={form.nome} maxLength={160}
              onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Zero falta no mês" />
          </div>
          <div>
            <label className={rot} htmlFor="pc-evento">Evento verificado</label>
            <select id="pc-evento" className={campo} value={form.evento}
              onChange={(e) => setForm({ ...form, evento: e.target.value })}>
              <option value="">Escolha o que o NEXUS vai medir…</option>
              {eventos.map((e) => <option key={e.evento} value={e.evento}>{e.rotulo}</option>)}
            </select>
          </div>
        </div>
        {eventoSelecionado && (
          <p className="mt-2 text-[10.5px] text-[#6a6a8a]">{eventoSelecionado.explicacao}</p>
        )}
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <div>
            <label className={rot} htmlFor="pc-operador">Condição</label>
            <select id="pc-operador" className={campo} value={form.operador}
              onChange={(e) => setForm({ ...form, operador: e.target.value })}>
              {operadores.map((o) => <option key={o.operador} value={o.operador}>{o.rotulo}</option>)}
            </select>
          </div>
          <div>
            <label className={rot} htmlFor="pc-valor">Valor de referência</label>
            <input id="pc-valor" type="number" min={0} className={campo} value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>
          <div>
            <label className={rot} htmlFor="pc-pontos">Pontos da empresa</label>
            <input id="pc-pontos" type="number" className={campo} value={form.pontos}
              onChange={(e) => setForm({ ...form, pontos: e.target.value })} placeholder="10 ou -20" />
          </div>
          <div>
            <label className={rot} htmlFor="pc-periodo">Período</label>
            <select id="pc-periodo" className={campo} value={form.periodo}
              onChange={(e) => setForm({ ...form, periodo: e.target.value })}>
              {periodos.map((p) => <option key={p.periodo} value={p.periodo}>{p.rotulo}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[10.5px] text-[#6a6a8a]">
            Valor negativo desconta pontos; o NEXUS não sugere número nenhum.
          </p>
          <button type="button" onClick={criar}
            disabled={salvando || !form.nome || !form.evento || form.pontos === ''}
            className="h-[34px] shrink-0 rounded-[10px] bg-[linear-gradient(135deg,#7C3AED,#4F46E5)] px-4 text-[12px] font-bold text-white disabled:opacity-50">
            {salvando ? 'Salvando…' : 'Cadastrar critério'}
          </button>
        </div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">
              Apuração do mês
            </p>
            <p className="mt-1 text-[11px] text-[#8a8ab0]">
              Verifica o evento real de cada funcionário e credita o valor que a empresa configurou.
              Rodar de novo no mesmo mês não credita duas vezes.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => avaliar(true)} disabled={apurando !== null}
              className="h-8 rounded-[8px] border border-[#23233f] px-3 text-[11px] font-bold text-[#8a8ab0] disabled:opacity-50">
              {apurando === 'simular' ? 'Simulando…' : 'Simular'}
            </button>
            <button type="button" onClick={() => avaliar(false)} disabled={apurando !== null}
              className="h-8 rounded-[8px] bg-[linear-gradient(135deg,#7C3AED,#4F46E5)] px-3 text-[11px] font-bold text-white disabled:opacity-50">
              {apurando === 'aplicar' ? 'Apurando…' : 'Apurar e creditar'}
            </button>
          </div>
        </div>

        {resultado && (
          <div className={`mt-3 rounded-[12px] border p-3 text-[11.5px] ${resultado.simulado ? 'border-[#2a2a4a] bg-[#121224] text-[#8a8ab0]' : 'border-[#1f3a2a] bg-[#101a14] text-[#8fe0b0]'}`}>
            <p className="font-bold">{resultado.mensagem}</p>
            {resultado.itens.length > 0 && (
              <ul className="mt-2 space-y-1">
                {resultado.itens.slice(0, 12).map((i, k) => (
                  <li key={k} className="text-[11px] text-white/70">
                    <span className="font-bold text-white">{i.funcionario}</span> — {i.criterio}:{' '}
                    {i.evidencia} ({i.pontos > 0 ? '+' : ''}{i.pontos} pts)
                  </li>
                ))}
                {resultado.itens.length > 12 && (
                  <li className="text-[10.5px] text-[#6a6a8a]">+{resultado.itens.length - 12} pessoa(s).</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className={card}>
        <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">
          Histórico de pontos
        </p>
        {historico.apuracoes.length === 0 && historico.manuais.length === 0 ? (
          <p className="mt-2 text-[11.5px] text-[#8a8ab0]">
            Nenhum ponto registrado ainda. A apuração preenche isto com a evidência medida em cada crédito.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-wide text-[#6a6a8a]">
                <tr>
                  <th className="py-2 pr-3 font-bold">Origem</th>
                  <th className="py-2 pr-3 font-bold">Funcionário</th>
                  <th className="py-2 pr-3 font-bold">Critério</th>
                  <th className="py-2 pr-3 font-bold">Evidência</th>
                  <th className="py-2 pr-3 font-bold">Pontos</th>
                  <th className="py-2 font-bold">Período</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {[...historico.apuracoes, ...historico.manuais].map((h) => (
                  <tr key={h.id} className="border-t border-[#23233f]">
                    <td className="py-2 pr-3">
                      <span className={h.origem === 'APURACAO' ? 'text-[#a78bfa]' : 'text-[#f59e0b]'}>
                        {h.origem === 'APURACAO' ? 'Apuração' : 'Manual'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{h.funcionario}</td>
                    <td className="py-2 pr-3">{h.criterio ?? '—'}</td>
                    <td className="py-2 pr-3 text-white/50">{h.evidencia}</td>
                    <td className="py-2 pr-3 font-bold" style={{ color: h.pontos < 0 ? '#f87171' : '#a78bfa' }}>
                      {h.pontos > 0 ? '+' : ''}{h.pontos}
                    </td>
                    <td className="py-2">{h.periodo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}



