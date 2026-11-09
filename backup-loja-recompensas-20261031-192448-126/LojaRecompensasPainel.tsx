'use client';

/**
 * Loja de Recompensas — Ciclo 4.
 *
 * Entra na aba GAMIFICAÇÃO do Radar, que é onde a gamificação já vive. Não é
 * uma aba nova: é mais um card dentro da tela que já existe.
 *
 * O QUE ESTA TELHA NÃO FAZ
 * -----------------------
 * Não mostra recompensa de exemplo, não mostra saldo de exemplo, e não
 * esconde quem não tem nada. Sem recompensa cadastrada, ela escreve "nenhuma
 * recompensa cadastrada"; sem pontos, escreve "0 pontos". O ciclo 4 existiu
 * justamente para trocar três botões que prometiam uma ação e não gravavam
 * nada — recriar isso aqui seria o mesmo erro.
 *
 * DUAS PESSOAS
 * -----------
 * O FUNCIONÁRIO pede (SOLICITADO) e o GESTOR decide (APROVADO / REJEITADO /
 * ENTREGUE). O saldo só é consumido na aprovação — a tela mostra isso, porque
 * "pedi e os pontos já sumiram" é a dúvida mais comum de quem usa esse tipo
 * de programa.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

const CATEGORIAS = ['BENEFICIO', 'EXPERIENCIA', 'CURSO', 'ALIMENTACAO', 'FOLGA', 'BRINDE', 'OUTRO'] as const;
const ROTULO_CAT: Record<string, string> = {
  BENEFICIO: 'Benefício', EXPERIENCIA: 'Experiência', CURSO: 'Curso',
  ALIMENTACAO: 'Alimentação', FOLGA: 'Folga', BRINDE: 'Brinde', OUTRO: 'Outros',
};
const ROTULO_STATUS: Record<string, string> = {
  SOLICITADO: 'Solicitado', APROVADO: 'Aprovado', ENTREGUE: 'Entregue',
  REJEITADO: 'Rejeitado', CANCELADO: 'Cancelado',
};

type Recompensa = {
  id: string; nome: string; descricao: string; categoria: string; categoriaRotulo: string;
  custoPontos: number; quantidadeDisponivel: number; ativa: boolean; disponivel: boolean;
};
type Saldo = { funcionarioId: string; nome: string; departamento: string | null; saldo: number };
type Resgate = {
  id: string; funcionarioId: string; funcionario: string; recompensa: string;
  pontosUtilizados: number; status: string; statusRotulo: string; data: string;
  aprovadoPor: string | null; aprovadoEm: string | null; entregueEm: string | null;
};

export default function LojaRecompensasPainel({
  onToast,
}: {
  onToast: (t: string, m: string, k?: 'ok' | 'warn') => void;
}) {
  const [recompensas, setRecompensas] = useState<Recompensa[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [resgates, setResgates] = useState<Resgate[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Confirmação antes de gastar ponto. Um resgate ocupa estoque na hora e só
  // volta se alguém rejeitar: o clique errado precisa ser reversível na tela.
  const [confirmando, setConfirmando] = useState<{ recompensa: Recompensa; saldo: Saldo } | null>(null);
  // Formulário de cadastro.
  const [form, setForm] = useState({ nome: '', descricao: '', categoria: 'BENEFICIO', custoPontos: '', quantidade: '' });
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const [r, s, g] = await Promise.all([
        api.get<{ recompensas: Recompensa[] }>('/rh/loja/recompensas'),
        api.get<{ saldos: Saldo[] }>('/rh/loja/saldos'),
        api.get<{ resgates: Resgate[] }>('/rh/loja/resgates'),
      ]);
      setRecompensas(r.data?.recompensas ?? []);
      setSaldos(s.data?.saldos ?? []);
      setResgates(g.data?.resgates ?? []);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível ler a loja.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const criar = useCallback(async () => {
    setCriando(true); setErro(null);
    try {
      await api.post('/rh/loja/recompensas', {
        nome: form.nome.trim(), descricao: form.descricao.trim(),
        categoria: form.categoria, custoPontos: Number(form.custoPontos),
        quantidadeDisponivel: Number(form.quantidade),
      });
      setForm({ nome: '', descricao: '', categoria: 'BENEFICIO', custoPontos: '', quantidade: '' });
      onToast('Recompensa cadastrada', 'Agora aparece na vitrine.');
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível cadastrar', e?.message ?? 'Verifique os campos.', 'warn');
    } finally { setCriando(false); }
  }, [form, carregar, onToast]);

  const alternarAtiva = useCallback(async (r: Recompensa) => {
    try {
      await api.patch('/rh/loja/recompensas/' + r.id, { ativa: !r.ativa });
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível atualizar', e?.message ?? '', 'warn');
    }
  }, [carregar, onToast]);

  const resgatar = useCallback(async (recompensaId: string, funcionarioId: string) => {
    setOcupado(true); setErro(null);
    try {
      await api.post('/rh/loja/resgates', { recompensaId, funcionarioId });
      onToast('Resgate solicitado', 'Os pontos são consumidos quando o gestor aprovar.');
      await carregar();
    } catch (e: any) {
      onToast('Resgate não registrado', e?.message ?? 'Verifique saldo e estoque.', 'warn');
    } finally { setOcupado(false); }
  }, [carregar, onToast]);

  const decidir = useCallback(async (id: string, status: string) => {
    try {
      const r = await api.patch<any>('/rh/loja/resgates/' + id, { status });
      const d = r.data;
      onToast('Resgate atualizado', d?.mensagem ?? '');
      await carregar();
    } catch (e: any) {
      onToast('Não foi possível decidir', e?.message ?? '', 'warn');
    }
  }, [carregar, onToast]);

  const card = 'rounded-[16px] border border-[#2a2a4a] bg-[#1c1c32] p-4';
  const campo = 'h-[34px] w-full rounded-[10px] border border-[#23233f] bg-[#121224] px-2.5 text-[12px] text-white outline-none focus:border-[#7C3AED]';
  const rot = 'mb-1 block text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]';

  if (carregando) return <p className="text-[12px] text-white/50">Carregando a loja…</p>;

  const pendentes = resgates.filter((r) => r.status === 'SOLICITADO');
  const vitrine = recompensas.filter((r) => r.disponivel);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold text-white">Loja de Recompensas</h2>
          <p className="mt-1 text-[11px] text-[#6a6a8a]">
            Recompensas trocadas por pontos. O saldo é o que está nos registros, menos o que já
            foi resgatado e aprovado.
          </p>
        </div>
      </div>

      {erro && <p className="rounded-[12px] border border-[#4a1a1a] bg-[#1f1010] p-3 text-[12px] text-[#f0a0a0]">{erro}</p>}

      <div className="space-y-2">
          <div className={card}>
            <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">Cadastrar recompensa</p>
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              <div className="md:col-span-2">
                <label className={rot} htmlFor="lr-nome">Nome</label>
                <input id="lr-nome" className={campo} value={form.nome} maxLength={160}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Vale-presente R$ 50" />
              </div>
              <div>
                <label className={rot} htmlFor="lr-cat">Categoria</label>
                <select id="lr-cat" className={campo} value={form.categoria}
                  onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{ROTULO_CAT[c]}</option>)}
                </select>
              </div>
              <div>
                <label className={rot} htmlFor="lr-custo">Custo (pontos)</label>
                <input id="lr-custo" type="number" min={1} className={campo} value={form.custoPontos}
                  onChange={(e) => setForm({ ...form, custoPontos: e.target.value })} placeholder="500" />
              </div>
              <div>
                <label className={rot} htmlFor="lr-qtd">Estoque</label>
                <input id="lr-qtd" type="number" min={0} className={campo} value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="10" />
              </div>
              <div className="md:col-span-4">
                <label className={rot} htmlFor="lr-desc">Descrição</label>
                <input id="lr-desc" className={campo} value={form.descricao} maxLength={1000}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="O que a pessoa recebe." />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={criar}
                  disabled={criando || !form.nome || !form.descricao || !form.custoPontos || form.quantidade === ''}
                  className="h-[34px] w-full rounded-[10px] bg-[linear-gradient(135deg,#7C3AED,#4F46E5)] text-[12px] font-bold text-white disabled:opacity-50">
                  {criando ? 'Salvando…' : 'Cadastrar'}
                </button>
              </div>
            </div>
          </div>

          {recompensas.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] text-[#8a8ab0]">
              Nenhuma recompensa cadastrada. Cadastre a primeira no formulário acima.
            </p>
          ) : vitrine.length === 0 ? (
            <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] text-[#8a8ab0]">
              Nenhuma recompensa disponível no momento. {recompensas.length} cadastrada(s), todas
              inativas ou sem estoque.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {vitrine.map((r) => (
                <div key={r.id} className="flex flex-col rounded-[14px] border border-[#2a2a4a] bg-[#1c1c32] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-bold text-white">{r.nome}</p>
                    <button type="button" onClick={() => alternarAtiva(r)}
                      className="shrink-0 text-[10px] text-[#6a6a8a] hover:text-white" title="Ativar ou desativar">
                      {r.ativa ? 'Ativa' : 'Inativa'}
                    </button>
                  </div>
                  <p className="mt-1 flex-1 text-[11px] leading-relaxed text-[#8a8ab0]">{r.descricao}</p>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[#7C3AED]">{r.categoriaRotulo}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[13px] font-bold text-white">{r.custoPontos} pts</span>
                    <span className="text-[10px] text-white/40">{r.quantidadeDisponivel} disponível(is)</span>
                  </div>
                  <select className={`${campo} mt-2`} disabled={ocupado || !!confirmando} defaultValue=""
                    onChange={(e) => {
                      const f = e.target.value;
                      e.target.value = '';
                      const alvo = saldos.find((s) => s.funcionarioId === f);
                      if (f && alvo) setConfirmando({ recompensa: r, saldo: alvo });
                    }}>
                    <option value="">Resgatar para…</option>
                    {saldos.map((s) => (
                      <option key={s.funcionarioId} value={s.funcionarioId} disabled={s.saldo < r.custoPontos}>
                        {s.nome} — {s.saldo} pts{s.saldo < r.custoPontos ? ' (insuficiente)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {saldos.length > 0 && (
            <div className={card}>
              <p className="text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">Saldos</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {saldos.map((s) => (
                  <span key={s.funcionarioId} className="rounded-[10px] border border-[#23233f] bg-[#121224] px-3 py-1.5 text-[11px]">
                    <span className="text-white/80">{s.nome}</span>{' '}
                    <span className="font-bold" style={{ color: s.saldo > 0 ? '#7C3AED' : '#6a6a8a' }}>{s.saldo} pts</span>
                  </span>
                ))}
              </div>
              {saldos.every((s) => s.saldo === 0) && (
                <p className="mt-2 text-[10.5px] text-[#6a6a8a]">
                  Nenhum ponto disponível nesta empresa. Registre pontuação em Gamificação para
                  liberar resgates.
                </p>
              )}
            </div>
          )}

        {confirmando && (
          <div className={`${card} flex flex-wrap items-center justify-between gap-3 border-[#7C3AED]`}>
            <div>
              <p className="text-[12px] font-bold text-white">
                Confirmar: {confirmando.saldo.nome} → {confirmando.recompensa.nome}
              </p>
              <p className="mt-0.5 text-[11px] text-white/60">
                {confirmando.recompensa.custoPontos} pontos. Hoje o saldo é {confirmando.saldo.saldo} e
                fica {confirmando.saldo.saldo - confirmando.recompensa.custoPontos} quando o gestor
                aprovar. O pedido reserva 1 unidade do estoque agora.
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmando(null)}
                className="h-8 rounded-[8px] border border-[#23233f] px-3 text-[11px] font-bold text-[#8a8ab0]">
                Cancelar
              </button>
              <button type="button" disabled={ocupado}
                onClick={() => {
                  const { recompensa, saldo } = confirmando;
                  setConfirmando(null);
                  void resgatar(recompensa.id, saldo.funcionarioId);
                }}
                className="h-8 rounded-[8px] bg-[linear-gradient(135deg,#7C3AED,#4F46E5)] px-3 text-[11px] font-bold text-white disabled:opacity-50">
                {ocupado ? 'Enviando…' : 'Confirmar resgate'}
              </button>
            </div>
          </div>
        )}

        <p className="pt-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">
          Aprovações {pendentes.length > 0 ? `(${pendentes.length})` : ''}
        </p>
        {pendentes.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] text-[#8a8ab0]">
            Nenhuma solicitação aguardando decisão.
          </p>
        ) : (
          <div className="space-y-2">
            {pendentes.map((g) => (
              <div key={g.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                <div>
                  <p className="text-[12px] font-bold text-white">{g.funcionario} → {g.recompensa}</p>
                  <p className="text-[10.5px] text-white/40">
                    {g.data} • {g.pontosUtilizados} pontos • pedido
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => decidir(g.id, 'REJEITADO')}
                    className="h-8 rounded-[8px] border border-[#23233f] px-3 text-[11px] font-bold text-[#f59e0b]">
                    Rejeitar
                  </button>
                  <button type="button" onClick={() => decidir(g.id, 'APROVADO')}
                    className="h-8 rounded-[8px] bg-[linear-gradient(135deg,#7C3AED,#4F46E5)] px-3 text-[11px] font-bold text-white">
                    Aprovar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="pt-2 text-[10px] font-bold uppercase tracking-[0.8px] text-[#6a6a8a]">Histórico</p>
        {resgates.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-[#2a2a4a] bg-[#121224] p-4 text-[11.5px] text-[#8a8ab0]">
            Nenhum resgate registrado.
          </p>
        ) : (
          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-left text-[11.5px]">
              <thead className="text-[10px] uppercase tracking-wide text-[#6a6a8a]">
                <tr>
                  <th className="py-2 pr-3 font-bold">Data</th>
                  <th className="py-2 pr-3 font-bold">Funcionário</th>
                  <th className="py-2 pr-3 font-bold">Recompensa</th>
                  <th className="py-2 pr-3 font-bold">Pontos</th>
                  <th className="py-2 pr-3 font-bold">Status</th>
                  <th className="py-2 font-bold">Aprovado por</th>
                </tr>
              </thead>
              <tbody className="text-white/80">
                {resgates.map((g) => (
                  <tr key={g.id} className="border-t border-[#23233f]">
                    <td className="py-2 pr-3">{g.data}</td>
                    <td className="py-2 pr-3">{g.funcionario}</td>
                    <td className="py-2 pr-3">{g.recompensa}</td>
                    <td className="py-2 pr-3">{g.pontosUtilizados}</td>
                    <td className="py-2 pr-3">{g.statusRotulo}</td>
                    <td className="py-2">{g.aprovadoPor ?? '—'}</td>
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

