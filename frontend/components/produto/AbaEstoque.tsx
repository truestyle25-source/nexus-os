'use client';
import { useState } from 'react';
import { Alternador, Aviso, Botao, CampoSelecao, CampoTexto, Grade, Metrica, Modal, Secao, Selo, Tabela, estilos } from './ui';
import type { FormProduto } from './formulario';
import { fichaApi, fmtNum, fmtQtd, lerNumero, mensagemDeErro, TIPOS_MOVIMENTO, type Catalogos, type Ficha, type SaldoFilial } from '@/lib/produto-ficha';

type Props = {
  form: FormProduto; set: <K extends keyof FormProduto>(k: K, v: FormProduto[K]) => void; ficha: Ficha; catalogos: Catalogos;
  podeEditar: boolean; podeMovimentar: boolean; aoAtualizar: () => Promise<void>; avisar: (m: string, erro?: boolean) => void;
};

// Movimentações manuais permitidas aqui. Venda, compra, produção e consumo de insumo nascem nas
// próprias rotinas (PDV/vendas, compras, produção) para ficarem ligadas ao documento de origem.
const TIPOS_MANUAIS = ['ENTRADA', 'SAIDA', 'AJUSTE', 'INVENTARIO', 'PERDA', 'AVARIA', 'DESCARTE', 'DEVOLUCAO'];

function statusFilial(f: SaldoFilial, min: number, max: number) {
  if (!f.vinculado) return <Selo>Desvinculado</Selo>;
  if (f.atual < 0) return <Selo tom="erro">Negativo</Selo>;
  if (f.atual <= min) return <Selo tom="alerta">Abaixo do mínimo</Selo>;
  if (max > 0 && f.atual > max) return <Selo tom="alerta">Acima do máximo</Selo>;
  return <Selo tom="ok">Normal</Selo>;
}

