'use client';
// Abas da ficha de compra: Dados da compra, Produtos, Fornecedor, Financeiro, Recebimento e Histórico.
// Usa os componentes e tokens das fichas de Produtos/Fornecedores (mesmo visual do NEXUS OS).
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { Aviso, Botao, CampoArea, CampoSelecao, CampoTexto, Celula, Grade, Metrica, Modal, Secao, Selo, Tabela, estilos as s } from '@/components/produto/ui';
import { baixarBase64, fmtData, fmtNum, fmtQtd, lerNumero, mensagemDeErro } from '@/lib/produto-ficha';
import { ROTULO_STATUS, calcularTotais, compraApi, novaChave, type FichaCompra, type Painel } from '@/lib/compra-ficha';
import { itensApi, type FormCompra, type ItemForm } from './formulario';
import f from '@/components/fornecedor/fornecedor.module.css';

type Set = <K extends keyof FormCompra>(k: K, v: FormCompra[K]) => void;
type Avisar = (m: string, erro?: boolean) => void;
export interface PropsAba { form: FormCompra; set: Set; ed: boolean; edValores: boolean; painel: Painel; ficha: FichaCompra | null; avisar: Avisar; aoAtualizar: (fi?: FichaCompra) => Promise<void> }
const brl = (v: number | null | undefined, c = 2) => (v == null ? '—' : `R$ ${fmtNum(v, c)}`);
const t = (v: string | null | undefined) => v || '—';
const on = (ed: boolean, fn: (v: string) => void) => (ed ? fn : undefined);
const PRIORIDADES = [{ valor: 'BAIXA', texto: 'Baixa' }, { valor: 'NORMAL', texto: 'Normal' }, { valor: 'ALTA', texto: 'Alta' }, { valor: 'URGENTE', texto: 'Urgente' }];
const CONDICOES = ['À vista', '7 dias', '14 dias', '21 dias', '28 dias', '30 dias', '30/60', '30/60/90', '45 dias', '60 dias'];
const FORMAS = [{ valor: 'BOLETO', texto: 'Boleto' }, { valor: 'PIX', texto: 'PIX' }, { valor: 'TRANSFERENCIA', texto: 'Transferência' }, { valor: 'CARTAO', texto: 'Cartão' }, { valor: 'DINHEIRO', texto: 'Dinheiro' }, { valor: 'OUTRO', texto: 'Outro' }];

export function useTotais(form: FormCompra) {
  return useMemo(() => calcularTotais(form.itens.map((i) => ({ quantidade: lerNumero(i.quantidade) ?? 0, valorUnit: lerNumero(i.valorUnit) ?? 0, desconto: lerNumero(i.desconto) ?? 0 })),
    lerNumero(form.desconto) ?? 0, lerNumero(form.frete) ?? 0, lerNumero(form.outrasDespesas) ?? 0), [form.itens, form.desconto, form.frete, form.outrasDespesas]);
}

function lerArquivo(arquivo: File) {
  return new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => erro(r.error); r.readAsDataURL(arquivo); });
}

