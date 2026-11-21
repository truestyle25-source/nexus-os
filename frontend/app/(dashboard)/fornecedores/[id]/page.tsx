'use client';
// Cadastro de fornecedor (ficha por abas). /fornecedores/novo cria; /fornecedores/:id visualiza e edita.
// Cabeçalho fixo em todas as abas; o estado do formulário fica nesta página (trocar de aba não perde nada).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { fmtData, mensagemDeErro } from '@/lib/produto-ficha';
import { documentoValido, fornecedorApi, mascararDocumento, type CatalogosFornecedor, type FichaFornecedor } from '@/lib/fornecedor-ficha';
import { Aviso, Botao, Campo, CampoSelecao, CampoTexto, Grade, Selo, cx, estilos as s } from '@/components/produto/ui';
import { contatoPrincipalAlterado, faltando, formDaFicha, formVazio, payloadFicha, type FormFornecedor } from '@/components/fornecedor/formulario';
import { AbaCompras, AbaDados, AbaEndereco, AbaFinanceiro, AbaFiscal, AbaObservacoes } from '@/components/fornecedor/AbasCadastro';
import { AbaAvaliacao, AbaContatos, AbaDocumentos, AbaHistorico, AbaProdutos, SalveAntes } from '@/components/fornecedor/AbasRelacionadas';
import f from '@/components/fornecedor/fornecedor.module.css';

type Aba = 'dados' | 'endereco' | 'contatos' | 'financeiro' | 'fiscal' | 'compras' | 'produtos' | 'avaliacao' | 'documentos' | 'historico' | 'observacoes';
const ABAS: Array<[Aba, string]> = [
  ['dados', 'Dados'], ['endereco', 'Endereço'], ['contatos', 'Contatos'], ['financeiro', 'Financeiro'], ['fiscal', 'Fiscal'],
  ['compras', 'Compras e Logística'], ['produtos', 'Produtos do Fornecedor'], ['avaliacao', 'Avaliação / Qualidade'],
  ['documentos', 'Documentos e Anexos'], ['historico', 'Histórico'], ['observacoes', 'Observações'],
];
/** Campos do formulário por aba (marcador de alteração não salva). */
const CAMPOS_POR_ABA: Partial<Record<Aba, string[]>> = {
  dados: ['inscricaoEstadual', 'ieIsento', 'inscricaoMunicipal', 'cnae', 'dataAbertura', 'regimeTributario', 'categoria', 'segmento', 'cpNome', 'cpCargo', 'cpDepartamento', 'cpTelefone', 'cpCelular', 'cpWhatsapp', 'cpEmail', 'site', 'emailPedidos', 'emailNfe'],
  endereco: ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'codigoIbge', 'cobrancaDiferente', 'cobranca', 'alternativoAtivo', 'alternativo'],
  financeiro: ['condicaoPagamento', 'formaPagamento', 'chavePix', 'tipoChavePix', 'banco', 'codigoBanco', 'agencia', 'conta', 'contaDigito', 'tipoConta', 'titular', 'titularDocumento', 'limiteCredito', 'naturezaFinanceira', 'planoContas', 'centroCusto'],
  fiscal: ['contribuinteIcms', 'optanteSimples', 'retemIrrf', 'retemPis', 'retemCofins', 'retemCsll', 'retemIss', 'retemInss', 'cfopEntrada', 'observacoesFiscais'],
  compras: ['prazoEntregaDias', 'pedidoMinimo', 'modalidadeFrete', 'transportadora', 'compradorId', 'condicoesComerciais', 'observacoesLogisticas'],
  avaliacao: ['homologado', 'dataHomologacao', 'homologadoPor', 'validadeCndFederal', 'validadeFgts', 'validadeCndt'],
  observacoes: ['observacoes', 'infoComerciais', 'restricoesAtendimento', 'orientacoesCompradores'],
};
const COR_STATUS: Record<string, string> = { Ativo: 'var(--nx-green)', Inativo: 'var(--nx-ink-3)', Bloqueado: 'var(--nx-red)', 'Crítico': 'var(--nx-amber)' };

