'use client';
import { useCallback, useEffect, useState } from 'react';
import { Aviso, Botao, Secao, Tabela, cx, estilos } from './ui';
import { baixarBase64, fichaApi, fmtData, fmtNum, fmtQtd, mensagemDeErro, TIPOS_MOVIMENTO, type Catalogos, type Ficha } from '@/lib/produto-ficha';

type Sub = 'entrada' | 'saida' | 'cupom' | 'manual' | 'servico' | 'movimentacao' | 'precos' | 'cadastro';
const SUBABAS: Array<[Sub, string]> = [
  ['entrada', 'Nota de entrada'], ['saida', 'Nota de saída'], ['cupom', 'Cupom'], ['manual', 'Nota manual'], ['servico', 'Nota de serviço'],
  ['movimentacao', 'Histórico de movimentação'], ['precos', 'Histórico de preços'], ['cadastro', 'Histórico de cadastro'],
];
const CAMPOS_PRECO: Record<string, string> = { PRECO_VENDA: 'Preço de venda', CUSTO: 'Custo', PRECO_COMPRA: 'Preço de compra', TABELA_A: 'Tabela A', TABELA_B: 'Tabela B', TABELA_C: 'Tabela C', PRECO_FILIAL: 'Preço da filial' };
const LIMITE = 25;

