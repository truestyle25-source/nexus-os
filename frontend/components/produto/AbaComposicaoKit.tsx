'use client';
// Aba "Composição do Kit": itens que compõem o kit, com quantidade, unidade compatível e custo.
// Usa só os componentes da ficha (ui.tsx) e os tokens de ficha.module.css — mesmo visual das outras abas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Aviso, Botao, CampoSelecao, CampoTexto, Grade, Metrica, Modal, Secao, Selo, Tabela, estilos } from './ui';
import {
  custoDaLinha, fmtNum, fmtPct, fmtQtd, kitApi, lerNumero, mensagemDeErro,
  type Catalogos, type CandidatoKit, type Ficha, type Kit, type UnidadeComponente,
} from '@/lib/produto-ficha';

interface Linha {
  produtoId: string; codigo: string | null; nome: string; tipo: string | null; ativo: boolean;
  quantidade: string; unidadeChave: string; unidades: UnidadeComponente[]; unidadeBase: string; custoBase?: number;
}

const chaveUnidade = (u: { id: string | null; simbolo: string }) => u.id ?? `simbolo:${u.simbolo}`;
const textoQtd = (n: number) => String(n).replace('.', ',');
const assinatura = (ls: Linha[]) => JSON.stringify(ls.map((l) => [l.produtoId, lerNumero(l.quantidade), l.unidadeChave]));

