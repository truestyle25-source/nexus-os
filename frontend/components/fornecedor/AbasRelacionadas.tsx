'use client';
// Abas da ficha do fornecedor com dados próprios (salvam por conta própria, com auditoria no servidor).
import { useCallback, useEffect, useState } from 'react';
import { Aviso, Botao, CampoArea, CampoSelecao, CampoTexto, Celula, Grade, Metrica, Modal, Secao, Selo, Tabela, estilos as s } from '@/components/produto/ui';
import { baixarBase64, fmtData, fmtNum, fmtPct, fmtQtd, lerNumero, mensagemDeErro } from '@/lib/produto-ficha';
import {
  ROTULO_CAMPO, ROTULO_DOCUMENTO, ROTULO_SITUACAO, fornecedorApi, type CatalogosFornecedor, type Contato, type FichaFornecedor, type ProdutoFornecedor,
} from '@/lib/fornecedor-ficha';
import type { FormFornecedor } from './formulario';
import f from './fornecedor.module.css';

type Avisar = (m: string, erro?: boolean) => void;
interface Base { ficha: FichaFornecedor; pode: (m: string, a: string) => boolean; avisar: Avisar; aoAtualizar: () => Promise<void> }
const brl = (v: number | null | undefined, casas = 2) => (v == null ? '—' : `R$ ${fmtNum(v, casas)}`);
const t = (v: string | null | undefined) => v || '—';

export function SalveAntes({ oque }: { oque: string }) {
  return <Secao titulo={oque}><Aviso>Salve o fornecedor para liberar esta aba. Os dados do cabeçalho e das abas de cadastro são gravados no primeiro Salvar.</Aviso></Secao>;
}

// ============================================================================ CONTATOS
const CONTATO_VAZIO: Contato = { nome: '', cargo: '', departamento: '', telefone: '', celular: '', whatsapp: '', email: '', principal: false };

