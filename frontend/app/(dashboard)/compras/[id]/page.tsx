'use client';
// Ficha da compra: /compras/nova cria; /compras/:id visualiza e edita (?editar=1 abre em edição; ?aba= escolhe a aba).
// Cabeçalho fixo, etapas do processo e 6 abas; o estado do formulário fica nesta página.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { fmtData, fmtNum, mensagemDeErro } from '@/lib/produto-ficha';
import { ETAPAS, ROTULO_STATUS, TOM_STATUS, compraApi, etapaAtual, type Acao, type FichaCompra, type Painel } from '@/lib/compra-ficha';
import { Aviso, Botao, Selo, cx, estilos as s } from '@/components/produto/ui';
import { formDaFicha, formVazio, payloadCompra, problemas, type FormCompra } from '@/components/compra/formulario';
import { AbaDados, AbaFinanceiro, AbaFornecedor, AbaHistorico, AbaProdutos, AbaRecebimento, useTotais } from '@/components/compra/AbasCompra';
import fs from '@/components/fornecedor/fornecedor.module.css';

type Aba = 'dados' | 'produtos' | 'fornecedor' | 'financeiro' | 'recebimento' | 'historico';
const ABAS: Array<[Aba, string]> = [['dados', 'Dados da Compra'], ['produtos', 'Produtos'], ['fornecedor', 'Fornecedor'], ['financeiro', 'Financeiro'], ['recebimento', 'Recebimento'], ['historico', 'Histórico']];
const ACOES_FLUXO: Array<[Acao, string, boolean?]> = [
  ['ENVIAR_APROVACAO', 'Enviar para aprovação'], ['APROVAR', 'Aprovar'], ['DEVOLVER', 'Devolver para rascunho'], ['MARCAR_ENVIADA', 'Marcar como enviada'],
  ['CONFIRMAR_FORNECEDOR', 'Fornecedor confirmou'], ['CONCLUIR', 'Concluir pedido'],
];