// ============================================================================ 1. DADOS DA COMPRA
export function AbaDados({ form, set, ed, edValores, painel, ficha, avisar, aoAtualizar }: PropsAba) {
  const tot = useTotais(form);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const c = ficha?.compra;
  async function anexar() {
    if (!ficha || !arquivo) return;
    try { await compraApi.anexar(ficha.compra.id, { arquivo: { nome: arquivo.name, base64: await lerArquivo(arquivo) } }); setArquivo(null); await aoAtualizar(); avisar('Documento anexado.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function baixar(id: string) { try { const r = await compraApi.baixar(ficha!.compra.id, id); baixarBase64(r.nome, r.mime, r.base64); } catch (e) { avisar(mensagemDeErro(e), true); } }
  const anexos = ficha?.documentos.filter((d) => d.entidadeTipo === 'Compra') ?? [];
  const proximo: Record<string, string> = {
    RASCUNHO: ficha?.exigeAprovacao ? 'enviar para aprovação.' : 'aprovar o pedido e enviá-lo ao fornecedor.', SOLICITADA: 'aprovar/enviar ao fornecedor ou registrar a confirmação.',
    AGUARDANDO_APROVACAO: 'aprovação por quem tem compras.administrar.', APROVADA: 'enviar o pedido ao fornecedor (aba Fornecedor).', ENVIADA: 'registrar a confirmação do fornecedor.',
    PEDIDO: 'conferir a mercadoria e confirmar o recebimento (aba Recebimento).', PARCIAL: 'receber o saldo pendente ou concluir o pedido.', RECEBIDA: 'concluir o pedido.',
  };
  return (
    <>
      <div className={f.duasColunas}>
        <Secao titulo="Informações da compra">
          <Grade>
            <CampoTexto l={3} rotulo="Número da compra" valor={c?.numeroExibido ?? 'Automático'} somenteLeitura />
            <CampoTexto l={3} rotulo="Data da compra" tipo="date" valor={form.dataCompra} onChange={on(ed, (v) => set('dataCompra', v))} />
            <CampoTexto l={3} rotulo="Status" valor={c ? ROTULO_STATUS[c.status] ?? c.status : 'Rascunho'} somenteLeitura />
            <CampoSelecao l={3} rotulo="Prioridade" valor={form.prioridade} onChange={on(ed, (v) => set('prioridade', v))} opcoes={PRIORIDADES} />
            <CampoTexto l={3} rotulo="Empresa" valor={painel.empresa?.nome ?? '—'} somenteLeitura />
            <CampoSelecao l={3} rotulo="Filial" valor={form.filialId} onChange={on(edValores, (v) => set('filialId', v))} vazio="Selecione" opcoes={painel.filiais.map((x) => ({ valor: x.id, texto: x.nome }))} />
            <CampoSelecao l={3} rotulo="Responsável" valor={form.responsavelId} onChange={on(ed, (v) => set('responsavelId', v))} vazio="—" opcoes={painel.responsaveis.map((x) => ({ valor: x.id, texto: x.nome }))} />
            <CampoTexto l={3} rotulo="Previsão de entrega" tipo="date" valor={form.previsaoEntrega} onChange={on(ed, (v) => set('previsaoEntrega', v))} />
            <CampoSelecao l={4} rotulo="Condição de pagamento" valor={form.condPagamento} onChange={on(ed, (v) => set('condPagamento', v))} vazio="—" opcoes={[...new Set([...CONDICOES, form.condPagamento].filter(Boolean))].map((v) => ({ valor: v, texto: v }))} />
            <CampoArea l={4} rotulo="Observações internas" valor={form.observacoes} onChange={on(ed, (v) => set('observacoes', v))} maxLength={4000} />
            <CampoArea l={4} rotulo="Observações para o fornecedor" valor={form.observacoesFornecedor} onChange={on(ed, (v) => set('observacoesFornecedor', v))} maxLength={2000} />
          </Grade>
        </Secao>
        <Secao titulo="Totais da compra">
          <div className={s.coluna} style={{ gap: 8 }}>
            {[['Valor dos produtos', tot.produtos], ['Descontos', -(lerNumero(form.desconto) ?? 0)], ['Frete', lerNumero(form.frete) ?? 0], ['Outros custos', lerNumero(form.outrasDespesas) ?? 0]].map(([r, v]) => (
              <div key={r as string} style={{ display: 'flex', justifyContent: 'space-between' }}><span className={s.ajuda} style={{ fontSize: 13 }}>{r}</span><span className={s.num}>{brl(v as number)}</span></div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--nx-border)', paddingTop: 8 }}><strong>Total da compra</strong><strong className={s.num} style={{ color: 'var(--nx-accent)', fontSize: 18 }}>{brl(tot.total)}</strong></div>
            <span className={s.ajuda}>{form.itens.length} item(ns)</span>
          </div>
        </Secao>
      </div>
      <div className={f.tresColunas}>
        <Secao titulo="Anexos e documentos" descricao="PDF, imagem ou planilha, até 10 MB (armazenamento privado).">
          {!ficha ? <Aviso>Salve a compra para anexar documentos.</Aviso> : !ficha.storageConfigurado ? <Aviso tom="erro">Armazenamento de arquivos não configurado no servidor (STORAGE_BUCKET).</Aviso> : (
            <Grade>
              <Celula l={8}><input className={s.entrada} type="file" aria-label="Arquivo" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} style={{ paddingTop: 6 }} /></Celula>
              <Celula l={4}><Botao primario desabilitado={!arquivo} onClick={anexar}>Anexar</Botao></Celula>
            </Grade>
          )}
          {anexos.length > 0 && <div className={s.espaco3}>{anexos.map((d) => <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{d.nome}</span><Botao pequeno onClick={() => baixar(d.id)}>Baixar</Botao></div>)}</div>}
        </Secao>
        <Secao titulo="Aprovação">
          {c?.aprovadoEm ? <Aviso tom="ok">Aprovado por {c.aprovadoPor ?? '—'} em {fmtData(c.aprovadoEm)}.</Aviso> : <Aviso>{ficha?.exigeAprovacao ? 'A empresa exige aprovação antes do envio (compras.administrar).' : 'A empresa não exige aprovação: o pedido pode ser aprovado por quem o edita.'}</Aviso>}
        </Secao>
        <Secao titulo="Informações adicionais">
          <Aviso>{c ? `Próximo passo: ${proximo[c.status] ?? (c.status === 'CANCELADA' ? `pedido cancelado${c.motivoCancelamento ? ` (${c.motivoCancelamento})` : ''}.` : 'nenhum — pedido encerrado.')}` : 'Preencha os dados, adicione os produtos e salve.'}</Aviso>
          <div className={s.espaco3}><Aviso tom="ok">O pedido não movimenta o estoque. Só o recebimento confirmado dá entrada.</Aviso></div>
        </Secao>
      </div>
    </>
  );
}

// ============================================================================ 2. PRODUTOS
export function AbaProdutos({ form, set, edValores, painel, ficha, avisar }: PropsAba) {
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [candidatos, setCandidatos] = useState<any[]>([]);
  const [categorias, setCategorias] = useState<Array<{ id: string; nome: string }>>([]);
  const [filtro, setFiltro] = useState('');
  const tot = useTotais(form);
  useEffect(() => {
    if (!buscando) return;
    const h = setTimeout(async () => {
      try {
        const r = await api.get<{ produtos: any[] }>('/produtos', { params: { search: termo || undefined, categoriaId: categoria || undefined, status: 'ATIVO', take: 30, sortBy: 'nome', sortOrder: 'asc' } });
        setCandidatos(r.data.produtos);
        if (!categorias.length) setCategorias([...new Map(r.data.produtos.filter((p) => p.categoria).map((p) => [p.categoria.id, p.categoria])).values()]);
      } catch (e) { avisar(mensagemDeErro(e), true); }
    }, 250);
    return () => clearTimeout(h);
  }, [buscando, termo, categoria, avisar, categorias.length]);
  const muda = (idx: number, patch: Partial<ItemForm>) => set('itens', form.itens.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  function adicionar(p: any) {
    if (form.itens.some((i) => i.produtoId === p.id)) { avisar(`${p.nome} já está no pedido: ajuste a quantidade.`, true); return; }
    set('itens', [...form.itens, { produtoId: p.id, codigo: p.sku, nome: p.nome, quantidade: '1', unidade: p.unidade || 'UN', valorUnit: p.precoCompra != null ? String(p.precoCompra).replace('.', ',') : p.custo != null ? String(Number(p.custo)).replace('.', ',') : '', desconto: '', observacao: '', custoAtual: p.custo != null ? Number(p.custo) : undefined, unidadeBase: p.unidade }]);
    avisar(`${p.nome} adicionado.`);
  }
  const itensFicha = new Map((ficha?.itens ?? []).map((i) => [i.produtoId, i]));
  const visiveis = form.itens.map((i, idx) => ({ ...i, idx })).filter((i) => !filtro || `${i.nome} ${i.codigo ?? ''}`.toLowerCase().includes(filtro.toLowerCase()));
  const forn = painel.fornecedores.find((x) => x.id === form.fornecedorId);
  return (
    <>
      <Secao titulo="Produtos da compra" descricao="Produtos do cadastro central (nenhum catálogo paralelo). A quantidade é na unidade de compra; a entrada no estoque é convertida para a unidade do produto."
        acoes={<>
          <input className={s.entrada} style={{ width: 220 }} placeholder="Pesquisar produto…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar itens" />
          {edValores && <Botao primario onClick={() => { setTermo(''); setBuscando(true); }}>+ Adicionar produto</Botao>}
        </>}>
        {!edValores && ficha && <div className={s.espacoAbaixo}><Aviso>Itens e valores ficam travados depois da aprovação ({ROTULO_STATUS[ficha.compra.status]}).</Aviso></div>}
        <Tabela linhas={visiveis} chave={(i) => i.produtoId} vazio={edValores ? 'Nenhum produto. Use “+ Adicionar produto”.' : 'Nenhum produto.'}
          colunas={[
            { chave: 'c', titulo: 'Código', render: (i) => <span className={s.nowrap}>{t(i.codigo)}</span> },
            { chave: 'p', titulo: 'Produto', render: (i) => <div style={{ minWidth: 180 }}><div>{i.nome}</div>{i.custoAtual != null && <div className={s.ajuda}>Custo atual {brl(i.custoAtual, 4)}{i.ultimoPreco != null ? ` · último do fornecedor ${brl(i.ultimoPreco, 4)}` : ''}</div>}</div> },
            { chave: 'f', titulo: 'Fornecedor', render: () => <span className={s.nowrap}>{forn?.nomeFantasia ?? forn?.nome ?? '—'}</span> },
            { chave: 'q', titulo: 'Quantidade', render: (i) => <input className={`${s.entrada} ${s.entradaNumero} ${s.entradaTabela}`} value={i.quantidade} readOnly={!edValores} inputMode="decimal" aria-label={`Quantidade de ${i.nome}`} onChange={(e) => muda(i.idx, { quantidade: e.target.value })} /> },
            { chave: 'u', titulo: 'Unidade', render: (i) => <input className={`${s.entrada} ${s.entradaTabela}`} style={{ minWidth: 70 }} value={i.unidade} readOnly={!edValores} maxLength={10} aria-label={`Unidade de ${i.nome}`} onChange={(e) => muda(i.idx, { unidade: e.target.value })} title="Símbolo da unidade de compra (ex.: kg, CX, UN). Conversão só com regra cadastrada no produto." /> },
            { chave: 'v', titulo: 'Valor unitário', render: (i) => <input className={`${s.entrada} ${s.entradaNumero} ${s.entradaTabela}`} value={i.valorUnit} readOnly={!edValores} inputMode="decimal" aria-label={`Valor de ${i.nome}`} onChange={(e) => muda(i.idx, { valorUnit: e.target.value })} /> },
            { chave: 'd', titulo: 'Desconto (R$)', render: (i) => <input className={`${s.entrada} ${s.entradaNumero} ${s.entradaTabela}`} value={i.desconto} readOnly={!edValores} inputMode="decimal" aria-label={`Desconto de ${i.nome}`} onChange={(e) => muda(i.idx, { desconto: e.target.value })} /> },
            { chave: 's', titulo: 'Subtotal', num: true, render: (i) => brl((lerNumero(i.quantidade) ?? 0) * (lerNumero(i.valorUnit) ?? 0) - (lerNumero(i.desconto) ?? 0)) },
            { chave: 'st', titulo: 'Status', render: (i) => { const x = itensFicha.get(i.produtoId); return x ? <Selo tom={x.situacao === 'RECEBIDO' ? 'ok' : x.situacao === 'PARCIAL' ? 'alerta' : undefined}>{x.situacao === 'RECEBIDO' ? 'Recebido' : x.situacao === 'PARCIAL' ? `Parcial (${fmtQtd(x.quantidadeRecebida)})` : 'Pendente'}</Selo> : <Selo>Novo</Selo>; } },
            { chave: 'a', titulo: 'Ações', render: (i) => (
              <div className={f.acoesLinha}>
                <Botao pequeno onClick={() => window.open(`/produtos/${i.produtoId}`, '_blank')}>Histórico de preços</Botao>
                {edValores && <Botao pequeno perigo onClick={() => set('itens', form.itens.filter((_, k) => k !== i.idx))}>Remover</Botao>}
              </div>
            ) },
          ]} />
        <div className={s.rodapeTabela}><span>Total de itens: {form.itens.length}</span><strong>Valor dos produtos: {brl(tot.produtos)}</strong></div>
      </Secao>
      {buscando && (
        <Modal titulo="Adicionar produto do cadastro" aoFechar={() => setBuscando(false)} acoes={<Botao onClick={() => setBuscando(false)}>Fechar</Botao>}>
          <Grade>
            <CampoTexto l={8} rotulo="Pesquisar" valor={termo} onChange={setTermo} placeholder="Código ou descrição" maxLength={80} />
            <CampoSelecao l={4} rotulo="Categoria" valor={categoria} onChange={setCategoria} vazio="Todas" opcoes={categorias.map((c) => ({ valor: c.id, texto: c.nome }))} />
          </Grade>
          <div className={s.espaco4}>
            <Tabela linhas={candidatos} chave={(p: any) => p.id} vazio="Nenhum produto encontrado."
              colunas={[
                { chave: 'p', titulo: 'Produto', render: (p: any) => <div><div>{p.nome}</div><div className={s.ajuda}>{[p.sku, p.categoria?.nome, p.unidade].filter(Boolean).join(' · ')}</div></div> },
                { chave: 'a', titulo: '', render: (p: any) => (form.itens.some((i) => i.produtoId === p.id) ? <Selo tom="ok">No pedido</Selo> : <Botao pequeno onClick={() => adicionar(p)}>Adicionar</Botao>) },
              ]} />
          </div>
        </Modal>
      )}
    </>
  );
}

// ============================================================================ 3. FORNECEDOR (+ envio do pedido)
export function AbaFornecedor({ form, set, edValores, painel, ficha, avisar, aoAtualizar }: PropsAba) {
  const [vinculados, setVinculados] = useState<any[] | null>(null);
  const [previa, setPrevia] = useState<Awaited<ReturnType<typeof compraApi.previa>> | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fornId = form.fornecedorId;
  const sel = painel.fornecedores.find((x) => x.id === fornId);
  const fd = ficha && ficha.fornecedor.id === fornId ? ficha.fornecedor : null;
  useEffect(() => {
    setVinculados(null);
    if (!fornId) return;
    api.get<{ itens: any[] }>(`/api/v1/fornecedores/${fornId}/produtos`, { params: { situacao: 'ATIVOS' } }).then((r) => setVinculados(r.data.itens)).catch(() => setVinculados([]));
  }, [fornId]);
  const carregarPrevia = useCallback(async () => { if (ficha) try { setPrevia(await compraApi.previa(ficha.compra.id)); } catch (e) { avisar(mensagemDeErro(e), true); } }, [ficha, avisar]);
  useEffect(() => { void carregarPrevia(); }, [carregarPrevia]);
  function adicionarVinculado(v: any) {
    if (form.itens.some((i) => i.produtoId === v.produtoId)) { avisar(`${v.nome} já está no pedido.`, true); return; }
    set('itens', [...form.itens, { produtoId: v.produtoId, codigo: v.codigoInterno, nome: v.nome, quantidade: v.pedidoMinimo ? String(v.pedidoMinimo).replace('.', ',') : '1', unidade: v.unidade, valorUnit: v.preco != null ? String(v.preco).replace('.', ',') : '', desconto: '', observacao: '', ultimoPreco: v.ultimoPrecoCompra }]);
    avisar(`${v.nome} adicionado ao pedido.`);
  }
  async function enviar(canal: 'EMAIL' | 'WHATSAPP', modo: 'API' | 'CONVERSA' = 'API') {
    if (!ficha) return;
    setEnviando(true);
    try {
      const r = await compraApi.enviar(ficha.compra.id, { canal, modo });
      if (r.link) window.open(r.link, '_blank', 'noopener');
      const m: Record<string, string> = { ENVIADO: 'Pedido enviado ao fornecedor.', NAO_CONFIGURADO: `${canal === 'EMAIL' ? 'E-mail' : 'WhatsApp'} não configurado no servidor: nada foi enviado.`, FALHOU: `Falha no envio: ${r.envio.erro ?? ''}`, CONVERSA_ABERTA: 'Conversa aberta no WhatsApp. Envie a mensagem por lá e depois use “Marcar como enviada”.' };
      avisar(m[r.envio.status] ?? r.envio.status, r.envio.status === 'FALHOU' || r.envio.status === 'NAO_CONFIGURADO');
      await aoAtualizar(r.ficha);
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setEnviando(false); }
  }
  async function pdf() { if (ficha) try { const r = await compraApi.pdf(ficha.compra.id); baixarBase64(r.nome, r.mime, r.base64); } catch (e) { avisar(mensagemDeErro(e), true); } }
  const bloqueado = sel && !['Ativo', 'Crítico'].includes(sel.status);
  const podeEnviar = !!previa?.podeEnviar;
  return (
    <>
      <Secao titulo="Fornecedor" descricao="Cadastro do módulo Fornecedores. Bloqueado ou inativo não recebe pedido.">
        <Grade>
          <CampoSelecao l={6} rotulo="Fornecedor" valor={form.fornecedorId} onChange={edValores ? (v) => set('fornecedorId', v) : undefined} vazio="Selecione"
            opcoes={painel.fornecedores.map((x) => ({ valor: x.id, texto: `${x.codigo ? `F${String(x.codigo).padStart(6, '0')} · ` : ''}${x.nomeFantasia ?? x.nome}${['Ativo', 'Crítico'].includes(x.status) ? '' : ` (${x.status})`}` }))} />
          <Celula l={6} alinharCampo>{bloqueado ? <Aviso tom="erro">Fornecedor {sel!.status.toLowerCase()}: não pode receber novos pedidos.</Aviso> : sel ? <Aviso tom="ok">Fornecedor {sel.status.toLowerCase()}: pode receber pedidos.</Aviso> : null}</Celula>
        </Grade>
        {fd ? (
          <div className={`${s.espaco4} ${s.metricas}`}>
            <Metrica rotulo="Razão social" valor={<span style={{ fontSize: 13 }}>{fd.nome}</span>} ajuda={[fd.nomeFantasia, fd.documento].filter(Boolean).join(' · ')} />
            <Metrica rotulo="Contato principal" valor={<span style={{ fontSize: 13 }}>{t(fd.contato?.nome)}</span>} ajuda={[fd.contato?.telefone, fd.whatsapp].filter(Boolean).join(' · ') || '—'} />
            <Metrica rotulo="E-mail para pedidos" valor={<span style={{ fontSize: 13 }}>{t(fd.emailPedidos)}</span>} ajuda={t(fd.endereco)} />
            <Metrica rotulo="Condições" valor={<span style={{ fontSize: 13 }}>{t(fd.condicaoPagamento)}</span>} ajuda={`Prazo ${fd.prazoEntregaDias ?? '—'} dia(s) · ${fd.transportadora ?? 'sem transportadora'}${fd.modalidadeFrete ? ` · ${fd.modalidadeFrete}` : ''}`} />
          </div>
        ) : sel ? <div className={s.espaco3}><Aviso>Condição: {t(sel.condicaoPagamento)} · prazo de entrega {sel.prazoEntregaDias ?? '—'} dia(s). Salve para ver contatos e enviar o pedido.</Aviso></div> : null}
      </Secao>

      <Secao titulo="Produtos vinculados ao fornecedor" descricao="Produtos que este fornecedor fornece (aba Produtos do Fornecedor), com referência e preço próprios.">
        <Tabela linhas={vinculados ?? []} carregando={!!fornId && vinculados === null} chave={(v: any) => v.id} vazio={fornId ? 'Nenhum produto vinculado a este fornecedor.' : 'Selecione o fornecedor.'}
          colunas={[
            { chave: 'p', titulo: 'Produto', render: (v: any) => <div><div>{v.nome} {v.principal && <Selo tom="ok">Principal</Selo>}</div><div className={s.ajuda}>{[v.codigoInterno, v.referencia].filter(Boolean).join(' · ')}</div></div> },
            { chave: 'u', titulo: 'Un.', render: (v: any) => v.unidade },
            { chave: 'pr', titulo: 'Preço fornecedor', num: true, render: (v: any) => (v.preco === undefined ? '—' : brl(v.preco, 4)) },
            { chave: 'ul', titulo: 'Última compra', num: true, render: (v: any) => (v.ultimoPrecoCompra === undefined ? '—' : brl(v.ultimoPrecoCompra, 4)) },
            { chave: 'pz', titulo: 'Prazo', render: (v: any) => (v.prazoEntregaDias == null ? '—' : `${v.prazoEntregaDias} d`) },
            { chave: 'a', titulo: '', render: (v: any) => (edValores ? (form.itens.some((i) => i.produtoId === v.produtoId) ? <Selo tom="ok">No pedido</Selo> : <Botao pequeno onClick={() => adicionarVinculado(v)}>Adicionar ao pedido</Botao>) : null) },
          ]} />
      </Secao>

      {ficha && (
        <Secao titulo="Envio do pedido" descricao="Prévia do documento e envio direto ao fornecedor. Só o envio aceito pelo provedor marca o pedido como enviado."
          acoes={<Botao onClick={pdf}>Baixar PDF</Botao>}>
          {!podeEnviar && <div className={s.espacoAbaixo}><Aviso>{['RASCUNHO', 'SOLICITADA', 'AGUARDANDO_APROVACAO'].includes(ficha.compra.status) ? 'Aprove o pedido antes de enviar ao fornecedor.' : 'Este pedido não pode mais ser enviado.'}</Aviso></div>}
          <Grade>
            <Celula l={6}>
              <div className={s.ajuda} style={{ marginBottom: 6 }}>Mensagem / corpo do e-mail</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12, background: 'var(--nx-surface-2)', border: '1px solid var(--nx-border)', borderRadius: 10, padding: 12, margin: 0, maxHeight: 260, overflow: 'auto' }}>{previa?.texto ?? 'Carregando…'}</pre>
            </Celula>
            <Celula l={6}>
              <div className={s.coluna} style={{ gap: 10 }}>
                <div><strong>E-mail</strong> <span className={s.ajuda}>{t(previa?.email)}</span><div className={s.espaco3}>{previa?.canais.email.configurado ? <Selo tom="ok">{previa.canais.email.origem === 'CENTRAL' ? 'Conta da empresa' : 'Resend (servidor)'}</Selo> : <Selo tom="alerta">Não configurado — conecte o e-mail na Central de Integrações</Selo>}</div></div>
                <Botao primario desabilitado={!podeEnviar || enviando || !previa?.email} onClick={() => enviar('EMAIL')}>Enviar por e-mail (com PDF)</Botao>
                <div className={s.espaco3}><strong>WhatsApp</strong> <span className={s.ajuda}>{t(previa?.whatsapp)}</span><div className={s.espaco3}>{previa?.canais.whatsapp.configurado ? <Selo tom="ok">{previa.canais.whatsapp.origem === 'CENTRAL' ? 'WhatsApp da empresa' : 'API oficial (servidor)'}</Selo> : <Selo tom="alerta">Não configurado — conecte o WhatsApp na Central de Integrações</Selo>}</div></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Botao desabilitado={!podeEnviar || enviando || !previa?.whatsapp || !previa?.canais.whatsapp.configurado} onClick={() => enviar('WHATSAPP')}>Enviar pela API</Botao>
                  <Botao desabilitado={!podeEnviar || enviando || !previa?.linkWhatsApp} onClick={() => enviar('WHATSAPP', 'CONVERSA')}>Abrir conversa (manual)</Botao>
                </div>
                <span className={s.ajuda}>“Abrir conversa” só abre o WhatsApp com a mensagem pronta: não conta como enviado.</span>
              </div>
            </Celula>
          </Grade>
          <div className={s.espaco4}>
            <Tabela linhas={ficha.envios} chave={(e) => e.id} vazio="Nenhum envio registrado."
              colunas={[
                { chave: 'd', titulo: 'Data', render: (e) => <span className={s.nowrap}>{fmtData(e.createdAt)}</span> },
                { chave: 'c', titulo: 'Canal', render: (e) => (e.canal === 'EMAIL' ? 'E-mail' : 'WhatsApp') },
                { chave: 'p', titulo: 'Destinatário', render: (e) => e.destinatario },
                { chave: 's', titulo: 'Resultado', render: (e) => <Selo tom={e.status === 'ENVIADO' ? 'ok' : e.status === 'CONVERSA_ABERTA' ? undefined : 'erro'}>{({ ENVIADO: 'Enviado', FALHOU: 'Falhou', NAO_CONFIGURADO: 'Não configurado', CONVERSA_ABERTA: 'Conversa aberta' } as Record<string, string>)[e.status] ?? e.status}</Selo> },
                { chave: 'en', titulo: 'Entrega', render: (e) => (e.entrega ? <Selo tom={e.entrega.status === 'FALHOU' ? 'erro' : ['ENTREGUE', 'LIDA'].includes(e.entrega.status) ? 'ok' : undefined}>{({ ENVIANDO: 'Enviando', ENVIADA: 'Aceita pela Meta', ENTREGUE: 'Entregue', LIDA: 'Lida', FALHOU: 'Não entregue' } as Record<string, string>)[e.entrega.status] ?? e.entrega.status}</Selo> : <span className={s.ajuda}>—</span>) },
                { chave: 'e', titulo: 'Detalhe', render: (e) => <span className={s.ajuda}>{t(e.entrega?.erro ?? e.erro)}</span> },
              ]} />
          </div>
        </Secao>
      )}
    </>
  );
}

// ============================================================================ 4. FINANCEIRO
export function AbaFinanceiro({ form, set, ed, edValores, ficha }: PropsAba) {
  const tot = useTotais(form);
  const cron = useMemo(() => {
    const n = (form.condPagamento.match(/\d+/g) ?? []).map(Number);
    const parcelas = n.length > 1 ? n.length : Math.max(1, Math.round(lerNumero(form.parcelas) ?? 1));
    const base = form.previsaoEntrega || form.dataCompra || new Date().toISOString().slice(0, 10);
    const parte = Math.round((tot.total / parcelas) * 100) / 100;
    return Array.from({ length: parcelas }, (_, i) => {
      const d = form.primeiroVencimento ? new Date(`${form.primeiroVencimento}T12:00:00Z`) : new Date(`${base}T12:00:00Z`);
      if (form.primeiroVencimento) d.setUTCMonth(d.getUTCMonth() + i); else d.setUTCDate(d.getUTCDate() + (n.length > 1 ? n[i] : (n[0] ?? 0) + 30 * i));
      return { parcela: i + 1, vencimento: d.toISOString(), valor: i === parcelas - 1 ? Math.round((tot.total - parte * (parcelas - 1)) * 100) / 100 : parte };
    });
  }, [form.condPagamento, form.parcelas, form.primeiroVencimento, form.previsaoEntrega, form.dataCompra, tot.total]);
  return (
    <>
      <Secao titulo="Valores" descricao="Desconto, frete e outros custos entram no total e são rateados nas contas a pagar de cada recebimento.">
        <Grade>
          <CampoTexto l={2} rotulo="Valor dos produtos" valor={fmtNum(tot.produtos)} somenteLeitura numero />
          <CampoTexto l={2} rotulo="Descontos (R$)" valor={form.desconto} onChange={on(edValores, (v) => set('desconto', v))} numero />
          <CampoTexto l={2} rotulo="Frete (R$)" valor={form.frete} onChange={on(edValores, (v) => set('frete', v))} numero />
          <CampoTexto l={2} rotulo="Outras despesas (R$)" valor={form.outrasDespesas} onChange={on(edValores, (v) => set('outrasDespesas', v))} numero />
          <CampoTexto l={4} rotulo="Valor total" valor={`R$ ${fmtNum(tot.total)}`} somenteLeitura numero />
        </Grade>
      </Secao>
      <Secao titulo="Pagamento">
        <Grade>
          <CampoSelecao l={3} rotulo="Condição de pagamento" valor={form.condPagamento} onChange={on(ed, (v) => set('condPagamento', v))} vazio="—" opcoes={[...new Set([...CONDICOES, form.condPagamento].filter(Boolean))].map((v) => ({ valor: v, texto: v }))} />
          <CampoSelecao l={3} rotulo="Forma de pagamento" valor={form.formaPagamento} onChange={on(ed, (v) => set('formaPagamento', v))} vazio="—" opcoes={FORMAS} />
          <CampoTexto l={2} rotulo="Parcelas" valor={form.parcelas} onChange={on(ed, (v) => set('parcelas', v.replace(/\D/g, '')))} numero inputMode="numeric" ajuda="Usado quando a condição tem um único prazo" />
          <CampoTexto l={4} rotulo="1º vencimento (opcional)" tipo="date" valor={form.primeiroVencimento} onChange={on(ed, (v) => set('primeiroVencimento', v))} ajuda="Vazio: conta a partir do recebimento" />
          <CampoTexto l={4} rotulo="Conta financeira" valor={form.contaFinanceira} onChange={on(ed, (v) => set('contaFinanceira', v))} maxLength={80} />
          <CampoTexto l={4} rotulo="Centro de custo" valor={form.centroCusto} onChange={on(ed, (v) => set('centroCusto', v))} maxLength={60} />
          <CampoTexto l={4} rotulo="Plano de contas" valor={form.planoContas} onChange={on(ed, (v) => set('planoContas', v))} maxLength={60} />
          <CampoArea rotulo="Observações financeiras" valor={form.observacoesFinanceiras} onChange={on(ed, (v) => set('observacoesFinanceiras', v))} maxLength={1000} />
        </Grade>
      </Secao>
      <Secao titulo="Cronograma de pagamento (previsto)" descricao="As contas a pagar são criadas no RECEBIMENTO, proporcionais ao que chegou — o pedido sozinho não gera conta.">
        <Tabela linhas={cron} chave={(p) => String(p.parcela)} vazio="—" colunas={[
          { chave: 'p', titulo: 'Parcela', render: (p) => `${p.parcela}/${cron.length}` },
          { chave: 'v', titulo: 'Vencimento previsto', render: (p) => fmtData(p.vencimento, false) },
          { chave: 'x', titulo: 'Valor', num: true, render: (p) => brl(p.valor) },
        ]} />
      </Secao>
      {ficha && (
        <Secao titulo="Contas a pagar geradas">
          {ficha.financeiro.contas === null ? <Aviso>Exige a permissão financeiro.visualizar.</Aviso> : (
            <Tabela linhas={ficha.financeiro.contas} chave={(c) => c.id} vazio="Nenhuma conta gerada (nenhum recebimento confirmado)." colunas={[
              { chave: 'd', titulo: 'Descrição', render: (c) => c.descricao },
              { chave: 'v', titulo: 'Vencimento', render: (c) => fmtData(c.vencimento, false) },
              { chave: 's', titulo: 'Status', render: (c) => <Selo tom={c.status === 'PAGO' ? 'ok' : c.status === 'VENCIDO' ? 'erro' : 'alerta'}>{c.status === 'PAGO' ? 'Pago' : c.status === 'VENCIDO' ? 'Vencido' : c.status === 'CANCELADO' ? 'Cancelado' : 'Em aberto'}</Selo> },
              { chave: 'x', titulo: 'Valor', num: true, render: (c) => brl(c.valor) },
            ]} />
          )}
        </Secao>
      )}
    </>
  );
}

// ============================================================================ 5. RECEBIMENTO
interface LinhaConf { compraItemId: string; nome: string; unidade: string; solicitada: number; recebidaAntes: number; pendente: number; recebida: string; avariada: string; recusada: string; divergencia: string }
export function AbaRecebimento({ ficha, avisar, aoAtualizar }: PropsAba) {
  const [linhas, setLinhas] = useState<LinhaConf[]>([]);
  const [chave, setChave] = useState(novaChave());
  const [notaId, setNotaId] = useState('');
  const [obs, setObs] = useState('');
  const [dataRec, setDataRec] = useState(new Date().toISOString().slice(0, 10));
  const [confirmando, setConfirmando] = useState(false);
  const [nf, setNf] = useState({ numero: '', serie: '', chaveAcesso: '', dataEmissao: '', valorTotal: '' });
  const [anexo, setAnexo] = useState<{ nfId: string; arquivo: File | null }>({ nfId: '', arquivo: null });
  useEffect(() => {
    if (!ficha) return;
    setLinhas(ficha.itens.map((i) => ({ compraItemId: i.id, nome: i.nome, unidade: i.unidade, solicitada: i.quantidade, recebidaAntes: i.quantidadeRecebida, pendente: i.quantidadePendente, recebida: '', avariada: '', recusada: '', divergencia: '' })));
  }, [ficha]);
  if (!ficha) return <Secao titulo="Recebimento"><Aviso>Salve e aprove a compra para registrar recebimentos.</Aviso></Secao>;
  const pode = ficha.acoes.includes('RECEBER');
  const muda = (id: string, p: Partial<LinhaConf>) => setLinhas((ls) => ls.map((l) => (l.compraItemId === id ? { ...l, ...p } : l)));
  async function confirmar() {
    const itens = linhas.filter((l) => l.recebida || l.avariada || l.recusada).map((l) => ({ compraItemId: l.compraItemId, quantidadeRecebida: lerNumero(l.recebida) ?? 0, quantidadeAvariada: lerNumero(l.avariada) ?? 0, quantidadeRecusada: lerNumero(l.recusada) ?? 0, divergencia: l.divergencia.trim() || null }));
    if (!itens.some((i) => i.quantidadeRecebida > 0)) { avisar('Informe a quantidade recebida de ao menos um item.', true); return; }
    const acima = linhas.find((l) => (lerNumero(l.recebida) ?? 0) > l.pendente + 1e-9);
    if (acima) { avisar(`${acima.nome}: recebido maior que o pendente (${fmtQtd(acima.pendente)}).`, true); return; }
    if (!window.confirm('Confirmar o recebimento? As quantidades entram no estoque e geram contas a pagar.')) return;
    setConfirmando(true);
    try {
      const r = await compraApi.receber(ficha!.compra.id, { idempotencyKey: chave, itens, notaFiscalId: notaId || null, observacoes: obs.trim() || null, dataRecebimento: dataRec });
      setChave(novaChave()); setObs(''); setNotaId('');
      await aoAtualizar(r.ficha);
      avisar(r.duplicado ? 'Este recebimento já tinha sido confirmado (nada foi duplicado).' : `Recebimento confirmado: ${r.ficha.compra.status === 'PARCIAL' ? 'parcial — saldo pendente mantido' : 'pedido totalmente recebido'}.`);
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setConfirmando(false); }
  }
  async function salvarNota() {
    try {
      await compraApi.novaNota(ficha!.compra.id, { numero: nf.numero.trim(), serie: nf.serie.trim() || null, chaveAcesso: nf.chaveAcesso.trim() || null, dataEmissao: nf.dataEmissao || null, dataEntrada: new Date().toISOString().slice(0, 10), valorTotal: nf.valorTotal ? lerNumero(nf.valorTotal) : null });
      setNf({ numero: '', serie: '', chaveAcesso: '', dataEmissao: '', valorTotal: '' }); await aoAtualizar(); avisar('Nota fiscal vinculada.');
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function enviarAnexo() {
    if (!anexo.arquivo) return;
    try { await compraApi.anexar(ficha!.compra.id, { notaFiscalId: anexo.nfId, arquivo: { nome: anexo.arquivo.name, base64: await lerArquivo(anexo.arquivo) } }); setAnexo({ nfId: '', arquivo: null }); await aoAtualizar(); avisar('Arquivo anexado à nota.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function baixar(id: string) { try { const r = await compraApi.baixar(ficha!.compra.id, id); baixarBase64(r.nome, r.mime, r.base64); } catch (e) { avisar(mensagemDeErro(e), true); } }
  async function marcarNota(id: string, status: string) { try { await compraApi.atualizarNota(ficha!.compra.id, id, { status }); await aoAtualizar(); } catch (e) { avisar(mensagemDeErro(e), true); } }
  const entrada = (v: string, fn: (x: string) => void, r: string, off = false) => <input className={`${s.entrada} ${s.entradaNumero} ${s.entradaTabela}`} value={v} onChange={(e) => fn(e.target.value)} inputMode="decimal" aria-label={r} readOnly={!pode || off} />;
  return (
    <>
      <Secao titulo="Conferência" descricao="Informe o que realmente chegou. Só o recebimento confirmado dá entrada no estoque (na filial da compra), atualiza custos e gera as contas a pagar."
        acoes={pode ? <><Botao onClick={() => setLinhas((ls) => ls.map((l) => ({ ...l, recebida: l.pendente ? String(l.pendente).replace('.', ',') : '' })))}>Preencher com o pendente</Botao><Botao primario desabilitado={confirmando} onClick={confirmar}>{confirmando ? 'Confirmando…' : 'Confirmar recebimento'}</Botao></> : undefined}>
        {!pode && <div className={s.espacoAbaixo}><Aviso>{['RECEBIDA', 'CONCLUIDA'].includes(ficha.compra.status) ? 'Pedido totalmente recebido.' : ficha.compra.status === 'CANCELADA' ? 'Pedido cancelado.' : 'O pedido precisa estar aprovado/enviado para receber.'}</Aviso></div>}
        <Tabela linhas={linhas} chave={(l) => l.compraItemId} vazio="—" colunas={[
          { chave: 'p', titulo: 'Produto', render: (l) => <div style={{ minWidth: 160 }}>{l.nome}</div> },
          { chave: 'so', titulo: 'Solicitada', num: true, render: (l) => `${fmtQtd(l.solicitada)} ${l.unidade}` },
          { chave: 'ra', titulo: 'Já recebida', num: true, render: (l) => fmtQtd(l.recebidaAntes) },
          { chave: 'pe', titulo: 'Pendente', num: true, render: (l) => fmtQtd(l.pendente) },
          { chave: 're', titulo: 'Recebida agora', render: (l) => entrada(l.recebida, (x) => muda(l.compraItemId, { recebida: x }), `Recebida de ${l.nome}`, l.pendente <= 0) },
          { chave: 'av', titulo: 'Avariada', render: (l) => entrada(l.avariada, (x) => muda(l.compraItemId, { avariada: x }), `Avariada de ${l.nome}`) },
          { chave: 'rc', titulo: 'Recusada', render: (l) => entrada(l.recusada, (x) => muda(l.compraItemId, { recusada: x }), `Recusada de ${l.nome}`) },
          { chave: 'dv', titulo: 'Divergência', render: (l) => <input className={`${s.entrada} ${s.entradaTabela}`} style={{ minWidth: 160 }} value={l.divergencia} maxLength={300} readOnly={!pode} aria-label={`Divergência de ${l.nome}`} onChange={(e) => muda(l.compraItemId, { divergencia: e.target.value })} /> },
          { chave: 'st', titulo: 'Status', render: (l) => <Selo tom={l.pendente <= 0 ? 'ok' : l.recebidaAntes > 0 ? 'alerta' : undefined}>{l.pendente <= 0 ? 'Recebido' : l.recebidaAntes > 0 ? 'Parcial' : 'Pendente'}</Selo> },
        ]} />
        {pode && (
          <div className={s.espaco4}><Grade>
            <CampoTexto l={3} rotulo="Data do recebimento" tipo="date" valor={dataRec} onChange={setDataRec} />
            <CampoSelecao l={3} rotulo="Nota fiscal" valor={notaId} onChange={setNotaId} vazio="Sem nota" opcoes={ficha.notasFiscais.map((n) => ({ valor: n.id, texto: `NF-e ${n.numero}${n.serie ? `/${n.serie}` : ''}` }))} />
            <CampoTexto l={6} rotulo="Observações do recebimento" valor={obs} onChange={setObs} maxLength={1000} />
          </Grade></div>
        )}
      </Secao>

      <Secao titulo="Recebimentos anteriores" descricao="Cada recebimento gera movimentações de entrada vinculadas ao pedido.">
        <Tabela linhas={ficha.recebimentos} chave={(r) => r.id} vazio="Nenhum recebimento ainda." colunas={[
          { chave: 'n', titulo: 'Nº', render: (r) => r.numero },
          { chave: 'd', titulo: 'Data', render: (r) => <span className={s.nowrap}>{fmtData(r.data)}</span> },
          { chave: 'u', titulo: 'Conferido por', render: (r) => t(r.usuario) },
          { chave: 'nf', titulo: 'NF-e', render: (r) => t(r.notaFiscal) },
          { chave: 'i', titulo: 'Itens recebidos', render: (r) => r.itens.filter((i) => i.recebida > 0).map((i) => `${ficha.itens.find((x) => x.id === i.compraItemId)?.nome ?? ''}: ${fmtQtd(i.recebida)}${i.avariada ? ` (avaria ${fmtQtd(i.avariada)})` : ''}${i.recusada ? ` (recusa ${fmtQtd(i.recusada)})` : ''}`).join('; ') },
          { chave: 'm', titulo: 'Movimentações', num: true, render: (r) => r.movimentacoes.length },
          { chave: 'v', titulo: 'Valor', num: true, render: (r) => brl(r.valorRecebido) },
        ]} />
      </Secao>

      <Secao titulo="Notas fiscais de entrada" descricao="Dados da NF-e e anexos (XML e DANFE). Nenhum cálculo tributário é feito aqui.">
        {ficha.compra.status !== 'CANCELADA' && (
          <Grade>
            <CampoTexto l={2} rotulo="Número" valor={nf.numero} onChange={(v) => setNf({ ...nf, numero: v })} maxLength={20} />
            <CampoTexto l={2} rotulo="Série" valor={nf.serie} onChange={(v) => setNf({ ...nf, serie: v })} maxLength={5} />
            <CampoTexto l={4} rotulo="Chave de acesso (44 dígitos)" valor={nf.chaveAcesso} onChange={(v) => setNf({ ...nf, chaveAcesso: v.replace(/\D/g, '').slice(0, 44) })} inputMode="numeric" />
            <CampoTexto l={2} rotulo="Emissão" tipo="date" valor={nf.dataEmissao} onChange={(v) => setNf({ ...nf, dataEmissao: v })} />
            <CampoTexto l={2} rotulo="Valor (R$)" valor={nf.valorTotal} onChange={(v) => setNf({ ...nf, valorTotal: v })} numero />
            <Celula l={12}><Botao desabilitado={!nf.numero.trim()} onClick={salvarNota}>Vincular nota fiscal</Botao></Celula>
          </Grade>
        )}
        <div className={s.espaco4}>
          <Tabela linhas={ficha.notasFiscais} chave={(n) => n.id} vazio="Nenhuma nota fiscal vinculada." colunas={[
            { chave: 'n', titulo: 'NF-e', render: (n) => `${n.numero}${n.serie ? `/${n.serie}` : ''}` },
            { chave: 'c', titulo: 'Chave', render: (n) => <span className={s.ajuda}>{t(n.chaveAcesso)}</span> },
            { chave: 'e', titulo: 'Emissão', render: (n) => fmtData(n.dataEmissao, false) },
            { chave: 'v', titulo: 'Valor', num: true, render: (n) => brl(n.valorTotal) },
            { chave: 's', titulo: 'Status', render: (n) => <div><Selo tom={n.status === 'CONFERIDA' ? 'ok' : n.status === 'DIVERGENTE' ? 'alerta' : undefined}>{n.status === 'CONFERIDA' ? 'Conferida' : n.status === 'DIVERGENTE' ? 'Divergente' : 'Registrada'}</Selo>{n.divergencias && <div className={s.ajuda}>{n.divergencias}</div>}</div> },
            { chave: 'd', titulo: 'Anexos', render: (n) => { const docs = ficha.documentos.filter((d) => d.entidadeId === n.id); return docs.length ? docs.map((d) => <Botao key={d.id} pequeno onClick={() => baixar(d.id)}>{d.nome}</Botao>) : '—'; } },
            { chave: 'a', titulo: 'Ações', render: (n) => (
              <div className={f.acoesLinha}>
                {n.status !== 'CONFERIDA' && <Botao pequeno onClick={() => marcarNota(n.id, 'CONFERIDA')}>Marcar conferida</Botao>}
                <Botao pequeno desabilitado={!ficha.storageConfigurado} titulo={ficha.storageConfigurado ? undefined : 'Storage não configurado'} onClick={() => setAnexo({ nfId: n.id, arquivo: null })}>Anexar XML/DANFE</Botao>
              </div>
            ) },
          ]} />
        </div>
      </Secao>
      {anexo.nfId && (
        <Modal titulo="Anexar XML ou DANFE" aoFechar={() => setAnexo({ nfId: '', arquivo: null })} acoes={<><Botao onClick={() => setAnexo({ nfId: '', arquivo: null })}>Cancelar</Botao><Botao primario desabilitado={!anexo.arquivo} onClick={enviarAnexo}>Anexar</Botao></>}>
          <input className={s.entrada} type="file" accept=".xml,.pdf,.png,.jpg,.jpeg" aria-label="Arquivo" onChange={(e) => setAnexo({ ...anexo, arquivo: e.target.files?.[0] ?? null })} style={{ paddingTop: 6 }} />
        </Modal>
      )}
    </>
  );
}

// ============================================================================ 6. HISTÓRICO
export function AbaHistorico({ ficha, avisar }: PropsAba) {
  const [eventos, setEventos] = useState<any[] | null>(null);
  useEffect(() => { if (ficha) compraApi.historico(ficha.compra.id).then(setEventos).catch((e) => avisar(mensagemDeErro(e), true)); }, [ficha, avisar]);
  if (!ficha) return <Secao titulo="Histórico"><Aviso>O histórico começa quando a compra é salva.</Aviso></Secao>;
  type Linha = { id: string; data: string; usuario: string | null; evento: string; campo: string | null; anterior: unknown; novo: unknown };
  const linhas = (eventos ?? []).flatMap((e): Linha[] => {
    const alt = (e.novo as any)?.alteracoes as Array<{ campo: string; anterior: unknown; novo: unknown }> | undefined;
    if (alt?.length) return alt.map((a, i) => ({ id: `${e.id}-${i}`, data: e.data, usuario: e.usuario, evento: e.evento, campo: a.campo, anterior: a.anterior, novo: a.novo }));
    return [{ id: e.id, data: e.data, usuario: e.usuario, evento: e.evento, campo: null, anterior: (e.anterior as any)?.status ?? null, novo: (e.novo as any)?.status ?? null }];
  });
  const v = (x: unknown) => (x == null || x === '' ? '—' : typeof x === 'object' ? JSON.stringify(x) : ROTULO_STATUS[String(x)] ?? String(x));
  return (
    <Secao titulo="Trajetória da compra" descricao="Registrada automaticamente pelo servidor (somente leitura): criação, alterações, aprovação, envios, recebimentos, notas fiscais e cancelamento.">
      <Tabela linhas={linhas} carregando={eventos === null} chave={(l) => l.id} vazio="Nenhum evento." colunas={[
        { chave: 'd', titulo: 'Data e hora', render: (l) => <span className={s.nowrap}>{fmtData(l.data)}</span> },
        { chave: 'e', titulo: 'Evento', render: (l) => l.evento },
        { chave: 'c', titulo: 'Informação', render: (l) => t(l.campo) },
        { chave: 'a', titulo: 'Valor anterior', render: (l) => <span className={s.ajuda}>{v(l.anterior)}</span> },
        { chave: 'n', titulo: 'Novo valor', render: (l) => <span className={s.ajuda}>{v(l.novo)}</span> },
        { chave: 'u', titulo: 'Usuário', render: (l) => t(l.usuario) },
      ]} />
    </Secao>
  );
}

export { itensApi };