export default function AbaComposicaoKit({ ficha, catalogos, podeEditar, tipoSalvoKit, aoAtualizar, avisar, aoAlterar }: {
  ficha: Ficha; catalogos: Catalogos; podeEditar: boolean; tipoSalvoKit: boolean;
  aoAtualizar: () => Promise<void>; avisar: (m: string, erro?: boolean) => void; aoAlterar: (sujo: boolean) => void;
}) {
  const id = ficha.produto.id;
  const [dados, setDados] = useState<Kit | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [original, setOriginal] = useState('[]');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const editavel = podeEditar && tipoSalvoKit;
  const podeVerCusto = ficha.podeVerCusto;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const k = await kitApi.ler(id);
      const ls: Linha[] = k.componentes.map((c) => {
        const unidades = c.unidades.length ? c.unidades : [{ id: c.unidadeId, simbolo: c.unidade, nome: c.unidade, fatorParaBase: c.quantidade ? c.quantidadeBase / c.quantidade : 1 }];
        const atual = unidades.find((u) => u.id === c.unidadeId) ?? unidades.find((u) => u.simbolo === c.unidade) ?? unidades[0];
        return {
          produtoId: c.produtoId, codigo: c.codigo, nome: c.nome, tipo: c.tipo, ativo: c.ativo,
          quantidade: textoQtd(c.quantidade), unidadeChave: chaveUnidade(atual), unidades, unidadeBase: c.unidadeBase, custoBase: c.custoUnitarioBase,
        };
      });
      setDados(k); setLinhas(ls); setOriginal(assinatura(ls));
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setCarregando(false); }
  }, [id, avisar]);
  useEffect(() => { void carregar(); }, [carregar]);

  const sujo = assinatura(linhas) !== original;
  useEffect(() => { aoAlterar(sujo); }, [sujo, aoAlterar]);

  const muda = (produtoId: string, patch: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.produtoId === produtoId ? { ...l, ...patch } : l)));
  const remover = (produtoId: string) => setLinhas((ls) => ls.filter((l) => l.produtoId !== produtoId));

  const calculo = useMemo(() => {
    let total = 0; let completo = true;
    const porLinha = new Map<string, { custo: number | null; base: number | null; erro?: string }>();
    for (const l of linhas) {
      const q = lerNumero(l.quantidade);
      const u = l.unidades.find((x) => chaveUnidade(x) === l.unidadeChave);
      const erro = q == null || !(q > 0) ? 'Informe uma quantidade maior que zero.' : !u ? 'Escolha uma unidade.' : undefined;
      const base = q != null && u ? Math.round(q * u.fatorParaBase * 1e6) / 1e6 : null;
      const custo = u ? custoDaLinha(q, u.fatorParaBase, l.custoBase) : null;
      if (custo == null) completo = false; else total += custo;
      porLinha.set(l.produtoId, { custo, base, erro });
    }
    return { porLinha, total: Math.round(total * 10000) / 10000, completo, invalidas: [...porLinha.values()].filter((v) => v.erro).length };
  }, [linhas]);

  async function salvar() {
    if (calculo.invalidas) { avisar('Revise as quantidades e unidades destacadas antes de salvar.', true); return; }
    setSalvando(true);
    try {
      await kitApi.salvar(id, linhas.map((l) => {
        const u = l.unidades.find((x) => chaveUnidade(x) === l.unidadeChave)!;
        return { produtoId: l.produtoId, quantidade: lerNumero(l.quantidade)!, unidadeId: u.id };
      }));
      await Promise.all([carregar(), aoAtualizar()]);
      avisar('Composição do kit salva. O custo do kit foi recalculado; o preço de venda não foi alterado.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }

  function adicionar(c: CandidatoKit) {
    if (linhas.some((l) => l.produtoId === c.id)) { avisar(`${c.nome} já está na composição — ajuste a quantidade na linha existente.`, true); return; }
    const base = c.unidades.find((u) => u.simbolo === c.unidadeBase) ?? c.unidades[0];
    setLinhas((ls) => [...ls, {
      produtoId: c.id, codigo: c.codigo, nome: c.nome, tipo: c.tipo, ativo: true, quantidade: '1',
      unidadeChave: chaveUnidade(base), unidades: c.unidades, unidadeBase: c.unidadeBase, custoBase: c.custo,
    }]);
    avisar(`${c.nome} adicionado. Informe a quantidade e salve a composição.`);
  }

  const preco = Number(ficha.produto.precoVenda) || 0;
  // Enquanto carrega, nada de "R$ 0,00 / margem 100%": os indicadores ficam vazios.
  const pronto = !carregando && dados !== null;
  const custoPronto = pronto && calculo.completo && linhas.length > 0;
  const margem = preco > 0 && custoPronto ? ((preco - calculo.total) / preco) * 100 : null;
  const inativos = linhas.filter((l) => !l.ativo).length;

  const entrada = (l: Linha) => (
    <input className={`${estilos.entrada} ${estilos.entradaNumero} ${estilos.entradaTabela}`} value={l.quantidade} inputMode="decimal"
      aria-label={`Quantidade de ${l.nome}`} readOnly={!editavel} onChange={(e) => muda(l.produtoId, { quantidade: e.target.value })} />
  );
  const seletorUnidade = (l: Linha) => (
    <select className={`${estilos.entrada} ${estilos.entradaTabela}`} value={l.unidadeChave} disabled={!editavel} aria-label={`Unidade de ${l.nome}`}
      onChange={(e) => muda(l.produtoId, { unidadeChave: e.target.value })}>
      {l.unidades.map((u) => <option key={chaveUnidade(u)} value={chaveUnidade(u)}>{u.simbolo} — {u.nome}</option>)}
    </select>
  );

  return (
    <>
      {!tipoSalvoKit && (
        <Aviso>O tipo Kit ainda não foi salvo. Clique em Salvar no topo da ficha para gravar o tipo; depois monte a composição aqui.</Aviso>
      )}
      {inativos > 0 && (
        <Aviso tom="erro">{inativos} componente(s) inativo(s) na composição. Eles continuam registrados (histórico preservado), mas convém substituí-los.</Aviso>
      )}

      <Secao titulo="Itens que compõem este kit"
        descricao="Produtos e insumos do estoque que formam 1 unidade do kit. Na venda, cada componente é baixado na filial da venda, na unidade de estoque dele."
        acoes={editavel ? <>
          <Botao onClick={() => setBuscando(true)}>+ Adicionar item</Botao>
          <Botao desabilitado={!sujo || salvando} onClick={() => void carregar()}>Descartar</Botao>
          <Botao primario desabilitado={!sujo || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar composição'}</Botao>
        </> : undefined}>
        <Tabela<Linha>
          linhas={linhas} carregando={carregando} chave={(l) => l.produtoId}
          vazio={editavel ? 'Nenhum item na composição. Use “+ Adicionar item” para buscar produtos e insumos do estoque.' : 'Nenhum item na composição.'}
          colunas={[
            { chave: 'codigo', titulo: 'Código', render: (l) => <span className={estilos.nowrap}>{l.codigo ?? '—'}</span> },
            { chave: 'produto', titulo: 'Produto', render: (l) => <span>{l.nome}{!l.ativo && <> <Selo tom="erro">Inativo</Selo></>}</span> },
            { chave: 'tipo', titulo: 'Tipo', render: (l) => <span className={estilos.nowrap}>{l.tipo ?? 'Não classificado'}</span> },
            {
              chave: 'qtd', titulo: 'Quantidade', render: (l) => {
                const c = calculo.porLinha.get(l.produtoId);
                return <div>{entrada(l)}{c?.erro && <div className={estilos.erroTexto}>{c.erro}</div>}</div>;
              },
            },
            {
              chave: 'un', titulo: 'Unidade', render: (l) => {
                const c = calculo.porLinha.get(l.produtoId);
                const u = l.unidades.find((x) => chaveUnidade(x) === l.unidadeChave);
                return <div>{seletorUnidade(l)}{u && u.simbolo !== l.unidadeBase && c?.base != null && <div className={estilos.ajuda}>= {fmtQtd(c.base)} {l.unidadeBase} no estoque</div>}</div>;
              },
            },
            ...(podeVerCusto ? [
              { chave: 'cu', titulo: 'Custo unitário', num: true, render: (l: Linha) => (l.custoBase == null ? '—' : <span>R$ {fmtNum(l.custoBase, l.custoBase < 1 ? 4 : 2)} / {l.unidadeBase}</span>) },
              { chave: 'ct', titulo: 'Custo total', num: true, render: (l: Linha) => { const c = calculo.porLinha.get(l.produtoId)?.custo; return c == null ? '—' : `R$ ${fmtNum(c)}`; } },
            ] : []),
            { chave: 'acoes', titulo: 'Ações', render: (l) => (editavel ? <Botao pequeno perigo onClick={() => remover(l.produtoId)}>Remover</Botao> : '—') },
          ]}
        />
        {podeVerCusto && (
          <div className={`${estilos.metricas} ${estilos.espaco4}`}>
            <Metrica rotulo="Custo total da composição" valor={custoPronto ? `R$ ${fmtNum(calculo.total)}` : '—'} ajuda={pronto ? `${linhas.length} item(ns)` : 'Carregando…'} />
            <Metrica rotulo="Custo por unidade do kit" valor={custoPronto ? `R$ ${fmtNum(calculo.total)}` : '—'} ajuda="A composição descreve 1 kit" />
            <Metrica rotulo="Preço de venda" valor={`R$ ${fmtNum(preco)}`} ajuda="Não muda com o custo" />
            <Metrica rotulo="Margem bruta" valor={fmtPct(margem == null ? null : Math.round(margem * 100) / 100)} ajuda="(preço − custo) ÷ preço" />
          </div>
        )}
        {sujo && <div className={estilos.espaco3}><Aviso>Há alterações na composição ainda não salvas.</Aviso></div>}
      </Secao>

      <Secao titulo="Disponibilidade por filial" descricao="Quantos kits os saldos atuais dos componentes permitem vender em cada filial. Componentes sem controle de estoque ou com estoque negativo liberado não limitam.">
        <Tabela
          linhas={dados?.disponibilidade ?? []} carregando={carregando} chave={(d) => d.filialId} vazio="Nenhuma filial ativa."
          colunas={[
            { chave: 'filial', titulo: 'Filial', render: (d) => d.filial },
            { chave: 'kits', titulo: 'Kits possíveis', num: true, render: (d) => (d.kitsPossiveis == null ? 'Sem limite' : fmtQtd(d.kitsPossiveis)) },
            { chave: 'lim', titulo: 'Componente que limita', render: (d) => d.limitante ?? '—' },
          ]}
        />
      </Secao>

      <Secao titulo="Vendas e consumo dos componentes" descricao="Kits vendidos (vendas finalizadas) e consumo líquido de cada componente pelas vendas do kit, já descontados os estornos.">
        <div className={estilos.metricas}>
          <Metrica rotulo="Kits vendidos" valor={pronto ? fmtQtd(dados!.vendas.kitsVendidos) : '—'} ajuda={pronto ? `${dados!.vendas.itensVendidos} item(ns) de venda` : 'Carregando…'} />
          <Metrica rotulo="Receita" valor={pronto ? `R$ ${fmtNum(dados!.vendas.receita)}` : '—'} />
        </div>
        <div className={estilos.espaco4}>
          <Tabela
            linhas={dados?.consumoComponentes ?? []} carregando={carregando} chave={(c) => c.produtoId} vazio="Nenhuma baixa de componente por venda deste kit."
            colunas={[
              { chave: 'nome', titulo: 'Componente', render: (c) => c.nome },
              { chave: 'qtd', titulo: 'Consumido', num: true, render: (c) => `${fmtQtd(c.quantidade)} ${c.unidade}` },
            ]}
          />
        </div>
      </Secao>

      {buscando && <BuscaComponentes kitId={id} catalogos={catalogos} jaNaComposicao={new Set(linhas.map((l) => l.produtoId))} podeVerCusto={podeVerCusto} aoEscolher={adicionar} aoFechar={() => setBuscando(false)} />}
    </>
  );
}

/** Seleção de componentes: busca no cadastro REAL de produtos (nome, código, código de barras, grupo, subgrupo, tipo). */
function BuscaComponentes({ kitId, catalogos, jaNaComposicao, podeVerCusto, aoEscolher, aoFechar }: {
  kitId: string; catalogos: Catalogos; jaNaComposicao: Set<string>; podeVerCusto: boolean;
  aoEscolher: (c: CandidatoKit) => void; aoFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [grupo, setGrupo] = useState('');
  const [subgrupo, setSubgrupo] = useState('');
  const [itens, setItens] = useState<CandidatoKit[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const grupos = catalogos.categorias.filter((c) => c.nivel === 0 || !c.categoriaPaiId);
  const subgrupos = catalogos.categorias.filter((c) => grupo && c.categoriaPaiId === grupo);
  const tipos = catalogos.tipos.filter((t) => t.codigo !== 'KIT');

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setCarregando(true); setErro('');
      try {
        setItens(await kitApi.candidatos(kitId, { busca: busca.trim() || undefined, tipoProdutoId: tipo || undefined, categoriaId: subgrupo || grupo || undefined }));
      } catch (e) { setErro(mensagemDeErro(e)); } finally { setCarregando(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [kitId, busca, tipo, grupo, subgrupo]);

  return (
    <Modal titulo="Adicionar item à composição" aoFechar={aoFechar} acoes={<Botao onClick={aoFechar}>Fechar</Botao>}>
      <Grade>
        <CampoTexto l={12} rotulo="Pesquisar" valor={busca} onChange={setBusca} placeholder="Nome, código interno ou código de barras" maxLength={80} />
        <CampoSelecao l={4} rotulo="Tipo" valor={tipo} onChange={setTipo} vazio="Todos" opcoes={tipos.map((t) => ({ valor: t.id, texto: t.nome }))} />
        <CampoSelecao l={4} rotulo="Grupo" valor={grupo} onChange={(v) => { setGrupo(v); setSubgrupo(''); }} vazio="Todos" opcoes={grupos.map((g) => ({ valor: g.id, texto: g.nome }))} />
        <CampoSelecao l={4} rotulo="Subgrupo" valor={subgrupo} onChange={setSubgrupo} vazio="Todos" desabilitado={!grupo} opcoes={subgrupos.map((g) => ({ valor: g.id, texto: g.nome }))} />
      </Grade>
      <div className={estilos.espaco4}>
        {erro ? <Aviso tom="erro">{erro}</Aviso> : (
          <Tabela<CandidatoKit>
            linhas={itens} carregando={carregando} chave={(c) => c.id}
            vazio="Nenhum produto ativo encontrado. Kits não aparecem aqui: um kit não compõe outro."
            colunas={[
              { chave: 'produto', titulo: 'Produto', render: (c) => (
                <div>
                  <div>{c.nome}</div>
                  <div className={estilos.ajuda}>{[c.codigo, c.tipo, c.subgrupo ? `${c.grupo} › ${c.subgrupo}` : c.grupo].filter(Boolean).join(' · ') || '—'}</div>
                </div>
              ) },
              { chave: 'saldo', titulo: 'Saldo', num: true, render: (c) => `${fmtQtd(c.saldoTotal)} ${c.unidadeBase}` },
              ...(podeVerCusto ? [{ chave: 'custo', titulo: 'Custo', num: true, render: (c: CandidatoKit) => (c.custo == null ? '—' : `R$ ${fmtNum(c.custo, c.custo < 1 ? 4 : 2)}`) }] : []),
              { chave: 'acao', titulo: '', render: (c) => (jaNaComposicao.has(c.id)
                ? <Selo tom="ok">Na composição</Selo>
                : <Botao pequeno onClick={() => aoEscolher(c)}>Adicionar</Botao>) },
            ]}
          />
        )}
      </div>
    </Modal>
  );
}