export default function AbaEstoque({ form, set, ficha, catalogos, podeEditar, podeMovimentar, aoAtualizar, avisar }: Props) {
  const ed = podeEditar ? set : undefined;
  const c = ficha.estoque.consolidado;
  const custoVisivel = ficha.podeVerCusto;
  const unidade = catalogos.unidades.find((u) => u.id === form.unidadeBaseId)?.simbolo ?? form.unidade ?? 'UN';
  const minPadrao = lerNumero(form.estoqueMinimo) ?? 0;
  const maxPadrao = lerNumero(form.estoqueMaximo) ?? 0;
  const [modal, setModal] = useState<'mov' | 'transf' | null>(null);
  const [mov, setMov] = useState({ tipo: 'ENTRADA', filialId: ficha.estoque.filiais[0]?.filialId ?? '', quantidade: '', documento: '', motivo: '' });
  const [transf, setTransf] = useState({ origem: ficha.estoque.filiais[0]?.filialId ?? '', destino: ficha.estoque.filiais[1]?.filialId ?? '', quantidade: '', motivo: '', negativo: false });
  const [enviando, setEnviando] = useState(false);
  const filiaisOpc = ficha.estoque.filiais.map((f) => ({ valor: f.filialId, texto: f.filialNome }));
  const saldoDe = (id: string) => ficha.estoque.filiais.find((f) => f.filialId === id)?.atual ?? 0;

  async function enviarMovimento() {
    const q = lerNumero(mov.quantidade);
    if (q === null || q < 0) { avisar('Informe a quantidade.', true); return; }
    setEnviando(true);
    try {
      await fichaApi.movimentar({ produtoId: ficha.produto.id, filialId: mov.filialId, tipo: mov.tipo, quantidade: q, documento: mov.documento.trim() || undefined, motivo: mov.motivo.trim() || undefined });
      setModal(null); setMov((m) => ({ ...m, quantidade: '', documento: '', motivo: '' }));
      await aoAtualizar(); avisar(`${TIPOS_MOVIMENTO[mov.tipo]} registrada.`);
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setEnviando(false); }
  }
  async function enviarTransferencia() {
    const q = lerNumero(transf.quantidade);
    if (!q || q <= 0) { avisar('Informe a quantidade.', true); return; }
    setEnviando(true);
    try {
      await fichaApi.transferir({ produtoId: ficha.produto.id, filialOrigemId: transf.origem, filialDestinoId: transf.destino, quantidade: q, motivo: transf.motivo.trim() || undefined, permitirNegativo: transf.negativo || undefined });
      setModal(null); setTransf((t) => ({ ...t, quantidade: '', motivo: '', negativo: false }));
      await aoAtualizar(); avisar('Transferência registrada.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setEnviando(false); }
  }

  const ajusteAbsoluto = mov.tipo === 'AJUSTE' || mov.tipo === 'INVENTARIO';
  const qMov = lerNumero(mov.quantidade) ?? 0;
  const saldoMov = saldoDe(mov.filialId);
  const previsto = ajusteAbsoluto ? qMov : ['ENTRADA', 'DEVOLUCAO'].includes(mov.tipo) ? saldoMov + qMov : saldoMov - qMov;

  return (
    <>
      <Secao titulo="Saldo consolidado" descricao={`Unidade: ${unidade}. Disponível = atual − reservado (carrinhos do PDV) − comprometido (vendas em aberto).`}
        acoes={podeMovimentar && form.controlaEstoque ? <>
          <Botao onClick={() => setModal('mov')}>Registrar movimentação</Botao>
          <Botao onClick={() => setModal('transf')} desabilitado={ficha.estoque.filiais.length < 2}>Transferir entre filiais</Botao>
        </> : undefined}>
        {!form.controlaEstoque ? (
          <Aviso>Este produto não controla estoque (ex.: serviço): vendas não baixam saldo.</Aviso>
        ) : (
          <MetricasEstoque c={c} custoVisivel={custoVisivel} unidade={unidade} min={minPadrao} />
        )}
      </Secao>

      <Secao titulo="Parâmetros de estoque" descricao="Valores padrão do produto. Mínimo e máximo podem ser ajustados por filial na aba Filial.">
        <Grade>
          <CampoTexto l={2} rotulo="Estoque mínimo" valor={form.estoqueMinimo} onChange={ed && ((v) => ed('estoqueMinimo', v))} numero />
          <CampoTexto l={2} rotulo="Estoque máximo" valor={form.estoqueMaximo} onChange={ed && ((v) => ed('estoqueMaximo', v))} numero />
          <CampoTexto l={2} rotulo="Estoque de segurança" valor={form.estoqueSeguranca} onChange={ed && ((v) => ed('estoqueSeguranca', v))} numero />
          <CampoTexto l={2} rotulo="Estoque ideal" valor={form.estoqueIdeal} onChange={ed && ((v) => ed('estoqueIdeal', v))} numero />
          <CampoTexto l={2} rotulo="Ponto de pedido" valor={form.pontoPedido} onChange={ed && ((v) => ed('pontoPedido', v))} numero />
          <CampoTexto l={2} rotulo="Localização física" valor={form.local} onChange={ed && ((v) => ed('local', v))} maxLength={60} />
          <CampoTexto l={3} rotulo="Densidade" valor={form.densidade} onChange={ed && ((v) => ed('densidade', v))} numero ajuda="kg/L, quando aplicável" />
          <CampoTexto l={3} rotulo="Peso da embalagem (kg)" valor={form.pesoEmbalagem} onChange={ed && ((v) => ed('pesoEmbalagem', v))} numero />
          <Alternador l={3} alinharCampo rotulo="Controlar estoque" ligado={form.controlaEstoque} onChange={ed && ((v) => ed('controlaEstoque', v))} />
          <Alternador l={3} alinharCampo rotulo="Venda com estoque negativo" ligado={form.permiteEstoqueNegativo} onChange={ed && ((v) => ed('permiteEstoqueNegativo', v))} />
          <Alternador l={3} rotulo="Transferência negativa" ajuda="Só com autorização (estoque.administrar)" ligado={form.permiteTransferenciaNegativa} onChange={ed && ((v) => ed('permiteTransferenciaNegativa', v))} />
          <Alternador l={3} rotulo="Venda fracionada" ligado={form.vendaFracionada} onChange={ed && ((v) => ed('vendaFracionada', v))} />
          <Alternador l={3} rotulo="Controle de lote" ligado={form.controlaLote} onChange={ed && ((v) => ed('controlaLote', v))} />
          <Alternador l={3} rotulo="Obrigar controle de vencimento" ligado={form.controlaValidade} onChange={ed && ((v) => ed('controlaValidade', v))} />
        </Grade>
      </Secao>

      <Secao titulo="Estoque por filial" descricao="Cada filial tem o próprio saldo; uma movimentação numa filial nunca altera outra.">
        <Tabela<SaldoFilial>
          linhas={ficha.estoque.filiais} chave={(f) => f.filialId}
          colunas={[
            { chave: 'filial', titulo: 'Filial', render: (f) => f.filialNome, ordenar: (f) => f.filialNome },
            { chave: 'atual', titulo: 'Atual', num: true, render: (f) => fmtQtd(f.atual), ordenar: (f) => f.atual },
            { chave: 'disp', titulo: 'Disponível', num: true, render: (f) => fmtQtd(f.disponivel), ordenar: (f) => f.disponivel },
            { chave: 'res', titulo: 'Reservado', num: true, render: (f) => fmtQtd(f.reservado) },
            { chave: 'comp', titulo: 'Comprometido', num: true, render: (f) => fmtQtd(f.comprometido) },
            { chave: 'min', titulo: 'Mínimo', num: true, render: (f) => fmtQtd(f.estoqueMinimo ?? minPadrao) },
            { chave: 'max', titulo: 'Máximo', num: true, render: (f) => fmtQtd(f.estoqueMaximo ?? maxPadrao) },
            ...(custoVisivel ? [{ chave: 'custo', titulo: 'Custo', num: true, render: (f: SaldoFilial) => fmtNum(f.custo ?? lerNumero(form.custo)) }] : []),
            { chave: 'preco', titulo: 'Preço de venda', num: true, render: (f) => fmtNum(f.precoVenda ?? lerNumero(form.precoVenda)) },
            { chave: 'local', titulo: 'Local', render: (f) => f.local ?? '—' },
            { chave: 'status', titulo: 'Status', render: (f) => statusFilial(f, f.estoqueMinimo ?? minPadrao, f.estoqueMaximo ?? maxPadrao) },
          ]}
        />
      </Secao>

      {modal === 'mov' && (
        <Modal titulo="Registrar movimentação" aoFechar={() => setModal(null)}
          acoes={<><Botao onClick={() => setModal(null)}>Cancelar</Botao><Botao primario desabilitado={enviando} onClick={enviarMovimento}>{enviando ? 'Registrando…' : 'Registrar'}</Botao></>}>
          <Grade>
            <CampoSelecao l={6} rotulo="Tipo" valor={mov.tipo} onChange={(v) => setMov({ ...mov, tipo: v })} opcoes={TIPOS_MANUAIS.map((t) => ({ valor: t, texto: TIPOS_MOVIMENTO[t] }))} />
            <CampoSelecao l={6} rotulo="Filial" valor={mov.filialId} onChange={(v) => setMov({ ...mov, filialId: v })} opcoes={filiaisOpc} />
            <CampoTexto l={6} rotulo={ajusteAbsoluto ? 'Novo saldo (contado)' : 'Quantidade'} valor={mov.quantidade} onChange={(v) => setMov({ ...mov, quantidade: v })} numero
              ajuda={`Saldo atual ${fmtQtd(saldoMov)} → ${fmtQtd(previsto)} ${unidade}`} erro={previsto < 0 && !form.permiteEstoqueNegativo ? 'O saldo ficaria negativo.' : undefined} />
            <CampoTexto l={6} rotulo="Documento de origem" valor={mov.documento} onChange={(v) => setMov({ ...mov, documento: v })} maxLength={80} placeholder="Nº da nota, ordem…" />
            <CampoTexto l={12} rotulo="Observação" valor={mov.motivo} onChange={(v) => setMov({ ...mov, motivo: v })} maxLength={200} />
          </Grade>
        </Modal>
      )}
      {modal === 'transf' && (
        <Modal titulo="Transferir entre filiais" aoFechar={() => setModal(null)}
          acoes={<><Botao onClick={() => setModal(null)}>Cancelar</Botao><Botao primario desabilitado={enviando || transf.origem === transf.destino} onClick={enviarTransferencia}>{enviando ? 'Transferindo…' : 'Transferir'}</Botao></>}>
          <Grade>
            <CampoSelecao l={6} rotulo="Origem" valor={transf.origem} onChange={(v) => setTransf({ ...transf, origem: v })} opcoes={filiaisOpc} ajuda={`Saldo: ${fmtQtd(saldoDe(transf.origem))}`} />
            <CampoSelecao l={6} rotulo="Destino" valor={transf.destino} onChange={(v) => setTransf({ ...transf, destino: v })} opcoes={filiaisOpc} erro={transf.origem === transf.destino ? 'Escolha filiais diferentes.' : undefined} />
            <CampoTexto l={6} rotulo="Quantidade" valor={transf.quantidade} onChange={(v) => setTransf({ ...transf, quantidade: v })} numero />
            {form.permiteTransferenciaNegativa && <Alternador l={6} rotulo="Autorizar origem negativa" ligado={transf.negativo} onChange={(v) => setTransf({ ...transf, negativo: v })} ajuda="Exige estoque.administrar" />}
            <CampoTexto l={12} rotulo="Observação" valor={transf.motivo} onChange={(v) => setTransf({ ...transf, motivo: v })} maxLength={200} />
          </Grade>
        </Modal>
      )}
    </>
  );
}

function MetricasEstoque({ c, custoVisivel, unidade, min }: { c: Ficha['estoque']['consolidado']; custoVisivel: boolean; unidade: string; min: number }) {
  return (
    <div className={estilos.metricas}>
        <Metrica rotulo="Atual" valor={`${fmtQtd(c.atual)} ${unidade}`} ajuda={c.atual <= min ? 'No mínimo ou abaixo' : undefined} />
        <Metrica rotulo="Disponível" valor={fmtQtd(c.disponivel)} />
        <Metrica rotulo="Reservado" valor={fmtQtd(c.reservado)} ajuda="Carrinhos do PDV" />
        <Metrica rotulo="Comprometido" valor={fmtQtd(c.comprometido)} ajuda="Vendas em aberto" />
        {custoVisivel && <Metrica rotulo="Valor em estoque" valor={`R$ ${fmtNum(c.valorTotal ?? 0)}`} />}
    </div>
  );
}
