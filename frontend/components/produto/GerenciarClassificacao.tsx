'use client';
// Gerenciar classificação: renomear e excluir grupos e subgrupos. Excluir só quando o item está
// vazio (sem produtos e sem subgrupos) — o backend confere de novo e recusa com o motivo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Botao, Modal } from './ui';
import { fichaApi, mensagemDeErro, type ItemClassificacao } from '@/lib/produto-ficha';

const NIVEL = ['Grupo', 'Subgrupo nível 1', 'Subgrupo nível 2', 'Subgrupo nível 3'];

const icone = (ativo: boolean, perigo = false) => ({
  width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0,
  border: '1px solid var(--nx-border)', background: ativo ? 'transparent' : 'var(--nx-surface-2)',
  color: !ativo ? 'var(--nx-ink-3)' : perigo ? 'var(--nx-danger, #dc2626)' : 'var(--nx-ink-2)',
  cursor: ativo ? 'pointer' : 'not-allowed', opacity: ativo ? 1 : 0.55,
} as const);
const contagem = { fontSize: 12, color: 'var(--nx-ink-3)', border: '1px solid var(--nx-border)', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' } as const;

function descreverConteudo(i: ItemClassificacao) {
  const p = [i.produtos ? `${i.produtos} produto${i.produtos > 1 ? 's' : ''}` : null, i.subgrupos ? `${i.subgrupos} subgrupo${i.subgrupos > 1 ? 's' : ''}` : null].filter(Boolean);
  return p.length ? p.join(' · ') : 'vazio';
}

export default function GerenciarClassificacao({ aoFechar, aoAlterar, avisar }: { aoFechar: () => void; aoAlterar: (excluidoId?: string) => Promise<void>; avisar: (msg: string, erro?: boolean) => void }) {
  const [itens, setItens] = useState<ItemClassificacao[] | null>(null);
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<ItemClassificacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => fichaApi.arvoreClassificacao().then(setItens).catch((e) => { setItens([]); setErro(mensagemDeErro(e)); }), []);
  useEffect(() => { void carregar(); }, [carregar]);

  // Árvore em ordem: cada grupo seguido dos seus subgrupos (profundidade primeiro).
  const ordenados = useMemo(() => {
    if (!itens) return [];
    const filhos = new Map<string | null, ItemClassificacao[]>();
    for (const i of itens) filhos.set(i.categoriaPaiId, [...(filhos.get(i.categoriaPaiId) ?? []), i]);
    const r: ItemClassificacao[] = [];
    const visitar = (pai: string | null) => (filhos.get(pai) ?? []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach((i) => { r.push(i); visitar(i.id); });
    visitar(null);
    return r;
  }, [itens]);

  async function salvarNome() {
    if (!editando) return;
    setOcupado(true); setErro(null);
    try {
      const nome = editando.nome.trim();
      await fichaApi.renomearCategoria(editando.id, nome);
      setEditando(null);
      await Promise.all([carregar(), aoAlterar()]);
      avisar(`Renomeado para "${nome}".`);
    } catch (e) { setErro(mensagemDeErro(e)); } finally { setOcupado(false); }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setOcupado(true); setErro(null);
    try {
      await fichaApi.excluirCategoria(excluir.id);
      const nome = excluir.nome; const id = excluir.id;
      setExcluir(null);
      await Promise.all([carregar(), aoAlterar(id)]);
      avisar(`"${nome}" excluído.`);
    } catch (e) { setExcluir(null); setErro(mensagemDeErro(e)); await carregar(); } finally { setOcupado(false); }
  }

  if (excluir) {
    return (
      <Modal titulo={`Excluir "${excluir.nome}"?`} aoFechar={() => setExcluir(null)}
        acoes={<><Botao onClick={() => setExcluir(null)} desabilitado={ocupado}>Cancelar</Botao><Botao perigo onClick={() => void confirmarExclusao()} desabilitado={ocupado}>{ocupado ? 'Excluindo…' : 'Excluir'}</Botao></>}>
        <p style={{ margin: 0, color: 'var(--nx-ink-2)', fontSize: 14, lineHeight: 1.5 }}>
          {NIVEL[excluir.nivel]} vazio: nenhum produto e nenhum subgrupo. Essa ação não pode ser desfeita.
        </p>
      </Modal>
    );
  }

  return (
    <Modal titulo="Gerenciar classificação" aoFechar={aoFechar} acoes={<Botao onClick={aoFechar}>Fechar</Botao>}>
      <p style={{ margin: '0 0 12px', color: 'var(--nx-ink-2)', fontSize: 14 }}>Renomeie ou exclua grupos e subgrupos. A mudança vale para todos os produtos. Só é possível excluir o que estiver vazio.</p>
      {erro && <p role="alert" style={{ margin: '0 0 12px', color: 'var(--nx-danger, #dc2626)', fontSize: 13 }}>{erro}</p>}
      {itens === null ? <p style={{ color: 'var(--nx-ink-3)', fontSize: 14 }}>Carregando…</p>
        : ordenados.length === 0 ? <p style={{ color: 'var(--nx-ink-3)', fontSize: 14 }}>Nenhum grupo cadastrado ainda.</p>
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--nx-border)' }}>
            {ordenados.map((i) => {
              const vazio = !i.produtos && !i.subgrupos;
              const emEdicao = editando?.id === i.id;
              return (
                <li key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', paddingLeft: i.nivel * 22, borderBottom: '1px solid var(--nx-border)' }}>
                  {emEdicao ? (
                    <form style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0 }} onSubmit={(e) => { e.preventDefault(); void salvarNome(); }}>
                      <input autoFocus value={editando.nome} maxLength={80} aria-label={`Novo nome de ${i.nome}`} onChange={(e) => setEditando({ id: i.id, nome: e.target.value })}
                        style={{ flex: 1, minWidth: 0, height: 38, borderRadius: 10, border: '2px solid var(--nx-accent)', background: 'var(--nx-surface)', color: 'var(--nx-ink)', padding: '0 10px', fontSize: 14 }} />
                      <Botao primario pequeno tipo="submit" desabilitado={ocupado || editando.nome.trim().length < 2 || editando.nome.trim() === i.nome}>Salvar</Botao>
                      <Botao pequeno onClick={() => setEditando(null)} desabilitado={ocupado}>Cancelar</Botao>
                    </form>
                  ) : (
                    <>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14, color: 'var(--nx-ink)', fontWeight: i.nivel === 0 ? 700 : 400 }}>
                        <span style={{ overflowWrap: 'anywhere' }}>{i.nome}</span>
                        <span style={contagem}>{descreverConteudo(i)}</span>
                      </span>
                      <button type="button" style={icone(true)} title={`Renomear ${i.nome}`} aria-label={`Renomear ${i.nome}`} onClick={() => { setErro(null); setEditando({ id: i.id, nome: i.nome }); }}><Pencil size={15} /></button>
                      <button type="button" style={icone(vazio, true)} aria-disabled={!vazio}
                        title={vazio ? `Excluir ${i.nome}` : `Não dá para excluir: tem ${descreverConteudo(i)}. Mova os produtos para outro grupo ou exclua os subgrupos primeiro.`}
                        aria-label={vazio ? `Excluir ${i.nome}` : `Excluir ${i.nome} (bloqueado: tem ${descreverConteudo(i)})`}
                        onClick={() => { setErro(null); if (vazio) setExcluir(i); else setErro(`Não dá para excluir "${i.nome}": tem ${descreverConteudo(i)}. Mova os produtos para outro grupo ou exclua os subgrupos primeiro.`); }}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </Modal>
  );
}