export default function FichaCompraPage() {
  const { id } = useParams<{ id: string }>();
  const nova = id === 'nova';
  const router = useRouter();
  const q = useSearchParams();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [ficha, setFicha] = useState<FichaCompra | null>(null);
  const [original, setOriginal] = useState<FormCompra | null>(null);
  const [form, setForm] = useState<FormCompra | null>(null);
  const [aba, setAba] = useState<Aba>((q.get('aba') as Aba) || 'dados');
  const [editando, setEditando] = useState(nova || q.get('editar') === '1');
  const [salvando, setSalvando] = useState(false);
  const [erroCarga, setErroCarga] = useState('');
  const [mensagem, setMensagem] = useState<{ texto: string; erro?: boolean } | null>(null);
  const avisar = useCallback((texto: string, erro?: boolean) => { setMensagem({ texto, erro }); setTimeout(() => setMensagem(null), erro ? 9000 : 5000); }, []);

  const aplicarFicha = useCallback((fi: FichaCompra, manterForm = false) => {
    setFicha(fi);
    if (!manterForm) { const fm = formDaFicha(fi); setOriginal(fm); setForm(fm); }
  }, []);
  const carregar = useCallback(async (manterForm = false) => { if (!nova) aplicarFicha(await compraApi.ficha(id), manterForm); }, [id, nova, aplicarFicha]);

  useEffect(() => {
    (async () => {
      try {
        const p = await compraApi.painel(); setPainel(p);
        if (nova) { const fv = formVazio(); fv.filialId = p.filiais.length === 1 ? p.filiais[0].id : ''; setOriginal(null); setForm(fv); } else await carregar();
      } catch (e) { setErroCarga(mensagemDeErro(e)); }
    })();
  }, [carregar, nova]);

  const set = useCallback(<K extends keyof FormCompra>(k: K, v: FormCompra[K]) => setForm((x) => {
    if (!x) return x;
    const novo = { ...x, [k]: v };
    // Novo fornecedor: sugere a condição de pagamento do cadastro dele.
    if (k === 'fornecedorId' && painel && !x.condPagamento) novo.condPagamento = painel.fornecedores.find((f) => f.id === v)?.condicaoPagamento ?? '';
    return novo;
  }), [painel]);

  const editavel = nova || !!ficha?.editavel;
  const alteracoes = useMemo(() => (form ? payloadCompra(nova ? null : original, form, editavel) : {}), [form, original, nova, editavel]);
  const sujo = nova ? !!form && (form.itens.length > 0 || !!form.fornecedorId) : Object.keys(alteracoes).length > 0;
  const tot = useTotais(form ?? formVazio());
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (sujo) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [sujo]);

  async function salvar(fechar: boolean) {
    if (!form) return;
    const p = problemas(form);
    if (p.length) { avisar(`Revise: ${p.join(', ')}.`, true); setAba(!form.fornecedorId ? 'fornecedor' : !form.itens.length || p.some((x) => x.startsWith('quantidade') || x.startsWith('valor')) ? 'produtos' : 'dados'); return; }
    setSalvando(true);
    try {
      if (nova) {
        const fi = await compraApi.criar(alteracoes);
        avisar(`Compra ${fi.compra.numeroExibido} criada.`);
        router.replace(fechar ? '/compras' : `/compras/${fi.compra.id}`);
        return;
      }
      if (Object.keys(alteracoes).length) aplicarFicha(await compraApi.salvar(id, alteracoes));
      avisar('Alterações salvas.');
      if (fechar) router.push('/compras'); else setEditando(false);
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }
  function cancelarEdicao() {
    if (sujo && !window.confirm('Descartar as alterações não salvas?')) return;
    if (nova) { router.push('/compras'); return; }
    setForm(original); setEditando(false);
  }
  async function executar(acao: Acao) {
    if (!ficha) return;
    if (sujo) { avisar('Salve as alterações antes de mudar o status do pedido.', true); return; }
    try {
      if (acao === 'CANCELAR') {
        const motivo = window.prompt('Motivo do cancelamento:');
        if (!motivo || motivo.trim().length < 3) return;
        await compraApi.cancelar(ficha.compra.id, motivo.trim()); await carregar(); avisar('Pedido cancelado. O histórico foi mantido.'); return;
      }
      if (acao === 'CONCLUIR' && ficha.compra.status === 'PARCIAL' && !window.confirm('Concluir com saldo pendente? O que falta receber deixa de ser esperado (as entradas feitas são mantidas).')) return;
      const fi = await compraApi.acao(ficha.compra.id, acao);
      aplicarFicha(fi);
      avisar(`Pedido: ${ROTULO_STATUS[fi.compra.status] ?? fi.compra.status}.`);
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  if (erroCarga) return <div className={s.ficha}><Aviso tom="erro">Não foi possível abrir a compra: {erroCarga}</Aviso><div><Botao onClick={() => router.push('/compras')}>Voltar às compras</Botao></div></div>;
  if (!painel || !form || (!nova && !ficha)) return <div className={s.ficha}><Aviso>Carregando compra…</Aviso></div>;

  const c = ficha?.compra;
  const status = c?.status ?? 'RASCUNHO';
  const ed = editando;
  const edValores = ed && editavel;
  const etapa = etapaAtual(status);
  const forn = painel.fornecedores.find((x) => x.id === form.fornecedorId);
  const props = { form, set, ed, edValores, painel, ficha, avisar, aoAtualizar: async (fi?: FichaCompra) => { if (fi) aplicarFicha(fi, sujo); else await carregar(sujo); } };

  return (
    <div className={s.ficha}>
      <header className={s.cabecalho}>
        <div>
          <Botao pequeno onClick={() => { if (sujo && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return; router.push('/compras'); }}>← Compras</Botao>
          <h1 className={cx(s.titulo, s.espaco3)}>{nova ? 'Nova compra' : `Compra ${c!.numeroExibido ?? ''}`}</h1>
          <div className={s.subtitulo}>
            <Selo tom={TOM_STATUS[status]}>{ROTULO_STATUS[status] ?? status}</Selo>
            <span>{forn ? forn.nomeFantasia ?? forn.nome : 'Fornecedor não selecionado'}</span>
            <span>· R$ {fmtNum(tot.total)}</span>
            {!nova && <span>· {editando ? 'Editando' : 'Visualizando'}</span>}
            {sujo && <Selo tom="alerta">Alterações não salvas</Selo>}
          </div>
        </div>
        <div className={s.acoes}>
          {!nova && !editando && <Botao primario onClick={() => setEditando(true)}>Editar</Botao>}
          {!nova && editando && <Botao onClick={() => { if (sujo && !window.confirm('Descartar as alterações e voltar a visualizar?')) return; setForm(original); setEditando(false); }}>Visualizar</Botao>}
          {editando && <Botao onClick={cancelarEdicao} desabilitado={salvando}>Cancelar</Botao>}
          {editando && <Botao primario onClick={() => salvar(false)} desabilitado={salvando || (!nova && !sujo)}>{salvando ? 'Salvando…' : 'Salvar'}</Botao>}
          {editando && <Botao primario onClick={() => salvar(true)} desabilitado={salvando || (!nova && !sujo)}>Salvar e fechar</Botao>}
        </div>
      </header>

      {mensagem && <Aviso tom={mensagem.erro ? 'erro' : 'ok'}>{mensagem.texto}</Aviso>}

      <section className={fs.cabecalhoFixo} aria-label="Identificação da compra">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px 16px', fontSize: 13 }}>
          {[['Número', c?.numeroExibido ?? 'Automático'], ['Empresa', painel.empresa?.nome ?? '—'], ['Filial', painel.filiais.find((x) => x.id === form.filialId)?.nome ?? '—'],
            ['Data da compra', form.dataCompra ? fmtData(`${form.dataCompra}T12:00:00Z`, false) : '—'], ['Responsável', painel.responsaveis.find((x) => x.id === form.responsavelId)?.nome ?? c?.responsavel?.nome ?? 'Você'],
            ['Fornecedor', forn ? forn.nomeFantasia ?? forn.nome : '—'], ['Previsão de entrega', form.previsaoEntrega ? fmtData(`${form.previsaoEntrega}T12:00:00Z`, false) : '—']].map(([r, v]) => (
            <div key={r}><div className={s.rotulo}>{r}</div><div>{v}</div></div>
          ))}
        </div>
        {status !== 'CANCELADA' ? (
          <ol aria-label="Etapas do processo" style={{ display: 'flex', listStyle: 'none', padding: 0, margin: '16px 0 0', gap: 4, overflowX: 'auto' }}>
            {ETAPAS.map((e, i) => {
              const feito = i < etapa; const atual = i === etapa;
              return (
                <li key={e} style={{ flex: '1 0 110px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 12, color: atual ? 'var(--nx-ink)' : 'var(--nx-ink-3)', fontWeight: atual ? 700 : 500 }}>
                  <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${feito || atual ? 'var(--nx-accent)' : 'var(--nx-border-strong)'}`, background: feito ? 'var(--nx-accent)' : 'transparent', color: feito ? '#fff' : 'inherit' }}>{feito ? '✓' : i + 1}</span>
                  {e}
                </li>
              );
            })}
          </ol>
        ) : <div className={s.espaco3}><Aviso tom="erro">Pedido cancelado{c?.motivoCancelamento ? `: ${c.motivoCancelamento}` : ''}. O histórico foi preservado.</Aviso></div>}
        {ficha && (
          <div className={`${s.acoes} ${s.espaco4}`}>
            {ACOES_FLUXO.filter(([a]) => ficha.acoes.includes(a) && !(a === 'APROVAR' && ficha.exigeAprovacao && !ficha.permissoes.aprovar)).map(([a, r]) => <Botao key={a} pequeno onClick={() => executar(a)}>{r}</Botao>)}
            {ficha.acoes.includes('ENVIAR') && <Botao pequeno onClick={() => setAba('fornecedor')}>Enviar ao fornecedor</Botao>}
            {ficha.acoes.includes('RECEBER') && <Botao pequeno onClick={() => setAba('recebimento')}>Receber mercadoria</Botao>}
            {ficha.acoes.includes('CANCELAR') && <Botao pequeno perigo onClick={() => executar('CANCELAR')}>Cancelar pedido</Botao>}
          </div>
        )}
      </section>

      <nav className={s.abas} role="tablist" aria-label="Seções da compra">
        {ABAS.map(([k, tx]) => <button key={k} type="button" role="tab" aria-selected={aba === k} className={cx(s.aba, aba === k && s.abaAtiva)} onClick={() => setAba(k)}>{tx}</button>)}
      </nav>

      <div className={s.coluna} role="tabpanel">
        {aba === 'dados' && <AbaDados {...props} />}
        {aba === 'produtos' && <AbaProdutos {...props} />}
        {aba === 'fornecedor' && <AbaFornecedor {...props} />}
        {aba === 'financeiro' && <AbaFinanceiro {...props} />}
        {aba === 'recebimento' && <AbaRecebimento {...props} />}
        {aba === 'historico' && <AbaHistorico {...props} />}
      </div>

      {ficha && (
        <footer className={fs.rodape} aria-label="Auditoria">
          <span>Criado por <strong>{ficha.auditoria.criadoPor ?? '—'}</strong> em {fmtData(ficha.auditoria.criadoEm)}</span>
          <span>Última alteração por <strong>{ficha.auditoria.atualizadoPor ?? '—'}</strong> em {fmtData(ficha.auditoria.atualizadoEm)}</span>
        </footer>
      )}
    </div>
  );
}
