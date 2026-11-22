'use client';
// Compras — tela principal: indicadores, Pedidos, Recebimentos, Notas Fiscais e Histórico.
// A ficha completa (Nova compra / editar / visualizar) abre em /compras/[id]; nunca fica aberta aqui.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alternador, Aviso, Botao, Metrica, Secao, Selo, Tabela, cx, estilos as s } from '@/components/produto/ui';
import { fmtData, fmtNum, fmtQtd, mensagemDeErro } from '@/lib/produto-ficha';
import { ROTULO_STATUS, TOM_STATUS, compraApi, type Painel } from '@/lib/compra-ficha';

type Aba = 'pedidos' | 'recebimentos' | 'notas' | 'historico';
const ABAS: Array<[Aba, string]> = [['pedidos', 'Pedidos'], ['recebimentos', 'Recebimentos'], ['notas', 'Notas Fiscais'], ['historico', 'Histórico']];
const brl = (v: number | null | undefined) => (v == null ? '—' : `R$ ${fmtNum(v)}`);
const t = (v: string | null | undefined) => v || '—';

export default function ComprasPage() {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('pedidos');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [filtros, setFiltros] = useState({ busca: '', status: '', fornecedorId: '', filialId: '', responsavelId: '', de: '', ate: '', situacao: 'TODOS' });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(true);
  const avisar = (texto: string, e?: boolean) => { setMensagem({ texto, erro: e }); setTimeout(() => setMensagem(null), e ? 8000 : 4000); };

  const carregarPainel = useCallback(async () => {
    try { setPainel(await compraApi.painel()); } catch (e) { setErro(mensagemDeErro(e)); }
  }, []);
  useEffect(() => { void carregarPainel(); }, [carregarPainel]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const p = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v));
    try {
      if (aba === 'pedidos') setLinhas(await compraApi.listar(p));
      else if (aba === 'recebimentos') setLinhas(await compraApi.recebimentos(p));
      else if (aba === 'notas') setLinhas(await compraApi.notas({ busca: filtros.busca || undefined, fornecedorId: filtros.fornecedorId || undefined }));
      else setLinhas(await compraApi.historico());
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setCarregando(false); }
  }, [aba, filtros]);
  useEffect(() => { const h = setTimeout(() => void carregar(), 250); return () => clearTimeout(h); }, [carregar]);

  const f = (k: keyof typeof filtros, v: string) => setFiltros((x) => ({ ...x, [k]: v }));
  const abrir = (id: string, extra = '') => router.push(`/compras/${id}${extra}`);

  async function duplicar(id: string) {
    try { const r = await compraApi.duplicar(id); avisar(`Pedido duplicado: ${r.numero}.`); router.push(`/compras/${r.id}?editar=1`); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function cancelar(id: string, numero: string) {
    const motivo = window.prompt(`Motivo do cancelamento de ${numero}:`);
    if (!motivo || motivo.trim().length < 3) return;
    try { await compraApi.cancelar(id, motivo.trim()); avisar('Pedido cancelado.'); await Promise.all([carregar(), carregarPainel()]); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function alternarAprovacao(v: boolean) {
    try { await compraApi.configuracao(v); await carregarPainel(); avisar(v ? 'Aprovação de compras ativada.' : 'Aprovação de compras desativada.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  if (erro) return <div className={s.ficha}><Aviso tom="erro">Não foi possível abrir Compras: {erro}</Aviso></div>;
  const ind = painel?.indicadores;
  const fornecedores = painel?.fornecedores ?? [];

  return (
    <div className={s.ficha}>
      <header className={s.cabecalho}>
        <div>
          <h1 className={s.titulo}>Compras</h1>
          <div className={s.subtitulo}>Pedidos, recebimentos, notas fiscais e histórico — dados reais da empresa</div>
        </div>
        <div className={s.acoes}>
          <Botao primario onClick={() => router.push('/compras/nova')}>+ Nova compra</Botao>
        </div>
      </header>
      {mensagem && <Aviso tom={mensagem.erro ? 'erro' : 'ok'}>{mensagem.texto}</Aviso>}

      <div className={s.metricas}>
        <Metrica rotulo="Total de pedidos" valor={ind ? fmtQtd(ind.total) : '—'} />
        <Metrica rotulo="Pedidos pendentes" valor={ind ? fmtQtd(ind.pendentes) : '—'} ajuda="Rascunho até confirmados" />
        <Metrica rotulo="Aguardando aprovação" valor={ind ? fmtQtd(ind.aguardandoAprovacao) : '—'} />
        <Metrica rotulo="Enviados" valor={ind ? fmtQtd(ind.enviados) : '—'} />
        <Metrica rotulo="Recebimentos pendentes" valor={ind ? fmtQtd(ind.recebimentosPendentes) : '—'} />
        <Metrica rotulo="Recebimentos parciais" valor={ind ? fmtQtd(ind.recebimentosParciais) : '—'} />
        <Metrica rotulo="Compras no mês" valor={ind ? fmtQtd(ind.comprasNoPeriodo) : '—'} />
        <Metrica rotulo="Valor comprado no mês" valor={ind ? brl(ind.valorNoPeriodo) : '—'} />
      </div>
      {painel?.podeAdministrar && (
        <div><Alternador l={4} rotulo="Exigir aprovação antes do envio" ligado={!!painel.empresa?.comprasExigeAprovacao} onChange={alternarAprovacao} ajuda="Aprovação exige compras.administrar" /></div>
      )}

      <nav className={s.abas} role="tablist" aria-label="Seções de compras">
        {ABAS.map(([k, tx]) => <button key={k} type="button" role="tab" aria-selected={aba === k} className={cx(s.aba, aba === k && s.abaAtiva)} onClick={() => { if (k === aba) return; setLinhas([]); setAba(k); }}>{tx}</button>)}
      </nav>

      <Secao titulo={ABAS.find(([k]) => k === aba)![1]}>
        {aba !== 'historico' && (
          <div className={s.filtros}>
            <input className={s.entrada} placeholder={aba === 'notas' ? 'Número ou chave da NF-e' : 'Nº do pedido ou fornecedor'} value={filtros.busca} onChange={(e) => f('busca', e.target.value)} aria-label="Pesquisar" />
            <select className={s.entrada} value={filtros.fornecedorId} onChange={(e) => f('fornecedorId', e.target.value)} aria-label="Fornecedor">
              <option value="">Todos os fornecedores</option>{fornecedores.map((x) => <option key={x.id} value={x.id}>{x.nomeFantasia ?? x.nome}</option>)}
            </select>
            {aba === 'pedidos' && (
              <select className={s.entrada} value={filtros.status} onChange={(e) => f('status', e.target.value)} aria-label="Status">
                <option value="">Todos os status</option>
                {[['RASCUNHO,SOLICITADA', 'Rascunho'], ['AGUARDANDO_APROVACAO', 'Aguardando aprovação'], ['APROVADA', 'Aprovada'], ['ENVIADA', 'Enviada'], ['PEDIDO', 'Confirmada'], ['PARCIAL', 'Parcialmente recebida'], ['RECEBIDA', 'Recebida'], ['CONCLUIDA', 'Concluída'], ['CANCELADA', 'Cancelada']].map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            )}
            {aba === 'recebimentos' && (
              <select className={s.entrada} value={filtros.situacao} onChange={(e) => f('situacao', e.target.value)} aria-label="Situação">
                <option value="TODOS">Todas as situações</option><option value="PENDENTES">Aguardando recebimento</option><option value="PARCIAIS">Parciais</option><option value="CONCLUIDOS">Concluídos</option>
              </select>
            )}
            {aba !== 'notas' && (
              <select className={s.entrada} value={filtros.filialId} onChange={(e) => f('filialId', e.target.value)} aria-label="Filial">
                <option value="">Todas as filiais</option>{(painel?.filiais ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
            )}
            {aba === 'pedidos' && (
              <select className={s.entrada} value={filtros.responsavelId} onChange={(e) => f('responsavelId', e.target.value)} aria-label="Responsável">
                <option value="">Todos os responsáveis</option>{(painel?.responsaveis ?? []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
            )}
            {aba !== 'notas' && <input className={s.entrada} type="date" value={filtros.de} onChange={(e) => f('de', e.target.value)} aria-label="De" />}
            {aba !== 'notas' && <input className={s.entrada} type="date" value={filtros.ate} onChange={(e) => f('ate', e.target.value)} aria-label="Até" />}
          </div>
        )}

        {aba === 'pedidos' && (
          <Tabela linhas={linhas} carregando={carregando} chave={(l: any) => l.id} vazio="Nenhum pedido encontrado. Use “+ Nova compra” para criar o primeiro."
            colunas={[
              { chave: 'n', titulo: 'Pedido', render: (l: any) => <button type="button" className={s.botao} style={{ height: 28 }} onClick={() => abrir(l.id)}>{l.numero ?? '—'}</button> },
              { chave: 'd', titulo: 'Criado em', render: (l: any) => <span className={s.nowrap}>{fmtData(l.criadoEm, false)}</span> },
              { chave: 'f', titulo: 'Fornecedor', render: (l: any) => l.fornecedor.nomeFantasia ?? l.fornecedor.nome },
              { chave: 'r', titulo: 'Responsável', render: (l: any) => t(l.responsavel) },
              { chave: 'i', titulo: 'Itens', num: true, render: (l: any) => l.itens },
              { chave: 'v', titulo: 'Valor total', num: true, render: (l: any) => brl(l.valorTotal) },
              { chave: 'p', titulo: 'Previsão', render: (l: any) => <span className={s.nowrap}>{fmtData(l.previsaoEntrega, false)}</span> },
              { chave: 's', titulo: 'Status', render: (l: any) => <Selo tom={TOM_STATUS[l.status]}>{ROTULO_STATUS[l.status] ?? l.status}</Selo> },
              { chave: 'u', titulo: 'Atualizado', render: (l: any) => <span className={s.nowrap}>{fmtData(l.atualizadoEm)}</span> },
              { chave: 'a', titulo: 'Ações', render: (l: any) => (
                <div style={{ display: 'flex', gap: 4 }}>
                  <Botao pequeno onClick={() => abrir(l.id)}>Ver</Botao>
                  {['RASCUNHO', 'SOLICITADA', 'AGUARDANDO_APROVACAO'].includes(l.status) && <Botao pequeno onClick={() => abrir(l.id, '?editar=1')}>Editar</Botao>}
                  {['APROVADA', 'ENVIADA', 'PEDIDO', 'SOLICITADA'].includes(l.status) && <Botao pequeno onClick={() => abrir(l.id, '?aba=fornecedor')}>Enviar</Botao>}
                  <Botao pequeno onClick={() => duplicar(l.id)}>Duplicar</Botao>
                  <Botao pequeno onClick={() => abrir(l.id, '?aba=historico')}>Histórico</Botao>
                  {!['PARCIAL', 'RECEBIDA', 'CONCLUIDA', 'CANCELADA'].includes(l.status) && l.recebimentos === 0 && <Botao pequeno perigo onClick={() => cancelar(l.id, l.numero)}>Cancelar</Botao>}
                </div>
              ) },
            ]} />
        )}

        {aba === 'recebimentos' && (
          <Tabela linhas={linhas} carregando={carregando} chave={(l: any) => l.compraId} vazio="Nenhum pedido aguardando ou com recebimento."
            colunas={[
              { chave: 'n', titulo: 'Pedido', render: (l: any) => t(l.numero) },
              { chave: 'f', titulo: 'Fornecedor', render: (l: any) => l.fornecedor },
              { chave: 'nf', titulo: 'Nota fiscal', render: (l: any) => t(l.notaFiscal) },
              { chave: 'd', titulo: 'Último recebimento', render: (l: any) => <span className={s.nowrap}>{fmtData(l.ultimoRecebimento)}</span> },
              { chave: 'r', titulo: 'Responsável', render: (l: any) => t(l.responsavel) },
              { chave: 'q1', titulo: 'Solicitada', num: true, render: (l: any) => fmtQtd(l.solicitada) },
              { chave: 'q2', titulo: 'Recebida', num: true, render: (l: any) => fmtQtd(l.recebida) },
              { chave: 'q3', titulo: 'Pendente', num: true, render: (l: any) => fmtQtd(l.pendente) },
              { chave: 'dv', titulo: 'Divergências', num: true, render: (l: any) => (l.divergencias ? <Selo tom="alerta">{l.divergencias}</Selo> : '—') },
              { chave: 's', titulo: 'Status', render: (l: any) => <Selo tom={TOM_STATUS[l.status]}>{ROTULO_STATUS[l.status] ?? l.status}</Selo> },
              { chave: 'a', titulo: 'Ações', render: (l: any) => <Botao pequeno onClick={() => abrir(l.compraId, '?aba=recebimento')}>{l.pendente > 0 ? 'Conferir / receber' : 'Ver recebimentos'}</Botao> },
            ]} />
        )}

        {aba === 'notas' && (
          <Tabela linhas={linhas} carregando={carregando} chave={(l: any) => l.id} vazio="Nenhuma nota fiscal de entrada vinculada."
            colunas={[
              { chave: 'n', titulo: 'NF-e / série', render: (l: any) => `${l.numero}${l.serie ? `/${l.serie}` : ''}` },
              { chave: 'c', titulo: 'Chave de acesso', render: (l: any) => <span className={s.ajuda}>{t(l.chaveAcesso)}</span> },
              { chave: 'f', titulo: 'Fornecedor', render: (l: any) => l.fornecedor },
              { chave: 'e', titulo: 'Emissão', render: (l: any) => <span className={s.nowrap}>{fmtData(l.dataEmissao, false)}</span> },
              { chave: 'en', titulo: 'Entrada', render: (l: any) => <span className={s.nowrap}>{fmtData(l.dataEntrada, false)}</span> },
              { chave: 'v', titulo: 'Valor', num: true, render: (l: any) => brl(l.valorTotal) },
              { chave: 'p', titulo: 'Pedido', render: (l: any) => t(l.pedido) },
              { chave: 's', titulo: 'Status', render: (l: any) => <Selo tom={l.status === 'CONFERIDA' ? 'ok' : l.status === 'DIVERGENTE' ? 'alerta' : undefined}>{l.status === 'CONFERIDA' ? 'Conferida' : l.status === 'DIVERGENTE' ? 'Divergente' : 'Registrada'}</Selo> },
              { chave: 'x', titulo: 'Anexos', num: true, render: (l: any) => l.anexos },
              { chave: 'a', titulo: 'Ações', render: (l: any) => <Botao pequeno onClick={() => abrir(l.compraId, '?aba=recebimento')}>Abrir</Botao> },
            ]} />
        )}

        {aba === 'historico' && (
          <Tabela linhas={linhas} carregando={carregando} chave={(l: any) => l.id} vazio="Nenhuma operação registrada."
            colunas={[
              { chave: 'd', titulo: 'Data e hora', render: (l: any) => <span className={s.nowrap}>{fmtData(l.data)}</span> },
              { chave: 'p', titulo: 'Pedido', render: (l: any) => (l.compraId ? <button type="button" className={s.botao} style={{ height: 28 }} onClick={() => abrir(l.compraId, '?aba=historico')}>{l.pedido ?? '—'}</button> : '—') },
              { chave: 'f', titulo: 'Fornecedor', render: (l: any) => t(l.fornecedor) },
              { chave: 'e', titulo: 'Operação', render: (l: any) => l.evento },
              { chave: 'u', titulo: 'Usuário', render: (l: any) => t(l.usuario) },
            ]} />
        )}
      </Secao>
    </div>
  );
}