export function AbaContatos({ ficha, pode, avisar, aoAtualizar, form, set, ed }: Base & { form: FormFornecedor; set: <K extends keyof FormFornecedor>(k: K, v: FormFornecedor[K]) => void; ed: boolean }) {
  const [edicao, setEdicao] = useState<Contato | null>(null);
  const [salvando, setSalvando] = useState(false);
  const id = ficha.fornecedor.id;
  const podeEditar = pode('fornecedores', 'editar') && ed;
  const contatos = ficha.fornecedor.contatos;

  async function salvar() {
    if (!edicao || edicao.nome.trim().length < 2) { avisar('Informe o nome do contato.', true); return; }
    setSalvando(true);
    try {
      const { id: cid, ...dados } = edicao;
      const corpo = Object.fromEntries(Object.entries(dados).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]));
      if (cid) await fornecedorApi.contatos.salvar(id, cid, corpo as Partial<Contato>);
      else await fornecedorApi.contatos.criar(id, corpo as unknown as Contato);
      setEdicao(null); await aoAtualizar(); avisar(cid ? 'Contato atualizado.' : 'Contato adicionado.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setSalvando(false); }
  }
  async function principal(c: Contato) {
    try { await fornecedorApi.contatos.salvar(id, c.id!, { principal: true }); await aoAtualizar(); avisar(`${c.nome} agora é o contato principal.`); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function excluir(c: Contato) {
    if (!window.confirm(`Excluir o contato ${c.nome}?`)) return;
    try { await fornecedorApi.contatos.excluir(id, c.id!); await aoAtualizar(); avisar('Contato excluído.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  const campo = (k: keyof Contato, rotulo: string, l: 3 | 4 | 6 | 12 = 6, tipo?: string) => (
    <CampoTexto l={l} rotulo={rotulo} tipo={tipo} valor={String(edicao?.[k] ?? '')} onChange={(v) => setEdicao((e) => (e ? { ...e, [k]: v } : e))} maxLength={k === 'nome' || k === 'email' ? 160 : 80} />
  );

  return (
    <>
      <Secao titulo="Contatos" descricao="Vários contatos por fornecedor; um deles é o principal (o mesmo do cartão da aba Dados)."
        acoes={podeEditar ? <Botao primario onClick={() => setEdicao({ ...CONTATO_VAZIO })}>+ Adicionar contato</Botao> : undefined}>
        <Tabela<Contato>
          linhas={contatos} chave={(c) => c.id!} vazio="Nenhum contato."
          colunas={[
            { chave: 'nome', titulo: 'Nome', render: (c) => <span className={s.nowrap}>{c.nome} {c.principal && <Selo tom="ok">Principal</Selo>}</span> },
            { chave: 'cargo', titulo: 'Cargo / depto.', render: (c) => [c.cargo, c.departamento].filter(Boolean).join(' · ') || '—' },
            { chave: 'tel', titulo: 'Telefone', render: (c) => <span className={s.nowrap}>{t(c.telefone)}</span> },
            { chave: 'cel', titulo: 'Celular / WhatsApp', render: (c) => <span className={s.nowrap}>{t(c.whatsapp || c.celular)}</span> },
            { chave: 'email', titulo: 'E-mail', render: (c) => t(c.email) },
            { chave: 'acoes', titulo: 'Ações', render: (c) => (podeEditar ? (
              <div className={f.acoesLinha}>
                <Botao pequeno onClick={() => setEdicao({ ...c })}>Editar</Botao>
                {!c.principal && <Botao pequeno onClick={() => principal(c)}>Tornar principal</Botao>}
                {pode('fornecedores', 'excluir') && contatos.length > 1 && <Botao pequeno perigo onClick={() => excluir(c)}>Excluir</Botao>}
              </div>
            ) : '—') },
          ]}
        />
      </Secao>
      <Secao titulo="Informações complementares">
        <Grade>
          <CampoTexto l={4} rotulo="Site do fornecedor" valor={form.site} onChange={ed ? (v) => set('site', v) : undefined} maxLength={160} />
          <CampoTexto l={4} rotulo="E-mail para envio de pedidos" tipo="email" valor={form.emailPedidos} onChange={ed ? (v) => set('emailPedidos', v) : undefined} maxLength={160} />
          <CampoTexto l={4} rotulo="E-mail para recebimento de NF-e" tipo="email" valor={form.emailNfe} onChange={ed ? (v) => set('emailNfe', v) : undefined} maxLength={160} />
        </Grade>
      </Secao>
      {edicao && (
        <Modal titulo={edicao.id ? 'Editar contato' : 'Novo contato'} aoFechar={() => setEdicao(null)}
          acoes={<><Botao onClick={() => setEdicao(null)}>Cancelar</Botao><Botao primario desabilitado={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar contato'}</Botao></>}>
          <Grade>
            {campo('nome', 'Nome', 12)}{campo('cargo', 'Cargo')}{campo('departamento', 'Departamento')}
            {campo('telefone', 'Telefone')}{campo('celular', 'Celular')}{campo('whatsapp', 'WhatsApp')}{campo('email', 'E-mail', 6, 'email')}
          </Grade>
        </Modal>
      )}
    </>
  );
}

// ============================================================================ PRODUTOS DO FORNECEDOR
type EdicaoVinculo = { vinculoId?: string; produtoId: string; nome: string; referencia: string; codigoFornecedor: string; descricaoComercial: string; preco: string; prazoEntregaDias: string; pedidoMinimo: string; status: 'ATIVO' | 'SUSPENSO'; principal: boolean };
const numTxt = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

export function AbaProdutos({ ficha, pode, avisar, catalogos }: Base & { catalogos: CatalogosFornecedor }) {
  const id = ficha.fornecedor.id;
  const [dados, setDados] = useState<Awaited<ReturnType<typeof fornecedorApi.produtos.listar>> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState('TODOS');
  const [categoria, setCategoria] = useState('');
  const [edicao, setEdicao] = useState<EdicaoVinculo | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [candidatos, setCandidatos] = useState<Awaited<ReturnType<typeof fornecedorApi.produtos.candidatos>>>([]);
  const [termoCand, setTermoCand] = useState('');
  const [historico, setHistorico] = useState<{ nome: string; linhas: Awaited<ReturnType<typeof fornecedorApi.produtos.precos>> } | null>(null);
  const podeEditar = pode('fornecedores', 'editar');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try { setDados(await fornecedorApi.produtos.listar(id, { busca: busca || undefined, situacao, categoriaId: categoria || undefined })); }
    catch (e) { avisar(mensagemDeErro(e), true); } finally { setCarregando(false); }
  }, [id, busca, situacao, categoria, avisar]);
  useEffect(() => { const h = setTimeout(() => void carregar(), 250); return () => clearTimeout(h); }, [carregar]);
  useEffect(() => {
    if (!buscando) return;
    const h = setTimeout(async () => { try { setCandidatos(await fornecedorApi.produtos.candidatos(id, termoCand)); } catch (e) { avisar(mensagemDeErro(e), true); } }, 250);
    return () => clearTimeout(h);
  }, [buscando, termoCand, id, avisar]);

  const podeCusto = dados?.podeVerCusto ?? false;
  const categorias = [...new Map((dados?.itens ?? []).filter((i) => i.categoriaId).map((i) => [i.categoriaId!, i.categoria!])).entries()];

  async function salvar() {
    if (!edicao) return;
    const n = (v: string) => (v.trim() ? lerNumero(v) : null);
    const corpo: Record<string, unknown> = {
      referencia: edicao.referencia.trim() || null, codigoFornecedor: edicao.codigoFornecedor.trim() || null, descricaoComercial: edicao.descricaoComercial.trim() || null,
      prazoEntregaDias: edicao.prazoEntregaDias.trim() ? Math.round(lerNumero(edicao.prazoEntregaDias) ?? 0) : null, pedidoMinimo: n(edicao.pedidoMinimo),
      status: edicao.status, principal: edicao.principal,
      ...(podeCusto ? { preco: n(edicao.preco) } : {}),
    };
    try {
      if (edicao.vinculoId) await fornecedorApi.produtos.salvar(id, edicao.vinculoId, corpo);
      else await fornecedorApi.produtos.vincular(id, { ...corpo, produtoId: edicao.produtoId });
      setEdicao(null); await carregar(); avisar(edicao.vinculoId ? 'Vínculo atualizado.' : `${edicao.nome} vinculado ao fornecedor.`);
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function remover(p: ProdutoFornecedor) {
    if (!window.confirm(`Remover o vínculo com ${p.nome}? O produto continua no catálogo e no estoque; o histórico de preços é mantido.`)) return;
    try { await fornecedorApi.produtos.remover(id, p.id); await carregar(); avisar('Vínculo removido. O produto continua no catálogo.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function verHistorico(p: ProdutoFornecedor) {
    try { setHistorico({ nome: p.nome, linhas: await fornecedorApi.produtos.precos(id, p.produtoId) }); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  async function exportar() {
    try { const r = await fornecedorApi.produtos.exportar(id); baixarBase64(r.nome, r.mime, r.base64); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  const editar = (p: ProdutoFornecedor) => setEdicao({
    vinculoId: p.id, produtoId: p.produtoId, nome: p.nome, referencia: p.referencia ?? '', codigoFornecedor: p.codigoFornecedor ?? '', descricaoComercial: p.descricaoComercial ?? '',
    preco: numTxt(p.preco), prazoEntregaDias: p.prazoEntregaDias == null ? '' : String(p.prazoEntregaDias), pedidoMinimo: numTxt(p.pedidoMinimo), status: p.status, principal: p.principal,
  });
  const ind = dados?.indicadores;

  return (
    <>
      <Secao titulo="Produtos do fornecedor" descricao="Vínculo com o catálogo central de Produtos: nenhum produto é duplicado. Cada fornecedor tem a própria referência e o próprio preço; os dados fiscais vêm do cadastro do produto."
        acoes={<>
          <Botao onClick={exportar}>Exportar CSV</Botao>
          {podeEditar && <Botao primario onClick={() => { setTermoCand(''); setBuscando(true); }}>+ Adicionar produto</Botao>}
        </>}>
        <div className={s.metricas}>
          <Metrica rotulo="Produtos vinculados" valor={ind ? fmtQtd(ind.total) : '—'} />
          <Metrica rotulo="Fornecimento ativo" valor={ind ? fmtQtd(ind.ativos) : '—'} />
          <Metrica rotulo="Fornecedor principal em" valor={ind ? `${ind.principal} produto(s)` : '—'} />
          <Metrica rotulo="Sem preço informado" valor={ind?.semPreco == null ? '—' : fmtQtd(ind.semPreco)} ajuda={podeCusto ? undefined : 'Exige custos.visualizar'} />
        </div>
        <div className={`${s.filtros} ${s.espaco4}`}>
          <input className={s.entrada} placeholder="Pesquisar por código, descrição ou referência…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar produtos" />
          <select className={s.entrada} value={situacao} onChange={(e) => setSituacao(e.target.value)} aria-label="Situação">
            <option value="TODOS">Ativos e inativos</option><option value="ATIVOS">Somente ativos</option><option value="INATIVOS">Somente inativos/suspensos</option>
          </select>
          <select className={s.entrada} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categorias.map(([cid, nome]) => <option key={cid} value={cid}>{nome}</option>)}
          </select>
        </div>
        <Tabela<ProdutoFornecedor>
          linhas={dados?.itens ?? []} carregando={carregando} chave={(p) => p.id}
          vazio={podeEditar ? 'Nenhum produto vinculado. Use “+ Adicionar produto” para escolher produtos do catálogo.' : 'Nenhum produto vinculado.'}
          colunas={[
            { chave: 'cod', titulo: 'Código', render: (p) => <span className={s.nowrap}>{t(p.codigoInterno)}</span> },
            { chave: 'prod', titulo: 'Produto', render: (p) => (
              <div style={{ minWidth: 220 }}>
                <div>{p.nome} {p.principal && <Selo tom="ok">Principal</Selo>} {!p.produtoAtivo && <Selo tom="erro">Produto inativo</Selo>} {p.status === 'SUSPENSO' && <Selo tom="alerta">Suspenso</Selo>}</div>
                <div className={s.ajuda}>{[p.descricaoComercial, p.categoria].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            ) },
            { chave: 'ref', titulo: 'Ref. / cód. fornecedor', render: (p) => <span className={s.nowrap}>{[p.referencia, p.codigoFornecedor].filter(Boolean).join(' · ') || '—'}</span> },
            { chave: 'un', titulo: 'Un.', render: (p) => p.unidade },
            { chave: 'fiscal', titulo: 'NCM · CEST · CFOP', render: (p) => <span className={s.nowrap}>{[p.ncm, p.cest, p.cfop].map((x) => x ?? '—').join(' · ')}</span> },
            { chave: 'cst', titulo: 'CST/CSOSN · origem', render: (p) => <span className={s.nowrap}>{t(p.cstCsosn)} · {p.origem ?? '—'}</span> },
            { chave: 'aliq', titulo: 'ICMS/PIS/COFINS/IPI', render: (p) => <span className={s.nowrap}>{p.aliquotas ? [p.aliquotas.icms, p.aliquotas.pis, p.aliquotas.cofins, p.aliquotas.ipi].map((a) => (a == null ? '—' : fmtPct(a))).join(' · ') : '—'}</span> },
            ...(podeCusto ? [
              { chave: 'preco', titulo: 'Preço fornecedor', num: true, render: (p: ProdutoFornecedor) => brl(p.preco, 4) },
              { chave: 'ult', titulo: 'Última compra', num: true, render: (p: ProdutoFornecedor) => brl(p.ultimoPrecoCompra, 4) },
            ] : []),
            { chave: 'atual', titulo: 'Atualizado', render: (p) => <span className={s.nowrap}>{fmtData(p.precoAtualizadoEm, false)}</span> },
            { chave: 'prazo', titulo: 'Prazo · mín.', render: (p) => <span className={s.nowrap}>{p.prazoEntregaDias == null ? '—' : `${p.prazoEntregaDias} d`} · {p.pedidoMinimo == null ? '—' : fmtQtd(p.pedidoMinimo)}</span> },
            { chave: 'alt', titulo: 'Outros fornecedores', render: (p) => (p.outrosFornecedores.length ? p.outrosFornecedores.map((o) => `${o.nome}${o.principal ? ' (principal)' : ''}`).join(', ') : '—') },
            { chave: 'acoes', titulo: 'Ações', render: (p) => (
              <div className={f.acoesLinha}>
                {podeCusto && <Botao pequeno onClick={() => verHistorico(p)}>Preços</Botao>}
                {podeEditar && <Botao pequeno onClick={() => editar(p)}>Editar</Botao>}
                {podeEditar && <Botao pequeno perigo onClick={() => remover(p)}>Remover</Botao>}
              </div>
            ) },
          ]}
        />
      </Secao>

      {buscando && (
        <Modal titulo="Adicionar produto do catálogo" aoFechar={() => setBuscando(false)} acoes={<Botao onClick={() => setBuscando(false)}>Fechar</Botao>}>
          <Grade><CampoTexto l={12} rotulo="Pesquisar" valor={termoCand} onChange={setTermoCand} placeholder="Código interno, descrição ou código de barras" maxLength={80} /></Grade>
          <div className={s.espaco4}>
            <Tabela
              linhas={candidatos} chave={(c) => c.id} vazio="Nenhum produto encontrado (ou todos já vinculados)."
              colunas={[
                { chave: 'p', titulo: 'Produto', render: (c) => <div><div>{c.nome} {c.status !== 'ATIVO' && <Selo tom="erro">Inativo</Selo>}</div><div className={s.ajuda}>{[c.sku, c.categoria?.nome, c.unidade].filter(Boolean).join(' · ')}</div></div> },
                { chave: 'a', titulo: '', render: (c) => <Botao pequeno onClick={() => { setBuscando(false); setEdicao({ produtoId: c.id, nome: c.nome, referencia: '', codigoFornecedor: '', descricaoComercial: '', preco: '', prazoEntregaDias: '', pedidoMinimo: '', status: 'ATIVO', principal: false }); }}>Escolher</Botao> },
              ]}
            />
          </div>
        </Modal>
      )}

      {edicao && (
        <Modal titulo={edicao.vinculoId ? `Editar vínculo — ${edicao.nome}` : `Vincular ${edicao.nome}`} aoFechar={() => setEdicao(null)}
          acoes={<><Botao onClick={() => setEdicao(null)}>Cancelar</Botao><Botao primario onClick={salvar}>Salvar</Botao></>}>
          <Grade>
            <CampoTexto l={6} rotulo="Referência do fornecedor" valor={edicao.referencia} onChange={(v) => setEdicao({ ...edicao, referencia: v })} maxLength={60} />
            <CampoTexto l={6} rotulo="Código no fornecedor" valor={edicao.codigoFornecedor} onChange={(v) => setEdicao({ ...edicao, codigoFornecedor: v })} maxLength={60} />
            <CampoTexto l={12} rotulo="Descrição comercial" valor={edicao.descricaoComercial} onChange={(v) => setEdicao({ ...edicao, descricaoComercial: v })} maxLength={200} />
            {podeCusto && <CampoTexto l={4} rotulo="Preço praticado (R$)" valor={edicao.preco} onChange={(v) => setEdicao({ ...edicao, preco: v })} numero ajuda="Mudanças vão para o histórico" />}
            <CampoTexto l={4} rotulo="Prazo de entrega (dias)" valor={edicao.prazoEntregaDias} onChange={(v) => setEdicao({ ...edicao, prazoEntregaDias: v.replace(/\D/g, '') })} numero inputMode="numeric" />
            <CampoTexto l={4} rotulo="Pedido mínimo" valor={edicao.pedidoMinimo} onChange={(v) => setEdicao({ ...edicao, pedidoMinimo: v })} numero />
            <CampoSelecao l={6} rotulo="Status do fornecimento" valor={edicao.status} onChange={(v) => setEdicao({ ...edicao, status: v as 'ATIVO' | 'SUSPENSO' })} opcoes={[{ valor: 'ATIVO', texto: 'Ativo' }, { valor: 'SUSPENSO', texto: 'Suspenso' }]} />
            <CampoSelecao l={6} rotulo="Fornecedor principal do produto" valor={edicao.principal ? 'sim' : 'nao'} onChange={(v) => setEdicao({ ...edicao, principal: v === 'sim' })} opcoes={[{ valor: 'nao', texto: 'Não (alternativo)' }, { valor: 'sim', texto: 'Sim (principal)' }]} />
          </Grade>
        </Modal>
      )}

      {historico && (
        <Modal titulo={`Histórico de preços — ${historico.nome}`} aoFechar={() => setHistorico(null)} acoes={<Botao onClick={() => setHistorico(null)}>Fechar</Botao>}>
          <Tabela
            linhas={historico.linhas} chave={(l) => l.id} vazio="Sem alterações de preço."
            colunas={[
              { chave: 'd', titulo: 'Data', render: (l) => <span className={s.nowrap}>{fmtData(l.data)}</span> },
              { chave: 'c', titulo: 'Tipo', render: (l) => (l.campo === 'PRECO' ? 'Preço praticado' : 'Compra recebida') },
              { chave: 'a', titulo: 'Anterior', num: true, render: (l) => brl(l.anterior, 4) },
              { chave: 'n', titulo: 'Novo', num: true, render: (l) => brl(l.novo, 4) },
              { chave: 'u', titulo: 'Por', render: (l) => t(l.usuario) },
            ]}
          />
        </Modal>
      )}
      {categorias.length === 0 && catalogos && null}
    </>
  );
}

// ============================================================================ AVALIAÇÃO / QUALIDADE
export function AbaAvaliacao({ ficha, pode, avisar, aoAtualizar, form, set, ed }: Base & { form: FormFornecedor; set: <K extends keyof FormFornecedor>(k: K, v: FormFornecedor[K]) => void; ed: boolean }) {
  const id = ficha.fornecedor.id;
  const [dados, setDados] = useState<any>(null);
  const [nova, setNova] = useState({ notaGeral: '', pontualidade: '', qualidade: '', preco: '', comentario: '' });
  const carregar = useCallback(async () => { try { setDados(await fornecedorApi.avaliacoes.listar(id)); } catch (e) { avisar(mensagemDeErro(e), true); } }, [id, avisar]);
  useEffect(() => { void carregar(); }, [carregar]);
  const notas = [1, 2, 3, 4, 5].map((n) => ({ valor: String(n), texto: `${n} ${'★'.repeat(n)}` }));
  async function registrar() {
    if (!nova.notaGeral) { avisar('Informe a nota geral.', true); return; }
    const n = (v: string) => (v ? Number(v) : null);
    try {
      await fornecedorApi.avaliacoes.criar(id, { notaGeral: Number(nova.notaGeral), pontualidade: n(nova.pontualidade), qualidade: n(nova.qualidade), preco: n(nova.preco), comentario: nova.comentario.trim() || null });
      setNova({ notaGeral: '', pontualidade: '', qualidade: '', preco: '', comentario: '' }); await Promise.all([carregar(), aoAtualizar()]); avisar('Avaliação registrada.');
    } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  const sit = (v: string) => {
    if (!v) return <Selo>Não informada</Selo>;
    const dias = Math.floor((new Date(`${v}T23:59:59`).getTime() - Date.now()) / 86_400_000);
    const r = dias < 0 ? ROTULO_SITUACAO.VENCIDO : dias <= 30 ? ROTULO_SITUACAO.A_VENCER : ROTULO_SITUACAO.VALIDO;
    return <Selo tom={r.tom}>{r.texto}</Selo>;
  };
  const m = dados?.medias; const ind = dados?.indicadores;
  return (
    <>
      <Secao titulo="Desempenho" descricao="Médias das avaliações e indicadores calculados pelas compras recebidas (só com histórico suficiente).">
        <div className={s.metricas}>
          <Metrica rotulo="Nota geral" valor={m?.notaGeral == null ? '—' : `${fmtNum(m.notaGeral, 1)} / 5`} ajuda={`${dados?.historico?.length ?? 0} avaliação(ões)`} />
          <Metrica rotulo="Pontualidade" valor={m?.pontualidade == null ? '—' : `${fmtNum(m.pontualidade, 1)} / 5`} />
          <Metrica rotulo="Qualidade" valor={m?.qualidade == null ? '—' : `${fmtNum(m.qualidade, 1)} / 5`} />
          <Metrica rotulo="Competitividade de preço" valor={m?.preco == null ? '—' : `${fmtNum(m.preco, 1)} / 5`} />
          <Metrica rotulo="Entregas no prazo" valor={ind?.noPrazoPercentual == null ? '—' : fmtPct(ind.noPrazoPercentual)}
            ajuda={ind ? `${ind.comprasRecebidas} compras · média ${fmtNum(ind.prazoMedioDias, 1)} dias` : `A partir de ${dados?.minimoParaIndicadores ?? 3} compras recebidas`} />
        </div>
      </Secao>
      <Secao titulo="Homologação e certidões">
        <Grade>
          <CampoSelecao l={3} rotulo="Fornecedor homologado" valor={form.homologado ? 'sim' : 'nao'} onChange={ed ? (v) => set('homologado', v === 'sim') : undefined} opcoes={[{ valor: 'nao', texto: 'Não' }, { valor: 'sim', texto: 'Sim' }]} />
          <CampoTexto l={3} rotulo="Data de homologação" tipo="date" valor={form.dataHomologacao} onChange={ed ? (v) => set('dataHomologacao', v) : undefined} />
          <CampoTexto l={6} rotulo="Responsável pela homologação" valor={form.homologadoPor} onChange={ed ? (v) => set('homologadoPor', v) : undefined} maxLength={120} />
          <CampoTexto l={4} rotulo="Validade da CND federal" tipo="date" valor={form.validadeCndFederal} onChange={ed ? (v) => set('validadeCndFederal', v) : undefined} ajuda={sit(form.validadeCndFederal)} />
          <CampoTexto l={4} rotulo="Validade do FGTS (CRF)" tipo="date" valor={form.validadeFgts} onChange={ed ? (v) => set('validadeFgts', v) : undefined} ajuda={sit(form.validadeFgts)} />
          <CampoTexto l={4} rotulo="Validade da certidão trabalhista" tipo="date" valor={form.validadeCndt} onChange={ed ? (v) => set('validadeCndt', v) : undefined} ajuda={sit(form.validadeCndt)} />
        </Grade>
      </Secao>
      {pode('fornecedores', 'editar') && (
        <Secao titulo="Nova avaliação" acoes={<Botao primario onClick={registrar}>Registrar avaliação</Botao>}>
          <Grade>
            <CampoSelecao l={3} rotulo="Nota geral" valor={nova.notaGeral} onChange={(v) => setNova({ ...nova, notaGeral: v })} vazio="—" opcoes={notas} />
            <CampoSelecao l={3} rotulo="Pontualidade" valor={nova.pontualidade} onChange={(v) => setNova({ ...nova, pontualidade: v })} vazio="—" opcoes={notas} />
            <CampoSelecao l={3} rotulo="Qualidade" valor={nova.qualidade} onChange={(v) => setNova({ ...nova, qualidade: v })} vazio="—" opcoes={notas} />
            <CampoSelecao l={3} rotulo="Preço" valor={nova.preco} onChange={(v) => setNova({ ...nova, preco: v })} vazio="—" opcoes={notas} />
            <CampoArea rotulo="Comentário" valor={nova.comentario} onChange={(v) => setNova({ ...nova, comentario: v })} maxLength={1000} />
          </Grade>
        </Secao>
      )}
      <Secao titulo="Histórico de avaliações">
        <Tabela
          linhas={dados?.historico ?? []} carregando={!dados} chave={(a: any) => a.id} vazio="Nenhuma avaliação registrada."
          colunas={[
            { chave: 'd', titulo: 'Data', render: (a: any) => <span className={s.nowrap}>{fmtData(a.data)}</span> },
            { chave: 'n', titulo: 'Geral', render: (a: any) => <span className={f.estrelas}>{'★'.repeat(a.notaGeral)}{'☆'.repeat(5 - a.notaGeral)}</span> },
            { chave: 'p', titulo: 'Pontualidade · qualidade · preço', render: (a: any) => [a.pontualidade, a.qualidade, a.preco].map((x: number | null) => x ?? '—').join(' · ') },
            { chave: 'c', titulo: 'Comentário', render: (a: any) => t(a.comentario) },
            { chave: 'u', titulo: 'Por', render: (a: any) => t(a.usuario) },
          ]}
        />
      </Secao>
    </>
  );
}

// ============================================================================ DOCUMENTOS E ANEXOS
export function AbaDocumentos({ ficha, pode, avisar, catalogos }: Base & { catalogos: CatalogosFornecedor }) {
  const id = ficha.fornecedor.id;
  const [dados, setDados] = useState<{ storageConfigurado: boolean; itens: any[] } | null>(null);
  const [novo, setNovo] = useState({ tipo: 'CARTAO_CNPJ', nome: '', validade: '' });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const carregar = useCallback(async () => { try { setDados(await fornecedorApi.documentos.listar(id)); } catch (e) { avisar(mensagemDeErro(e), true); } }, [id, avisar]);
  useEffect(() => { void carregar(); }, [carregar]);
  const storage = dados?.storageConfigurado ?? catalogos.storageConfigurado;

  async function enviar() {
    if (!arquivo) { avisar('Escolha o arquivo.', true); return; }
    if (arquivo.size > 10 * 1024 * 1024) { avisar('Arquivo maior que 10 MB.', true); return; }
    setEnviando(true);
    try {
      const base64 = await new Promise<string>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => erro(r.error); r.readAsDataURL(arquivo); });
      await fornecedorApi.documentos.enviar(id, { tipo: novo.tipo, nome: novo.nome.trim() || arquivo.name, validade: novo.validade || null, arquivo: { nome: arquivo.name, base64 } });
      setNovo({ tipo: 'CARTAO_CNPJ', nome: '', validade: '' }); setArquivo(null); await carregar(); avisar('Documento anexado.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setEnviando(false); }
  }
  async function baixar(doc: any) { try { const r = await fornecedorApi.documentos.baixar(id, doc.id); baixarBase64(r.nome, r.mime, r.base64); } catch (e) { avisar(mensagemDeErro(e), true); } }
  async function remover(doc: any) {
    if (!window.confirm(`Remover ${doc.nome}? O registro fica no histórico.`)) return;
    try { await fornecedorApi.documentos.remover(id, doc.id); await carregar(); avisar('Documento removido.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }
  const vencendo = (dados?.itens ?? []).filter((d) => d.situacao === 'VENCIDO' || d.situacao === 'A_VENCER');

  return (
    <>
      {!storage && <Aviso tom="erro">Armazenamento de arquivos não configurado no servidor (STORAGE_BUCKET). O envio de anexos fica indisponível até a configuração; a lista e as validades continuam funcionando.</Aviso>}
      {vencendo.length > 0 && <Aviso tom="erro">{vencendo.length} documento(s) vencido(s) ou vencendo em até 30 dias.</Aviso>}
      {pode('fornecedores', 'editar') && (
        <Secao titulo="Anexar documento" descricao="PDF, imagem, planilha ou documento, até 10 MB. Armazenamento privado da empresa.">
          <Grade>
            <CampoSelecao l={3} rotulo="Tipo" valor={novo.tipo} onChange={(v) => setNovo({ ...novo, tipo: v })} opcoes={catalogos.tiposDocumento.map((tp) => ({ valor: tp, texto: ROTULO_DOCUMENTO[tp] ?? tp }))} />
            <CampoTexto l={3} rotulo="Nome" valor={novo.nome} onChange={(v) => setNovo({ ...novo, nome: v })} maxLength={160} placeholder="Ex.: CND federal 2026" />
            <CampoTexto l={2} rotulo="Validade" tipo="date" valor={novo.validade} onChange={(v) => setNovo({ ...novo, validade: v })} />
            <Celula l={2} alinharCampo>
              <input className={s.entrada} type="file" aria-label="Arquivo" disabled={!storage} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.doc,.docx" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} style={{ paddingTop: 6 }} />
            </Celula>
            <Celula l={2} alinharCampo><Botao primario desabilitado={!storage || enviando || !arquivo} onClick={enviar}>{enviando ? 'Enviando…' : 'Anexar'}</Botao></Celula>
          </Grade>
        </Secao>
      )}
      <Secao titulo="Documentos e anexos">
        <Tabela
          linhas={dados?.itens ?? []} carregando={!dados} chave={(d: any) => d.id} vazio="Nenhum documento anexado."
          colunas={[
            { chave: 't', titulo: 'Tipo', render: (d: any) => ROTULO_DOCUMENTO[d.tipo] ?? d.tipo },
            { chave: 'n', titulo: 'Nome', render: (d: any) => <div><div>{d.nome}</div><div className={s.ajuda}>{d.arquivoNome ?? ''}{d.tamanhoBytes ? ` · ${fmtNum(d.tamanhoBytes / 1024, 0)} KB` : ''}</div></div> },
            { chave: 'e', titulo: 'Enviado em / por', render: (d: any) => <span className={s.nowrap}>{fmtData(d.enviadoEm)} · {t(d.enviadoPor)}</span> },
            { chave: 'v', titulo: 'Validade', render: (d: any) => <span className={s.nowrap}>{fmtData(d.validade, false)}</span> },
            { chave: 's', titulo: 'Status', render: (d: any) => { const r = ROTULO_SITUACAO[d.situacao] ?? { texto: d.situacao }; return <Selo tom={r.tom}>{r.texto}</Selo>; } },
            { chave: 'a', titulo: 'Ações', render: (d: any) => (
              <div className={f.acoesLinha}>
                {d.temArquivo && <Botao pequeno onClick={() => baixar(d)}>Baixar</Botao>}
                {pode('fornecedores', 'excluir') && <Botao pequeno perigo onClick={() => remover(d)}>Remover</Botao>}
              </div>
            ) },
          ]}
        />
      </Secao>
    </>
  );
}

// ============================================================================ HISTÓRICO / MOVIMENTAÇÕES
const STATUS_COMPRA: Record<string, { texto: string; tom?: 'ok' | 'alerta' | 'erro' }> = {
  SOLICITADA: { texto: 'Solicitada', tom: 'alerta' }, PEDIDO: { texto: 'Pedido', tom: 'alerta' }, RECEBIDA: { texto: 'Entregue', tom: 'ok' }, CANCELADA: { texto: 'Cancelada', tom: 'erro' },
};
const valorAud = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v));

export function AbaHistorico({ ficha, avisar }: Base) {
  const id = ficha.fornecedor.id;
  const ano = new Date().getFullYear();
  const [periodo, setPeriodo] = useState({ de: `${ano}-01-01`, ate: new Date().toISOString().slice(0, 10) });
  const [dados, setDados] = useState<any>(null);
  const carregar = useCallback(async () => { try { setDados(await fornecedorApi.historico(id, periodo)); } catch (e) { avisar(mensagemDeErro(e), true); } }, [id, periodo, avisar]);
  useEffect(() => { void carregar(); }, [carregar]);
  const tt = dados?.totais;
  return (
    <>
      <Secao titulo="Compras" descricao="Somente consulta. Dados reais do módulo Compras." acoes={<>
        <input className={s.entrada} type="date" value={periodo.de} onChange={(e) => setPeriodo({ ...periodo, de: e.target.value })} aria-label="De" style={{ width: 150 }} />
        <input className={s.entrada} type="date" value={periodo.ate} onChange={(e) => setPeriodo({ ...periodo, ate: e.target.value })} aria-label="Até" style={{ width: 150 }} />
      </>}>
        <div className={s.metricas}>
          <Metrica rotulo="Total comprado no período" valor={tt ? `R$ ${fmtNum(tt.compradoNoPeriodo)}` : '—'} ajuda={tt ? `${tt.pedidosNoPeriodo} pedido(s)` : undefined} />
          <Metrica rotulo="Pendentes" valor={tt ? fmtQtd(tt.pendentes) : '—'} />
          <Metrica rotulo="Entregues" valor={tt ? fmtQtd(tt.entregues) : '—'} />
          <Metrica rotulo="Cancelados" valor={tt ? fmtQtd(tt.cancelados) : '—'} />
        </div>
        <div className={s.espaco4}>
          <Tabela
            linhas={dados?.pedidos ?? []} carregando={!dados} chave={(p: any) => p.id} vazio="Nenhum pedido de compra para este fornecedor."
            colunas={[
              { chave: 'd', titulo: 'Data', render: (p: any) => <span className={s.nowrap}>{fmtData(p.data)}</span> },
              { chave: 'id', titulo: 'Pedido', render: (p: any) => <span className={s.nowrap}>{p.id.slice(-8).toUpperCase()}</span> },
              { chave: 'f', titulo: 'Filial', render: (p: any) => t(p.filial) },
              { chave: 's', titulo: 'Status', render: (p: any) => { const r = STATUS_COMPRA[p.status] ?? { texto: p.status }; return <Selo tom={r.tom}>{r.texto}</Selo>; } },
              { chave: 'r', titulo: 'Recebido em', render: (p: any) => <span className={s.nowrap}>{fmtData(p.recebidoEm, false)}</span> },
              { chave: 'v', titulo: 'Valor', num: true, render: (p: any) => brl(p.valor) },
            ]}
          />
        </div>
      </Secao>
      <Secao titulo="Contas a pagar" descricao="Títulos gerados pelas compras deste fornecedor (módulo Financeiro).">
        {dados && dados.financeiro === null ? <Aviso>Exige a permissão financeiro.visualizar.</Aviso> : (
          <Tabela
            linhas={[...(dados?.financeiro?.emAberto ?? []), ...(dados?.financeiro?.pagos ?? [])]} carregando={!dados} chave={(x: any) => x.id} vazio="Nenhum título."
            colunas={[
              { chave: 'd', titulo: 'Descrição', render: (x: any) => x.descricao },
              { chave: 'v', titulo: 'Vencimento', render: (x: any) => <span className={s.nowrap}>{fmtData(x.vencimento, false)}</span> },
              { chave: 's', titulo: 'Status', render: (x: any) => <Selo tom={x.status === 'PAGO' ? 'ok' : x.status === 'VENCIDO' ? 'erro' : 'alerta'}>{x.status === 'PAGO' ? 'Pago' : x.status === 'VENCIDO' ? 'Vencido' : 'Em aberto'}</Selo> },
              { chave: 'x', titulo: 'Valor', num: true, render: (x: any) => brl(x.valor) },
            ]}
          />
        )}
      </Secao>
      <Secao titulo="Alterações cadastrais" descricao="Registradas automaticamente pelo servidor (auditoria). Dados bancários aparecem como “(protegido)”.">
        <Tabela
          linhas={dados?.alteracoes ?? []} carregando={!dados} chave={(a: any) => a.id} vazio="Nenhuma alteração registrada."
          colunas={[
            { chave: 'd', titulo: 'Data e hora', render: (a: any) => <span className={s.nowrap}>{fmtData(a.data)}</span> },
            { chave: 'u', titulo: 'Usuário', render: (a: any) => t(a.usuario) },
            { chave: 'ab', titulo: 'Origem', render: (a: any) => t(a.aba) },
            { chave: 'c', titulo: 'Informação', render: (a: any) => (a.campo ? ROTULO_CAMPO[a.campo] ?? a.campo : a.acao === 'CRIAR' ? 'Inclusão' : a.acao === 'EXCLUIR' ? 'Exclusão' : 'Alteração') },
            { chave: 'an', titulo: 'Valor anterior', render: (a: any) => <span className={s.ajuda}>{valorAud(a.anterior)}</span> },
            { chave: 'nv', titulo: 'Novo valor', render: (a: any) => <span className={s.ajuda}>{valorAud(a.novo)}</span> },
          ]}
        />
      </Secao>
    </>
  );
}
