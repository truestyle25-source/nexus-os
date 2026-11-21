'use client';
import { useEffect, useState } from 'react';
import { Aviso, Botao, CampoTexto, Grade, Secao, Selo, Tabela, estilos } from './ui';
import { fichaApi, fmtNum, fmtQtd, lerNumero, mensagemDeErro, type Ficha, type SaldoFilial } from '@/lib/produto-ficha';

type Linha = SaldoFilial & { ePreco: string; eCusto: string; eMin: string; eMax: string; eVinculado: boolean; eDisponivel: boolean };
const t = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

export default function AbaFilial({ ficha, podeEditar, aoAtualizar, avisar, aoAlterar }: { ficha: Ficha; podeEditar: boolean; aoAtualizar: () => Promise<void>; avisar: (m: string, erro?: boolean) => void; aoAlterar: (sujo: boolean) => void }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const l = await fichaApi.filiais(ficha.produto.id);
      setLinhas(l.map((f) => ({ ...f, ePreco: t(f.precoVenda), eCusto: t(f.custo), eMin: t(f.estoqueMinimo), eMax: t(f.estoqueMaximo), eVinculado: f.vinculado, eDisponivel: f.disponivelVenda })));
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setCarregando(false); }
  }
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ficha.produto.id]);

  const alteradas = linhas.filter((l) => l.ePreco !== t(l.precoVenda) || l.eCusto !== t(l.custo) || l.eMin !== t(l.estoqueMinimo) || l.eMax !== t(l.estoqueMaximo) || l.eVinculado !== l.vinculado || l.eDisponivel !== l.disponivelVenda);
  useEffect(() => { aoAlterar(alteradas.length > 0); }, [alteradas.length, aoAlterar]);
  const muda = (id: string, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.filialId === id ? { ...l, ...patch } : l)));

  async function salvar() {
    setSalvando(true);
    try {
      const filiais = alteradas.map((l) => ({
        filialId: l.filialId,
        ...(l.eVinculado !== l.vinculado ? { ativo: l.eVinculado } : {}),
        ...(l.eDisponivel !== l.disponivelVenda ? { disponivelVenda: l.eDisponivel } : {}),
        ...(l.ePreco !== t(l.precoVenda) ? { precoVenda: lerNumero(l.ePreco) } : {}),
        ...(ficha.podeVerCusto && l.eCusto !== t(l.custo) ? { custo: lerNumero(l.eCusto) } : {}),
        ...(l.eMin !== t(l.estoqueMinimo) ? { estoqueMinimo: lerNumero(l.eMin) } : {}),
        ...(l.eMax !== t(l.estoqueMaximo) ? { estoqueMaximo: lerNumero(l.eMax) } : {}),
      }));
      await fichaApi.salvarFiliais(ficha.produto.id, filiais, justificativa.trim() || undefined);
      setJustificativa('');
      await Promise.all([carregar(), aoAtualizar()]);
      avisar('Configuração das filiais salva.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }

  const entrada = (valor: string, on: (v: string) => void, rotulo: string) => (
    <input className={`${estilos.entrada} ${estilos.entradaNumero} ${estilos.entradaTabela}`} value={valor} inputMode="decimal" aria-label={rotulo} readOnly={!podeEditar} onChange={(e) => on(e.target.value)} placeholder="Padrão" />
  );
  const chave = (rotulo: string, ligado: boolean, on: (v: boolean) => void) => (
    <input type="checkbox" checked={ligado} disabled={!podeEditar} aria-label={rotulo} onChange={(e) => on(e.target.checked)} />
  );

  return (
    <Secao titulo="Filiais" descricao="Vínculo, disponibilidade, preço e limites por filial. Campo vazio = usa o padrão do produto. Preço e disponibilidade valem no PDV e nas vendas."
      acoes={podeEditar ? <>
        <Botao onClick={() => setLinhas((ls) => ls.map((l) => ({ ...l, eVinculado: true, eDisponivel: true })))}>Vincular todas</Botao>
        <Botao primario desabilitado={!alteradas.length || salvando} onClick={salvar}>{salvando ? 'Salvando…' : `Salvar filiais${alteradas.length ? ` (${alteradas.length})` : ''}`}</Botao>
      </> : undefined}>
      <Tabela<Linha>
        linhas={linhas} carregando={carregando} chave={(l) => l.filialId}
        colunas={[
          { chave: 'filial', titulo: 'Filial', render: (l) => <span className={estilos.nowrap}>{l.filialNome}{l.filialStatus !== 'ATIVO' ? ' (inativa)' : ''}</span> },
          { chave: 'vinc', titulo: 'Vinculado', render: (l) => chave(`Vinculado em ${l.filialNome}`, l.eVinculado, (v) => muda(l.filialId, { eVinculado: v })) },
          { chave: 'disp', titulo: 'Disp. venda', render: (l) => chave(`Disponível para venda em ${l.filialNome}`, l.eDisponivel, (v) => muda(l.filialId, { eDisponivel: v })) },
          { chave: 'preco', titulo: `Preço (padrão ${fmtNum(Number(ficha.produto.precoVenda))})`, render: (l) => entrada(l.ePreco, (v) => muda(l.filialId, { ePreco: v }), `Preço em ${l.filialNome}`) },
          ...(ficha.podeVerCusto ? [{ chave: 'custo', titulo: 'Custo', render: (l: Linha) => entrada(l.eCusto, (v) => muda(l.filialId, { eCusto: v }), `Custo em ${l.filialNome}`) }] : []),
          { chave: 'min', titulo: 'Est. mínimo', render: (l) => entrada(l.eMin, (v) => muda(l.filialId, { eMin: v }), `Mínimo em ${l.filialNome}`) },
          { chave: 'max', titulo: 'Est. máximo', render: (l) => entrada(l.eMax, (v) => muda(l.filialId, { eMax: v }), `Máximo em ${l.filialNome}`) },
          { chave: 'saldo', titulo: 'Saldo', num: true, render: (l) => fmtQtd(l.atual) },
          { chave: 'status', titulo: 'Status', render: (l) => (!l.eVinculado ? <Selo>Desvinculado</Selo> : !l.eDisponivel ? <Selo tom="alerta">Sem venda</Selo> : <Selo tom="ok">Ativo</Selo>) },
        ]}
      />
      {podeEditar && alteradas.some((l) => l.ePreco !== t(l.precoVenda)) && (
        <div className={estilos.espaco4}>
          <Grade><CampoTexto l={12} rotulo="Justificativa da alteração de preço (opcional)" valor={justificativa} onChange={setJustificativa} maxLength={300} /></Grade>
        </div>
      )}
      <div className={estilos.espaco3}>
        <Aviso>Desvincular uma filial exige a permissão produtos.administrar e saldo zerado nela. Transfira ou ajuste o saldo antes.</Aviso>
      </div>
    </Secao>
  );
}
