'use client';
// Ficha completa do produto, organizada por abas (cadastro ERP).
// O estado do formulário fica nesta página: trocar de aba não perde o que foi digitado.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { CODIGO_TIPO_KIT, fichaApi, fmtNum, lerNumero, mensagemDeErro, type Catalogos, type Ficha } from '@/lib/produto-ficha';
import { formDaFicha, payloadAlterado, type FormProduto } from '@/components/produto/formulario';
import { Aviso, Botao, Selo, cx, estilos as s } from '@/components/produto/ui';
import AbaDados from '@/components/produto/AbaDados';
import AbaPrecos from '@/components/produto/AbaPrecos';
import AbaTributos from '@/components/produto/AbaTributos';
import AbaCodigos from '@/components/produto/AbaCodigos';
import AbaEstoque from '@/components/produto/AbaEstoque';
import AbaMovimento from '@/components/produto/AbaMovimento';
import AbaFilial from '@/components/produto/AbaFilial';
import { AbaIntegracoes, AbaPdv, AbaPremiacao } from '@/components/produto/AbasComplementares';
import AbaComposicaoKit from '@/components/produto/AbaComposicaoKit';

type Aba = 'dados' | 'precos' | 'tributos' | 'codigos' | 'estoque' | 'kit' | 'movimento' | 'pdv' | 'filial' | 'premiacao' | 'integracoes';
const ABAS: Array<[Aba, string]> = [
  ['dados', 'Dados'], ['precos', 'Preços'], ['tributos', 'Tributos'], ['codigos', 'Código de Barras'], ['estoque', 'Estoque'],
  ['kit', 'Composição do Kit'],
  ['movimento', 'Movimento'], ['pdv', 'PDV'], ['filial', 'Filial'], ['premiacao', 'Premiação'], ['integracoes', 'Integrações'],
];
/** Abas cujos campos vão no "Salvar" principal (as outras salvam por conta própria). */
const CAMPOS_POR_ABA: Partial<Record<Aba, string[]>> = {
  dados: ['nome', 'sku', 'referencia', 'descricaoResumida', 'fabricante', 'marca', 'codigoExterno', 'tipoProdutoId', 'categoriaId', 'unidade', 'unidadeBaseId', 'unidadeCompraId', 'unidadeVendaId', 'unidadeTributavelId', 'centroCustoVenda', 'centroCustoContabil', 'descricao', 'quantidadeEmbalagem', 'diasValidade', 'embalagem', 'controlaBalanca', 'produtoGlp'],
  precos: ['custo', 'precoCompra', 'precoVenda', 'precoTabelaA', 'precoTabelaB', 'precoTabelaC', 'descontoMaximoPercentual', 'despesasPercentual', 'fornecedorId', 'politicaCusto', 'precoPromocional', 'promocaoInicio', 'promocaoFim', 'promocaoLimite'],
  estoque: ['estoqueMinimo', 'estoqueMaximo', 'estoqueSeguranca', 'estoqueIdeal', 'pontoPedido', 'densidade', 'pesoEmbalagem', 'controlaEstoque', 'permiteEstoqueNegativo', 'permiteTransferenciaNegativa', 'controlaLote', 'controlaValidade', 'local', 'vendaFracionada'],
  pdv: ['disponivelPdv', 'posicaoPdv', 'imagem', 'enviaCozinha', 'imprimeFichaExpedicao'],
  premiacao: ['comissaoPercentual', 'premiacaoPercentual', 'premiacaoInicio', 'premiacaoFim', 'premiacaoRegra'],
};