export default function CadastroFornecedorPage() {
  const { id } = useParams<{ id: string }>();
  const novo = id === 'novo';
  const router = useRouter();
  const busca = useSearchParams();
  const [catalogos, setCatalogos] = useState<CatalogosFornecedor | null>(null);
  const [ficha, setFicha] = useState<FichaFornecedor | null>(null);
  const [original, setOriginal] = useState<FormFornecedor | null>(null);
  const [form, setForm] = useState<FormFornecedor | null>(null);
  const [permissoes, setPermissoes] = useState<Set<string>>(new Set());
  const [aba, setAba] = useState<Aba>('dados');
  const [editando, setEditando] = useState(novo || busca.get('editar') === '1');
  const [salvando, setSalvando] = useState(false);
  const [erroCarga, setErroCarga] = useState('');
  const [erros, setErros] = useState<Record<string, string>>({});
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const avisar = useCallback((texto: string, erro?: boolean) => {
    setMensagem({ texto, erro }); clearTimeout(timer.current);
    timer.current = setTimeout(() => setMensagem(null), erro ? 9000 : 4000);
  }, []);
  const pode = useCallback((m: string, a: string) => permissoes.has(`${m}:${a}`), [permissoes]);

  const carregarFicha = useCallback(async (manterForm = false) => {
    if (novo) return null;
    const fi = await fornecedorApi.ficha(id);
    setFicha(fi);
    if (!manterForm) { const fm = formDaFicha(fi); setOriginal(fm); setForm(fm); }
    return fi;
  }, [id, novo]);

  useEffect(() => {
    (async () => {
      try {
        const [cat, me] = await Promise.all([fornecedorApi.catalogos(), api.get<{ permissions?: string[] }>('/auth/me')]);
        setCatalogos(cat); setPermissoes(new Set(me.data.permissions ?? []));
        if (novo) {
          const fv = formVazio(cat.filiais.length === 1 ? cat.filiais[0].id : '');
          const nome = busca.get('nome'); if (nome) fv.nome = nome;
          setOriginal(null); setForm(fv);
        } else await carregarFicha();
      } catch (e) { setErroCarga(mensagemDeErro(e)); }
    })();
  }, [carregarFicha, novo, busca]);

  const set = useCallback(<K extends keyof FormFornecedor>(k: K, v: FormFornecedor[K]) => {
    setForm((x) => (x ? { ...x, [k]: v } : x));
    setErros((e) => { if (!(k in e)) return e; const c = { ...e }; delete c[k as string]; return c; });
  }, []);

  const podeBancario = ficha?.podeVerBancario ?? catalogos?.podeVerBancario ?? false;
  const alteracoes = useMemo(() => (form && (novo || original) ? payloadFicha(novo ? null : original, form, podeBancario) : {}), [form, original, novo, podeBancario]);
  const contatoAlterado = useMemo(() => (form && !novo && original ? contatoPrincipalAlterado(original, form) : null), [form, original, novo]);
  const sujo = !novo ? Object.keys(alteracoes).length > 0 || !!contatoAlterado : !!form && JSON.stringify(form) !== JSON.stringify(formVazio(form.filialId));
  const abasSujas = useMemo(() => {
    if (!form || !original) return new Set<Aba>();
    return new Set((Object.entries(CAMPOS_POR_ABA) as Array<[Aba, string[]]>).filter(([, cs]) => cs.some((c) => JSON.stringify((original as any)[c]) !== JSON.stringify((form as any)[c]))).map(([a]) => a));
  }, [form, original]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (sujo) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [sujo]);

  function validar(): boolean {
    if (!form) return false;
    const temContato = novo ? form.cpNome.trim().length >= 2 : (ficha?.fornecedor.contatos.length ?? 0) > 0;
    const lista = faltando(form, temContato);
    const e: Record<string, string> = {};
    for (const x of lista) {
      const chave = x.campo === 'CNPJ' || x.campo === 'CPF' ? 'documento' : x.campo === 'Razão social' || x.campo === 'Nome' ? 'nome' : x.campo === 'Contato' ? 'cpNome' : x.campo.toLowerCase();
      e[chave] = 'Obrigatório.';
    }
    if (form.documento && !documentoValido(form.documento, form.tipoPessoa as 'JURIDICA' | 'FISICA')) e.documento = form.tipoPessoa === 'FISICA' ? 'CPF inválido.' : 'CNPJ inválido.';
    setErros(e);
    if (Object.keys(e).length) {
      const primeira = lista.find((x) => x.aba !== 'cabecalho')?.aba as Aba | undefined;
      if (primeira && !lista.some((x) => x.aba === 'cabecalho') && !e.documento) setAba(primeira);
      avisar(`Revise: ${[...lista.map((x) => x.campo), ...(e.documento && !lista.some((x) => x.aba === 'cabecalho') ? [e.documento] : [])].join(', ')}`, true);
      return false;
    }
    return true;
  }

  async function salvar(fechar: boolean) {
    if (!form || !validar()) return;
    setSalvando(true);
    try {
      if (novo) {
        const contato = contatoPrincipalAlterado(null, form)!;
        const criado = await fornecedorApi.criar({ ...payloadFicha(null, form, podeBancario), contatos: [{ ...contato, principal: true }] });
        avisar('Fornecedor cadastrado.');
        router.replace(fechar ? '/fornecedores' : `/fornecedores/${criado.fornecedor.id}`);
        return;
      }
      if (contatoAlterado && ficha) {
        const principal = ficha.fornecedor.contatos.find((c) => c.principal) ?? ficha.fornecedor.contatos[0];
        if (principal?.id) await fornecedorApi.contatos.salvar(ficha.fornecedor.id, principal.id, contatoAlterado);
        else await fornecedorApi.contatos.criar(ficha.fornecedor.id, { ...contatoAlterado, principal: true });
      }
      if (Object.keys(alteracoes).length) await fornecedorApi.salvar(id, alteracoes);
      await carregarFicha();
      avisar('Alterações salvas.');
      if (fechar) router.push('/fornecedores'); else setEditando(false);
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }

  function cancelar() {
    if (sujo && !window.confirm('Descartar as alterações não salvas?')) return;
    if (novo) { router.push('/fornecedores'); return; }
    setForm(original); setErros({}); setEditando(false);
  }

  if (erroCarga) return <div className={s.ficha}><Aviso tom="erro">Não foi possível abrir o fornecedor: {erroCarga}</Aviso><div><Botao onClick={() => router.push('/fornecedores')}>Voltar aos fornecedores</Botao></div></div>;
  if (!catalogos || !form || (!novo && !ficha)) return <div className={s.ficha}><Aviso>Carregando cadastro do fornecedor…</Aviso></div>;

  const podeEditar = novo ? pode('fornecedores', 'criar') : pode('fornecedores', 'editar');
  const ed = editando && podeEditar;
  const tipo = form.tipoPessoa as 'JURIDICA' | 'FISICA';
  const atualizar = async () => { await carregarFicha(true); };
  const relacionadas = ficha ? { ficha, pode, avisar, aoAtualizar: atualizar } : null;
  const props = { form, set, ed, catalogos, ficha, avisar, erros };

  return (
    <div className={s.ficha}>
      <header className={s.cabecalho}>
        <div>
          <Botao pequeno onClick={() => { if (sujo && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return; router.push('/fornecedores'); }}>← Fornecedores</Botao>
          <h1 className={cx(s.titulo, s.espaco3)}>{novo ? 'Cadastro de fornecedor' : form.nomeFantasia || form.nome}</h1>
          <div className={s.subtitulo}>
            {!novo && <span className={s.nowrap}><span className={f.ponto} style={{ background: COR_STATUS[ficha!.fornecedor.status] }} /> {ficha!.fornecedor.status}</span>}
            {!novo && <span>· {ficha!.fornecedor.codigoExibido}</span>}
            {!novo && <span>· {editando ? 'Editando' : 'Visualizando'}</span>}
            {sujo && <Selo tom="alerta">Alterações não salvas</Selo>}
          </div>
        </div>
        <div className={s.acoes}>
          {!novo && !editando && podeEditar && <Botao primario onClick={() => setEditando(true)}>Editar</Botao>}
          {!novo && editando && <Botao onClick={() => { if (sujo && !window.confirm('Descartar as alterações e voltar a visualizar?')) return; setForm(original); setErros({}); setEditando(false); }}>Visualizar</Botao>}
          {editando && <Botao onClick={cancelar} desabilitado={salvando}>Cancelar</Botao>}
          {ed && <Botao primario onClick={() => salvar(false)} desabilitado={salvando || (!novo && !sujo)}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>}
          {ed && <Botao primario onClick={() => salvar(true)} desabilitado={salvando || (!novo && !sujo)}>Salvar e fechar</Botao>}
        </div>
      </header>

      {mensagem && <Aviso tom={mensagem.erro ? 'erro' : 'ok'}>{mensagem.texto}</Aviso>}
      {!podeEditar && <Aviso>Somente leitura: {novo ? 'cadastrar exige fornecedores.criar' : 'alterar exige fornecedores.editar'}.</Aviso>}

      <section className={f.cabecalhoFixo} aria-label="Identificação do fornecedor">
        <Grade>
          <CampoTexto l={2} rotulo="Código do fornecedor" valor={ficha?.fornecedor.codigoExibido ?? 'Automático'} somenteLeitura />
          <CampoSelecao l={2} rotulo="Loja / filial" valor={form.filialId} onChange={ed ? (v) => set('filialId', v) : undefined} vazio="Todas as filiais" opcoes={catalogos.filiais.map((x) => ({ valor: x.id, texto: x.nome }))} />
          <CampoSelecao l={2} rotulo="Status" valor={form.status} onChange={ed ? (v) => set('status', v) : undefined}
            opcoes={['Ativo', 'Inativo', 'Bloqueado', 'Crítico'].map((v) => ({ valor: v, texto: v }))}
            ajuda={form.status === 'Bloqueado' ? 'Não recebe novos pedidos' : form.status === 'Crítico' ? 'Recebe pedidos (alerta)' : undefined} />
          <Campo rotulo="Tipo de pessoa" l={3}>
            {() => (
              <div className={f.opcoes} role="radiogroup" aria-label="Tipo de pessoa">
                {([['JURIDICA', 'Jurídica'], ['FISICA', 'Física']] as const).map(([v, r]) => (
                  <label key={v} className={cx(f.opcao, tipo === v && f.opcaoAtiva)}>
                    <input type="radio" name="tipoPessoa" checked={tipo === v} disabled={!ed} onChange={() => { set('tipoPessoa', v); set('documento', mascararDocumento(form.documento, v)); }} /> {r}
                  </label>
                ))}
              </div>
            )}
          </Campo>
          <CampoTexto l={3} rotulo={tipo === 'FISICA' ? 'CPF' : 'CNPJ'} valor={mascararDocumento(form.documento, tipo)} onChange={ed ? (v) => set('documento', mascararDocumento(v, tipo)) : undefined}
            inputMode="numeric" placeholder={tipo === 'FISICA' ? '000.000.000-00' : '00.000.000/0000-00'} erro={erros.documento}
            ajuda={form.documento && documentoValido(form.documento, tipo) ? 'Documento válido' : undefined} />
          <CampoTexto l={4} rotulo={tipo === 'FISICA' ? 'Nome' : 'Razão social'} valor={form.nome} onChange={ed ? (v) => set('nome', v) : undefined} maxLength={160} erro={erros.nome} />
          <CampoTexto l={4} rotulo="Nome fantasia" valor={form.nomeFantasia} onChange={ed ? (v) => set('nomeFantasia', v) : undefined} maxLength={160} />
          <CampoTexto l={4} rotulo="Empresa do Nexus" valor={ficha?.empresa.nome ?? catalogos.empresa?.nome ?? '—'} somenteLeitura />
        </Grade>
      </section>

      <nav className={s.abas} role="tablist" aria-label="Seções do fornecedor">
        {ABAS.map(([k, tx]) => (
          <button key={k} type="button" role="tab" aria-selected={aba === k} className={cx(s.aba, aba === k && s.abaAtiva)} onClick={() => setAba(k)}>
            {tx}{abasSujas.has(k) && <span className={s.abaMarca} aria-label="com alterações" />}
          </button>
        ))}
      </nav>

      <div className={s.coluna} role="tabpanel">
        {aba === 'dados' && <AbaDados {...props} />}
        {aba === 'endereco' && <AbaEndereco {...props} />}
        {aba === 'contatos' && (relacionadas ? <AbaContatos {...relacionadas} form={form} set={set} ed={ed} /> : <SalveAntes oque="Contatos" />)}
        {aba === 'financeiro' && <AbaFinanceiro {...props} />}
        {aba === 'fiscal' && <AbaFiscal {...props} />}
        {aba === 'compras' && <AbaCompras {...props} />}
        {aba === 'produtos' && (relacionadas ? <AbaProdutos {...relacionadas} catalogos={catalogos} /> : <SalveAntes oque="Produtos do fornecedor" />)}
        {aba === 'avaliacao' && (relacionadas ? <AbaAvaliacao {...relacionadas} form={form} set={set} ed={ed} /> : <SalveAntes oque="Avaliação / qualidade" />)}
        {aba === 'documentos' && (relacionadas ? <AbaDocumentos {...relacionadas} catalogos={catalogos} /> : <SalveAntes oque="Documentos e anexos" />)}
        {aba === 'historico' && (relacionadas ? <AbaHistorico {...relacionadas} /> : <SalveAntes oque="Histórico" />)}
        {aba === 'observacoes' && <AbaObservacoes {...props} />}
      </div>

      {ficha && (
        <footer className={f.rodape} aria-label="Auditoria do cadastro">
          <span>Criado por <strong>{ficha.auditoria.criadoPor ?? '—'}</strong> em {fmtData(ficha.auditoria.criadoEm)}</span>
          <span>Última alteração por <strong>{ficha.auditoria.atualizadoPor ?? '—'}</strong> em {fmtData(ficha.auditoria.atualizadoEm)}</span>
        </footer>
      )}
    </div>
  );
}