export default function AbaMovimento({ ficha, catalogos, podeVerEstoque, avisar }: { ficha: Ficha; catalogos: Catalogos; podeVerEstoque: boolean; avisar: (m: string, erro?: boolean) => void }) {
  const id = ficha.produto.id;
  const [sub, setSub] = useState<Sub>('movimentacao');
  const [filtro, setFiltro] = useState({ inicio: '', fim: '', filialId: '', tipo: '', fornecedorId: '', documento: '' });
  const [aplicado, setAplicado] = useState(filtro);
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<{ itens: any[]; total: number; aviso?: string }>({ itens: [], total: 0 });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const comuns = { inicio: aplicado.inicio, fim: aplicado.fim, filialId: aplicado.filialId, pagina, limite: LIMITE };
      if (sub === 'movimentacao') setDados(await fichaApi.movimentacoes(id, { ...comuns, tipo: aplicado.tipo, documento: aplicado.documento }));
      else if (sub === 'precos') { const l = await fichaApi.historicoPrecos(id); setDados({ itens: l, total: l.length }); }
      else if (sub === 'cadastro') { const l = await fichaApi.historicoCadastro(id); setDados({ itens: l, total: l.length }); }
      else setDados(await fichaApi.documentos(id, { ...comuns, tipo: sub, fornecedorId: sub === 'entrada' ? aplicado.fornecedorId : undefined }));
    } catch (e) { setErro(mensagemDeErro(e)); setDados({ itens: [], total: 0 }); } finally { setCarregando(false); }
  }, [id, sub, aplicado, pagina]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function exportar(formato: 'xlsx' | 'pdf') {
    try {
      const r = await fichaApi.exportar(id, { formato, inicio: aplicado.inicio, fim: aplicado.fim, filialId: aplicado.filialId, tipo: aplicado.tipo, documento: aplicado.documento });
      baixarBase64(r.nome, r.mime, r.base64);
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  const usaFiltros = sub !== 'precos' && sub !== 'cadastro' && sub !== 'servico';
  const documentos = ['entrada', 'saida', 'cupom', 'manual', 'servico'].includes(sub);

  return (
    <Secao titulo="Movimento" descricao="Consulta histórica do produto, direto do banco."
      acoes={sub === 'movimentacao' && podeVerEstoque ? <><Botao onClick={() => exportar('xlsx')}>Exportar Excel</Botao><Botao onClick={() => exportar('pdf')}>Exportar PDF</Botao></> : undefined}>
      <div className={cx(estilos.subabas, estilos.espacoAbaixo)} role="tablist" aria-label="Tipo de consulta">
        {SUBABAS.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} className={cx(estilos.subaba, sub === k && estilos.subabaAtiva)}
            onClick={() => { setSub(k); setPagina(1); }}>{t}</button>
        ))}
      </div>

      {usaFiltros && (
        <div className={estilos.filtros}>
          <Filtro rotulo="Data inicial"><input type="date" className={estilos.entrada} value={filtro.inicio} onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} /></Filtro>
          <Filtro rotulo="Data final"><input type="date" className={estilos.entrada} value={filtro.fim} onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} /></Filtro>
          <Filtro rotulo="Filial">
            <select className={estilos.entrada} value={filtro.filialId} onChange={(e) => setFiltro({ ...filtro, filialId: e.target.value })}>
              <option value="">Todas</option>{catalogos.filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </Filtro>
          {sub === 'movimentacao' && (
            <>
              <Filtro rotulo="Tipo">
                <select className={estilos.entrada} value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })}>
                  <option value="">Todos</option>{Object.entries(TIPOS_MOVIMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Filtro>
              <Filtro rotulo="Documento"><input className={estilos.entrada} value={filtro.documento} onChange={(e) => setFiltro({ ...filtro, documento: e.target.value })} /></Filtro>
            </>
          )}
          {sub === 'entrada' && (
            <Filtro rotulo="Fornecedor">
              <select className={estilos.entrada} value={filtro.fornecedorId} onChange={(e) => setFiltro({ ...filtro, fornecedorId: e.target.value })}>
                <option value="">Todos</option>{catalogos.fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Filtro>
          )}
          <div><Botao primario onClick={() => { setAplicado(filtro); setPagina(1); }}>Filtrar</Botao></div>
        </div>
      )}

      {erro && <div className={estilos.espacoAbaixo}><Aviso tom="erro">{erro}</Aviso></div>}
      {dados.aviso && <div className={estilos.espacoAbaixo}><Aviso>{dados.aviso}</Aviso></div>}

      {documentos && (
        <Tabela
          linhas={dados.itens} carregando={carregando} chave={(l: any, i) => `${l.documento}-${i}`} vazio="Nenhum documento no período."
          paginacao={{ pagina, limite: LIMITE, total: dados.total, onPagina: setPagina }}
          colunas={[
            { chave: 'doc', titulo: 'Documento', render: (l: any) => <span className={estilos.nowrap} title={l.documento}>{String(l.documento ?? '—').slice(0, 14)}</span> },
            { chave: 'modelo', titulo: 'Modelo', render: (l: any) => l.modelo },
            { chave: 'parceiro', titulo: sub === 'entrada' ? 'Fornecedor' : sub === 'manual' ? 'Usuário' : 'Cliente', render: (l: any) => l.parceiro ?? '—' },
            { chave: 'filial', titulo: 'Filial', render: (l: any) => l.filial ?? '—' },
            { chave: 'entrada', titulo: 'Data de entrada', render: (l: any) => fmtData(l.dataEntrada) },
            { chave: 'emissao', titulo: 'Data de emissão', render: (l: any) => fmtData(l.dataEmissao) },
            { chave: 'qtd', titulo: 'Quantidade', num: true, render: (l: any) => `${fmtQtd(l.quantidade)}${l.unidade ? ` ${l.unidade}` : ''}` },
            { chave: 'total', titulo: 'Valor total', num: true, render: (l: any) => (l.valorTotal == null ? '—' : `R$ ${fmtNum(l.valorTotal)}`) },
            { chave: 'status', titulo: 'Situação', render: (l: any) => l.status ?? '—' },
          ]}
        />
      )}

      {sub === 'movimentacao' && (
        <Tabela
          linhas={dados.itens} carregando={carregando} chave={(l: any) => l.id} vazio="Nenhuma movimentação no período."
          paginacao={{ pagina, limite: LIMITE, total: dados.total, onPagina: setPagina }}
          colunas={[
            { chave: 'data', titulo: 'Data e hora', render: (l: any) => <span className={estilos.nowrap}>{fmtData(l.data)}</span> },
            { chave: 'tipo', titulo: 'Tipo', render: (l: any) => TIPOS_MOVIMENTO[l.tipo] ?? l.tipo },
            { chave: 'filial', titulo: 'Filial', render: (l: any) => l.filial + (l.filialDestino ? ` ⇄ ${l.filialDestino}` : '') },
            { chave: 'qtd', titulo: 'Quantidade', num: true, render: (l: any) => (l.quantidade > 0 ? '+' : '') + fmtQtd(l.quantidade) },
            { chave: 'ant', titulo: 'Saldo anterior', num: true, render: (l: any) => fmtQtd(l.saldoAnterior) },
            { chave: 'pos', titulo: 'Saldo posterior', num: true, render: (l: any) => fmtQtd(l.saldoPosterior) },
            ...(ficha.podeVerCusto ? [{ chave: 'custo', titulo: 'Custo unit.', num: true, render: (l: any) => fmtNum(l.custoUnitario) }] : []),
            { chave: 'doc', titulo: 'Documento', render: (l: any) => <span title={l.documento ?? ''}>{l.documento ? String(l.documento).slice(0, 18) : '—'}</span> },
            { chave: 'usuario', titulo: 'Usuário', render: (l: any) => l.usuario ?? '—' },
            { chave: 'obs', titulo: 'Observação', render: (l: any) => l.motivo ?? '—' },
          ]}
        />
      )}

      {sub === 'precos' && (
        <Tabela
          linhas={dados.itens} carregando={carregando} chave={(l: any) => l.id} vazio="Nenhuma alteração de preço registrada." pesquisa={(l: any) => `${CAMPOS_PRECO[l.campo]} ${l.usuario ?? ''} ${l.justificativa ?? ''}`}
          colunas={[
            { chave: 'data', titulo: 'Data e hora', render: (l: any) => fmtData(l.data), ordenar: (l: any) => l.data },
            { chave: 'campo', titulo: 'Preço', render: (l: any) => CAMPOS_PRECO[l.campo] ?? l.campo, ordenar: (l: any) => l.campo },
            { chave: 'ant', titulo: 'Anterior', num: true, render: (l: any) => fmtNum(l.valorAnterior) },
            { chave: 'novo', titulo: 'Novo', num: true, render: (l: any) => fmtNum(l.valorNovo) },
            { chave: 'filial', titulo: 'Filial', render: (l: any) => l.filial ?? 'Todas' },
            { chave: 'usuario', titulo: 'Usuário', render: (l: any) => l.usuario ?? (l.origem === 'COMPRA' ? 'Recebimento de compra' : '—') },
            { chave: 'just', titulo: 'Justificativa', render: (l: any) => l.justificativa ?? '—' },
          ]}
        />
      )}

      {sub === 'cadastro' && (
        <Tabela
          linhas={dados.itens} carregando={carregando} chave={(l: any) => l.id} vazio="Sem histórico de cadastro." pesquisa={(l: any) => `${l.usuario ?? ''} ${l.contexto ?? ''} ${l.campos.map((c: any) => c.campo).join(' ')}`}
          colunas={[
            { chave: 'data', titulo: 'Data e hora', render: (l: any) => fmtData(l.data), ordenar: (l: any) => l.data },
            { chave: 'acao', titulo: 'Ação', render: (l: any) => l.acao },
            { chave: 'usuario', titulo: 'Usuário', render: (l: any) => l.usuario ?? '—' },
            { chave: 'onde', titulo: 'Origem', render: (l: any) => l.contexto ?? 'Cadastro' },
            { chave: 'campos', titulo: 'Campos alterados', render: (l: any) => (l.campos.length ? l.campos.map((c: any) => c.campo).join(', ') : '—') },
          ]}
        />
      )}
    </Secao>
  );
}

function Filtro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <label className={estilos.campo}><span className={estilos.rotulo}>{rotulo}</span>{children}</label>;
}