export default function FichaProdutoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [permissoes, setPermissoes] = useState<Set<string>>(new Set());
  const [original, setOriginal] = useState<FormProduto | null>(null);
  const [form, setForm] = useState<FormProduto | null>(null);
  const [aba, setAba] = useState<Aba>('dados');
  const [erroCarga, setErroCarga] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [justificativa, setJustificativa] = useState('');
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [sujoTributos, setSujoTributos] = useState(false);
  const [sujoFilial, setSujoFilial] = useState(false);
  const [sujoKit, setSujoKit] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const avisar = useCallback((texto: string, erro?: boolean) => {
    setMensagem({ texto, erro });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMensagem(null), erro ? 8000 : 4000);
  }, []);
  const pode = (m: string, a: string) => permissoes.has(`${m}:${a}`);

  const carregarFicha = useCallback(async (manterForm = false) => {
    const f = await fichaApi.ficha(id);
    setFicha(f);
    if (!manterForm) { const fm = formDaFicha(f); setOriginal(fm); setForm(fm); }
    return f;
  }, [id]);
  const carregarCatalogos = useCallback(async () => setCatalogos(await fichaApi.catalogos()), []);

  useEffect(() => {
    (async () => {
      try {
        const [, , me] = await Promise.all([carregarFicha(), carregarCatalogos(), api.get<{ permissions?: string[] }>('/auth/me')]);
        setPermissoes(new Set(me.data.permissions ?? []));
      } catch (e) { setErroCarga(mensagemDeErro(e)); }
    })();
  }, [carregarFicha, carregarCatalogos]);

  const alteracoes = useMemo(() => (form && original && ficha ? payloadAlterado(original, form, ficha.podeVerCusto) : {}), [form, original, ficha]);
  const sujo = Object.keys(alteracoes).length > 0;
  const qualquerSujo = sujo || sujoTributos || sujoFilial || sujoKit;
  // Aba Composição do Kit: aparece quando o tipo escolhido (mesmo antes de salvar) é Kit.
  const tipoNoFormularioEhKit = !!form && catalogos?.tipos.find((t) => t.id === form.tipoProdutoId)?.codigo === CODIGO_TIPO_KIT;
  const tipoSalvoEhKit = ficha?.produto.tipoProduto?.codigo === CODIGO_TIPO_KIT;
  const abasVisiveis = ABAS.filter(([k]) => k !== 'kit' || tipoNoFormularioEhKit);
  useEffect(() => { if (aba === 'kit' && !tipoNoFormularioEhKit) setAba('dados'); }, [aba, tipoNoFormularioEhKit]);
  const abasSujas = useMemo(() => new Set((Object.entries(CAMPOS_POR_ABA) as Array<[Aba, string[]]>).filter(([, campos]) => campos.some((c) => c in alteracoes)).map(([a]) => a)), [alteracoes]);
  if (sujoTributos) abasSujas.add('tributos');
  if (sujoFilial) abasSujas.add('filial');
  if (sujoKit) abasSujas.add('kit');

  // Aviso ao sair com alterações não salvas.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (qualquerSujo) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [qualquerSujo]);

  const set = useCallback(<K extends keyof FormProduto>(k: K, v: FormProduto[K]) => setForm((f) => (f ? { ...f, [k]: v } : f)), []);

  // Mesma regra do backend: queda de preço > 10% ou abaixo do custo exige justificativa.
  const precisaJustificativa = useMemo(() => {
    if (!form || !original || !('precoVenda' in alteracoes)) return false;
    const antes = lerNumero(original.precoVenda); const depois = lerNumero(form.precoVenda); const custo = lerNumero(form.custo);
    if (antes == null || depois == null) return false;
    return depois < antes * 0.9 || (custo != null && ficha?.podeVerCusto === true && depois < custo);
  }, [form, original, alteracoes, ficha]);

  async function salvar() {
    if (!sujo || !ficha) return;
    if (precisaJustificativa && justificativa.trim().length < 5) { setAba('precos'); avisar('Informe a justificativa da alteração de preço na aba Preços.', true); return; }
    setSalvando(true);
    try {
      await fichaApi.salvar(ficha.produto.id, { ...alteracoes, ...(precisaJustificativa ? { justificativaPreco: justificativa.trim() } : {}) });
      setJustificativa('');
      await carregarFicha();
      avisar('Alterações salvas.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }

  async function alternarStatus() {
    if (!ficha) return;
    const novo = ficha.produto.status === 'ATIVO' ? 'INATIVO' : 'ATIVO';
    if (novo === 'INATIVO' && !window.confirm('Inativar o produto? Ele sai do PDV e das vendas, mas o histórico é mantido.')) return;
    try { await fichaApi.status(ficha.produto.id, novo); await carregarFicha(true); avisar(novo === 'ATIVO' ? 'Produto ativado.' : 'Produto inativado.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  function voltar() {
    if (qualquerSujo && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    router.push('/produtos');
  }

  if (erroCarga) return <div className={s.ficha}><Aviso tom="erro">Não foi possível abrir o produto: {erroCarga}</Aviso><div><Botao onClick={() => router.push('/produtos')}>Voltar aos produtos</Botao></div></div>;
  if (!ficha || !catalogos || !form) return <div className={s.ficha}><Aviso>Carregando ficha do produto…</Aviso></div>;

  const p = ficha.produto;
  const podeEditar = pode('produtos', 'editar');
  const ativo = p.status === 'ATIVO';
  const atualizar = async () => { await carregarFicha(true); };
  const atualizarTudo = async () => { await carregarFicha(!sujo); };

  return (
    <div className={s.ficha}>
      <header className={s.cabecalho}>
        <div>
          <Botao pequeno onClick={voltar}>← Produtos</Botao>
          <h1 className={cx(s.titulo, s.espaco3)}>{p.nome}</h1>
          <div className={s.subtitulo}>
            <Selo tom={ativo ? 'ok' : 'alerta'}>{ativo ? 'Ativo' : p.status === 'INATIVO' ? 'Inativo' : 'Arquivado'}</Selo>
            {p.sku && <span>SKU {p.sku}</span>}
            {p.referencia && <span>· Ref. {p.referencia}</span>}
            {p.codigoBarras && <span>· {p.codigoBarras}</span>}
            <span>· R$ {fmtNum(Number(p.precoVenda))}</span>
            {qualquerSujo && <Selo tom="alerta">Alterações não salvas</Selo>}
          </div>
        </div>
        <div className={s.acoes}>
          {podeEditar && <Botao onClick={alternarStatus}>{ativo ? 'Inativar' : 'Ativar'}</Botao>}
          {podeEditar && <Botao desabilitado={!sujo || salvando} onClick={() => { if (original) { setForm(original); setJustificativa(''); } }}>Descartar alterações</Botao>}
          {podeEditar && <Botao primario desabilitado={!sujo || salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>}
        </div>
      </header>

      {mensagem && <Aviso tom={mensagem.erro ? 'erro' : 'ok'}>{mensagem.texto}</Aviso>}
      {!podeEditar && <Aviso>Somente leitura: alterar o cadastro exige a permissão produtos.editar.</Aviso>}

      <nav className={s.abas} role="tablist" aria-label="Seções do produto">
        {abasVisiveis.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} className={cx(s.aba, aba === k && s.abaAtiva)} onClick={() => setAba(k)}>
            {t}{abasSujas.has(k) && <span className={s.abaMarca} aria-label="com alterações" />}
          </button>
        ))}
      </nav>

      <div className={s.coluna} role="tabpanel">
        {aba === 'dados' && <AbaDados form={form} set={set} catalogos={catalogos} ficha={ficha} podeEditar={podeEditar} aoAtualizarCatalogos={carregarCatalogos} aoAtualizarFicha={atualizar} avisar={avisar} />}
        {aba === 'precos' && <AbaPrecos form={form} set={set} catalogos={catalogos} ficha={ficha} podeEditar={podeEditar} precisaJustificativa={precisaJustificativa} justificativa={justificativa} setJustificativa={setJustificativa} />}
        {aba === 'tributos' && <AbaTributos ficha={ficha} podeEditar={podeEditar} aoSalvar={atualizarTudo} avisar={avisar} aoAlterar={setSujoTributos} />}
        {aba === 'codigos' && <AbaCodigos ficha={ficha} podeEditar={podeEditar} aoAtualizar={atualizarTudo} avisar={avisar} />}
        {aba === 'estoque' && <AbaEstoque form={form} set={set} ficha={ficha} catalogos={catalogos} podeEditar={podeEditar} podeMovimentar={pode('estoque', 'criar')} aoAtualizar={atualizarTudo} avisar={avisar} />}
        {aba === 'kit' && tipoNoFormularioEhKit && <AbaComposicaoKit ficha={ficha} catalogos={catalogos} podeEditar={podeEditar} tipoSalvoKit={tipoSalvoEhKit} aoAtualizar={atualizarTudo} avisar={avisar} aoAlterar={setSujoKit} />}
        {aba === 'movimento' && <AbaMovimento ficha={ficha} catalogos={catalogos} podeVerEstoque={pode('estoque', 'visualizar')} avisar={avisar} />}
        {aba === 'pdv' && <AbaPdv form={form} set={set} podeEditar={podeEditar} catalogos={catalogos} />}
        {aba === 'filial' && <AbaFilial ficha={ficha} podeEditar={podeEditar} aoAtualizar={atualizarTudo} avisar={avisar} aoAlterar={setSujoFilial} />}
        {aba === 'premiacao' && <AbaPremiacao form={form} set={set} podeEditar={podeEditar} podeAdministrar={pode('produtos', 'administrar')} ficha={ficha} />}
        {aba === 'integracoes' && <AbaIntegracoes ficha={ficha} />}
      </div>
    </div>
  );
}
