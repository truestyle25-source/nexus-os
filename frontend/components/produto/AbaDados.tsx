'use client';
import { useMemo, useState } from 'react';
import { Alternador, Aviso, Botao, CampoArea, CampoSelecao, CampoTexto, Celula, Grade, Secao } from './ui';
import type { FormProduto } from './formulario';
import { fichaApi, lerNumero, mensagemDeErro, type Catalogos, type Ficha } from '@/lib/produto-ficha';

type Props = {
  form: FormProduto; set: <K extends keyof FormProduto>(k: K, v: FormProduto[K]) => void;
  catalogos: Catalogos; ficha: Ficha; podeEditar: boolean;
  aoAtualizarCatalogos: () => Promise<void>; aoAtualizarFicha: () => Promise<void>; avisar: (msg: string, erro?: boolean) => void;
};

const NIVEIS = ['Grupo', 'Subgrupo nível 1', 'Subgrupo nível 2', 'Subgrupo nível 3'];

export default function AbaDados({ form, set, catalogos, ficha, podeEditar, aoAtualizarCatalogos, aoAtualizarFicha, avisar }: Props) {
  const ed = podeEditar ? set : undefined;
  const cats = catalogos.categorias;

  // Caminho grupo > subgrupos derivado da categoria mais específica selecionada.
  const caminho = useMemo(() => {
    const porId = new Map(cats.map((c) => [c.id, c]));
    const r: string[] = [];
    let atual = form.categoriaId ? porId.get(form.categoriaId) : undefined;
    while (atual) { r.unshift(atual.id); atual = atual.categoriaPaiId ? porId.get(atual.categoriaPaiId) : undefined; }
    return r;
  }, [cats, form.categoriaId]);

  const opcoesNivel = (nivel: number) => {
    const pai = nivel === 0 ? null : caminho[nivel - 1];
    if (nivel > 0 && !pai) return [];
    return cats.filter((c) => c.nivel === nivel && (nivel === 0 ? !c.categoriaPaiId : c.categoriaPaiId === pai)).map((c) => ({ valor: c.id, texto: c.nome }));
  };
  const escolherNivel = (nivel: number, id: string) => {
    // Escolher um nível limpa os mais profundos; vazio volta ao nível anterior.
    set('categoriaId', id || caminho[nivel - 1] || '');
  };

  const [novaCategoria, setNovaCategoria] = useState('');
  async function criarCategoria() {
    const nome = novaCategoria.trim();
    if (nome.length < 2) return;
    const nivelPai = caminho.length - 1;
    if (nivelPai >= 3) { avisar('Limite de hierarquia: grupo + 3 subgrupos.', true); return; }
    try {
      const c = await fichaApi.novaCategoria(nome, caminho.at(-1));
      await aoAtualizarCatalogos();
      set('categoriaId', c.id);
      setNovaCategoria('');
      avisar(`${NIVEIS[c.nivel]} "${c.nome}" criado.`);
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  const unidades = catalogos.unidades.map((u) => ({ valor: u.id, texto: `${u.simbolo} — ${u.nome}` }));
  const simbolo = (id: string) => catalogos.unidades.find((u) => u.id === id)?.simbolo;
  const base = form.unidadeBaseId || '';
  const compra = form.unidadeCompraId || '';
  const fatorAtual = ficha.produto.fatoresConversao.find((f) => f.unidadeOrigemId === compra && f.unidadeDestinoId === base);
  const [fator, setFator] = useState(fatorAtual ? String(Number(fatorAtual.fator)).replace('.', ',') : '');
  const mesmaDimensao = compra && base && catalogos.unidades.find((u) => u.id === compra)?.dimensao.codigo === catalogos.unidades.find((u) => u.id === base)?.dimensao.codigo;

  async function salvarFator() {
    const n = lerNumero(fator);
    if (!compra || !base || !n) { avisar('Escolha a unidade de compra, a unidade base e informe o fator.', true); return; }
    try {
      await fichaApi.fator(ficha.produto.id, { unidadeOrigemId: compra, unidadeDestinoId: base, fator: n });
      await aoAtualizarFicha();
      avisar(`Conversão salva: 1 ${simbolo(compra)} = ${n} ${simbolo(base)}.`);
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  return (
    <>
      <Secao titulo="Identificação" descricao="Como o produto é reconhecido no cadastro, nas notas e no PDV.">
        <Grade>
          <CampoTexto l={2} rotulo="Referência" valor={form.referencia} onChange={ed && ((v) => ed('referencia', v))} maxLength={60} />
          <CampoTexto l={2} rotulo="SKU / código interno" valor={form.sku} onChange={ed && ((v) => ed('sku', v))} maxLength={60} />
          <CampoTexto l={6} rotulo="Descrição" valor={form.nome} onChange={ed && ((v) => ed('nome', v))} maxLength={160} />
          <CampoTexto l={2} rotulo="Descrição resumida" valor={form.descricaoResumida} onChange={ed && ((v) => ed('descricaoResumida', v))} maxLength={60} ajuda="Cupom e etiqueta" />
          <CampoSelecao l={3} rotulo="Tipo de produto" valor={form.tipoProdutoId} onChange={ed && ((v) => ed('tipoProdutoId', v))} vazio="Não classificado"
            opcoes={catalogos.tipos.map((t) => ({ valor: t.id, texto: t.nome }))} ajuda={catalogos.tipos.find((t) => t.id === form.tipoProdutoId)?.descricao ?? undefined} />
          <CampoTexto l={3} rotulo="Fabricante" valor={form.fabricante} onChange={ed && ((v) => ed('fabricante', v))} maxLength={120} />
          <CampoTexto l={3} rotulo="Marca" valor={form.marca} onChange={ed && ((v) => ed('marca', v))} maxLength={120} />
          <CampoTexto l={3} rotulo="Código externo" valor={form.codigoExterno} onChange={ed && ((v) => ed('codigoExterno', v))} maxLength={60} ajuda="Código do fornecedor ou sistema de origem" />
        </Grade>
      </Secao>

      <Secao titulo="Classificação" descricao="Grupo e até três níveis de subgrupo. O produto fica no nível mais específico escolhido.">
        <Grade>
          {NIVEIS.map((rotulo, nivel) => (
            <CampoSelecao key={rotulo} l={3} rotulo={rotulo} valor={caminho[nivel] ?? ''} vazio={nivel === 0 ? 'Sem grupo' : '—'}
              opcoes={opcoesNivel(nivel)} onChange={ed && ((v) => escolherNivel(nivel, v))} desabilitado={nivel > 0 && !caminho[nivel - 1]} />
          ))}
          {podeEditar && (
            <>
              <CampoTexto l={6} rotulo={`Novo ${NIVEIS[Math.min(caminho.length, 3)].toLowerCase()}${caminho.length ? ' dentro do nível escolhido' : ''}`} valor={novaCategoria} onChange={setNovaCategoria} placeholder="Nome" maxLength={80} />
              <Celula l={3} alinharCampo>
                <Botao onClick={criarCategoria} desabilitado={novaCategoria.trim().length < 2 || caminho.length > 3}>Adicionar à classificação</Botao>
              </Celula>
            </>
          )}
        </Grade>
      </Secao>

      <Secao titulo="Unidades e conversão" descricao="Ex.: compra em caixa, estoque e venda em unidade. A unidade base é a do saldo em estoque.">
        <Grade>
          <CampoSelecao l={3} rotulo="Unidade base (estoque)" valor={form.unidadeBaseId} onChange={ed && ((v) => { ed('unidadeBaseId', v); const sb = simbolo(v); if (sb) ed('unidade', sb); })} vazio="—" opcoes={unidades} />
          <CampoSelecao l={3} rotulo="Unidade de compra" valor={form.unidadeCompraId} onChange={ed && ((v) => ed('unidadeCompraId', v))} vazio="Igual à base" opcoes={unidades} />
          <CampoSelecao l={3} rotulo="Unidade de venda" valor={form.unidadeVendaId} onChange={ed && ((v) => ed('unidadeVendaId', v))} vazio="Igual à base" opcoes={unidades} />
          <CampoSelecao l={3} rotulo="Unidade tributável" valor={form.unidadeTributavelId} onChange={ed && ((v) => ed('unidadeTributavelId', v))} vazio="Igual à base" opcoes={unidades} />
          {compra && base && compra !== base && (
            mesmaDimensao ? (
              <Celula l={12}>
                <Aviso>{simbolo(compra)} e {simbolo(base)} são da mesma dimensão: a conversão é automática pelo fator padrão da unidade.</Aviso>
              </Celula>
            ) : (
              <>
                <CampoTexto l={3} rotulo={`Fator: 1 ${simbolo(compra)} = ? ${simbolo(base)}`} valor={fator} onChange={podeEditar ? setFator : undefined} numero
                  ajuda={fatorAtual ? `Vigente: 1 ${simbolo(compra)} = ${Number(fatorAtual.fator)} ${simbolo(base)}` : 'Sem fator: compras nesta unidade não convertem.'} />
                {podeEditar && <Celula l={3} alinharCampo><Botao onClick={salvarFator}>Salvar conversão</Botao></Celula>}
              </>
            )
          )}
          <CampoTexto l={3} rotulo="Quantidade por embalagem" valor={form.quantidadeEmbalagem} onChange={ed && ((v) => ed('quantidadeEmbalagem', v))} numero />
        </Grade>
      </Secao>

      <Secao titulo="Custos, localização e validade">
        <Grade>
          <CampoTexto l={3} rotulo="Centro de custo (venda)" valor={form.centroCustoVenda} onChange={ed && ((v) => ed('centroCustoVenda', v))} maxLength={60} />
          <CampoTexto l={3} rotulo="Centro de custo contábil" valor={form.centroCustoContabil} onChange={ed && ((v) => ed('centroCustoContabil', v))} maxLength={60} />
          <CampoTexto l={3} rotulo="Localização" valor={form.local} onChange={ed && ((v) => ed('local', v))} maxLength={60} ajuda="Aplicada a todas as filiais" />
          <CampoTexto l={3} rotulo="Dias de validade" valor={form.diasValidade} onChange={ed && ((v) => ed('diasValidade', v))} numero inputMode="numeric" />
          <CampoArea rotulo="Observações do produto" valor={form.descricao} onChange={ed && ((v) => ed('descricao', v))} maxLength={2000} />
        </Grade>
      </Secao>

      <Secao titulo="Parâmetros">
        <Grade>
          <Alternador rotulo="Embalagem" ligado={form.embalagem} onChange={ed && ((v) => ed('embalagem', v))} />
          <Alternador rotulo="Venda fracionada" ligado={form.vendaFracionada} onChange={ed && ((v) => ed('vendaFracionada', v))} />
          <Alternador rotulo="Controle por balança" ligado={form.controlaBalanca} onChange={ed && ((v) => ed('controlaBalanca', v))} />
          <Alternador rotulo="Envio para cozinha" ligado={form.enviaCozinha} onChange={ed && ((v) => ed('enviaCozinha', v))} />
          <Alternador rotulo="Produto GLP" ligado={form.produtoGlp} onChange={ed && ((v) => ed('produtoGlp', v))} />
          <Alternador rotulo="Venda com estoque negativo" ligado={form.permiteEstoqueNegativo} onChange={ed && ((v) => ed('permiteEstoqueNegativo', v))} />
          <Alternador rotulo="Controle de validade" ligado={form.controlaValidade} onChange={ed && ((v) => ed('controlaValidade', v))} />
          <Alternador rotulo="Imprimir ficha de expedição" ligado={form.imprimeFichaExpedicao} onChange={ed && ((v) => ed('imprimeFichaExpedicao', v))} />
        </Grade>
      </Secao>
    </>
  );
}
