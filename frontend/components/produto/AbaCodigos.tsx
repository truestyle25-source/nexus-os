'use client';
import { useMemo, useState } from 'react';
import { Alternador, Aviso, Botao, CampoSelecao, CampoTexto, Celula, Grade, Secao, Selo, Tabela, estilos } from './ui';
import { fichaApi, fmtData, fmtNum, mensagemDeErro, type CodigoBarras, type Ficha } from '@/lib/produto-ficha';
import { eanValido, svgEan } from '@/lib/codigo-barras-svg';
import './impressao-etiquetas.css';

const TIPOS: Array<{ valor: string; texto: string }> = [
  { valor: 'EAN13', texto: 'EAN-13' }, { valor: 'EAN8', texto: 'EAN-8' }, { valor: 'UPCA', texto: 'UPC-A' },
  { valor: 'GTIN14', texto: 'GTIN-14 (caixa)' }, { valor: 'INTERNO', texto: 'Código interno' }, { valor: 'BALANCA', texto: 'Código de balança (PLU)' },
];
const NOME_TIPO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.texto]));

/** Mesma checagem do backend, para avisar antes de enviar. */
function validar(codigo: string, tipo: string): string | null {
  const c = codigo.trim();
  if (!c) return 'Informe o código.';
  if (tipo === 'EAN13') return /^\d{13}$/.test(c) && eanValido(c) ? null : 'EAN-13: 13 dígitos e dígito verificador válido.';
  if (tipo === 'EAN8') return /^\d{8}$/.test(c) && eanValido(c) ? null : 'EAN-8: 8 dígitos e dígito verificador válido.';
  if (tipo === 'UPCA') return /^\d{12}$/.test(c) ? null : 'UPC-A: 12 dígitos.';
  if (tipo === 'GTIN14') return /^\d{14}$/.test(c) ? null : 'GTIN-14: 14 dígitos.';
  if (tipo === 'BALANCA') return /^\d{4,6}$/.test(c) ? null : 'PLU de balança: 4 a 6 dígitos.';
  return /^[A-Za-z0-9._-]{1,30}$/.test(c) ? null : 'Código interno: até 30 caracteres, sem espaços.';
}

export default function AbaCodigos({ ficha, podeEditar, aoAtualizar, avisar }: { ficha: Ficha; podeEditar: boolean; aoAtualizar: () => Promise<void>; avisar: (m: string, erro?: boolean) => void }) {
  const codigos = ficha.produto.codigosBarras;
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState('EAN13');
  const [descricao, setDescricao] = useState('');
  const [principal, setPrincipal] = useState(codigos.length === 0);
  const [enviando, setEnviando] = useState(false);
  const erro = codigo ? validar(codigo, tipo) : null;
  const [etiquetaCodigo, setEtiquetaCodigo] = useState('');
  const [quantidade, setQuantidade] = useState('6');

  async function adicionar() {
    if (validar(codigo, tipo)) return;
    setEnviando(true);
    try {
      await fichaApi.addCodigo(ficha.produto.id, { codigo: codigo.trim(), tipo, descricao: descricao.trim() || undefined, principal });
      setCodigo(''); setDescricao(''); setPrincipal(false);
      await aoAtualizar();
      avisar('Código adicionado.');
    } catch (e) { avisar(mensagemDeErro(e), true); } finally { setEnviando(false); }
  }
  async function excluir(c: CodigoBarras) {
    if (!window.confirm(`Excluir o código ${c.codigo}?${c.principal ? ' Ele é o principal: o produto ficará sem código principal.' : ''}`)) return;
    try { await fichaApi.delCodigo(ficha.produto.id, c.id); await aoAtualizar(); avisar('Código excluído.'); } catch (e) { avisar(mensagemDeErro(e), true); }
  }

  const imprimiveis = codigos.filter((c) => (c.tipo === 'EAN13' || c.tipo === 'EAN8') && eanValido(c.codigo));
  const escolhido = imprimiveis.find((c) => c.codigo === etiquetaCodigo) ?? imprimiveis[0];
  const svg = useMemo(() => (escolhido ? svgEan(escolhido.codigo, { modulo: 2, altura: 54 }) : null), [escolhido]);
  const qtd = Math.min(60, Math.max(1, Number(quantidade) || 1));
  const preco = Number(ficha.produto.precoVenda);

  function imprimir() {
    // A classe limita a regra de impressão a esta ação (impressao-etiquetas.css).
    document.body.classList.add('pf-imprimindo-etiquetas');
    const limpar = () => { document.body.classList.remove('pf-imprimindo-etiquetas'); window.removeEventListener('afterprint', limpar); };
    window.addEventListener('afterprint', limpar);
    window.print();
    setTimeout(limpar, 1000);
  }

  return (
    <>
      {podeEditar && (
        <Secao titulo="Adicionar código" descricao="Um produto pode ter vários códigos (EAN da unidade, GTIN da caixa, código interno, PLU de balança) sem duplicar o cadastro.">
          <Grade>
            <CampoTexto l={4} rotulo="Código" valor={codigo} onChange={setCodigo} maxLength={30} erro={erro ?? undefined} inputMode={tipo === 'INTERNO' ? 'text' : 'numeric'} />
            <CampoSelecao l={3} rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={TIPOS} />
            <CampoTexto l={3} rotulo="Descrição" valor={descricao} onChange={setDescricao} maxLength={120} placeholder="Ex.: caixa com 12" />
            <Alternador l={2} rotulo="Principal" ligado={principal} onChange={setPrincipal} alinharCampo />
            <Celula l={12}><Botao primario desabilitado={!!erro || !codigo || enviando} onClick={adicionar}>{enviando ? 'Adicionando…' : 'Adicionar código'}</Botao></Celula>
          </Grade>
        </Secao>
      )}

      <Secao titulo="Códigos do produto" descricao="Todos são reconhecidos pelo leitor no PDV (inclusive offline) e pela busca por código.">
        <Tabela<CodigoBarras>
          linhas={codigos} chave={(c) => c.id} vazio="Nenhum código cadastrado."
          colunas={[
            { chave: 'codigo', titulo: 'Código', render: (c) => <span className={estilos.nowrap}>{c.codigo}</span>, ordenar: (c) => c.codigo },
            { chave: 'tipo', titulo: 'Tipo', render: (c) => NOME_TIPO[c.tipo] ?? c.tipo, ordenar: (c) => c.tipo },
            { chave: 'descricao', titulo: 'Descrição', render: (c) => c.descricao ?? '—' },
            { chave: 'principal', titulo: 'Principal', render: (c) => (c.principal ? <Selo tom="ok">Principal</Selo> : '—') },
            { chave: 'criado', titulo: 'Cadastrado em', render: (c) => fmtData(c.createdAt, false) },
            ...(podeEditar ? [{ chave: 'acoes', titulo: '', render: (c: CodigoBarras) => <Botao pequeno perigo onClick={() => excluir(c)}>Excluir</Botao> }] : []),
          ]}
        />
      </Secao>

      <Secao titulo="Etiquetas" descricao="Impressão de etiquetas com o código de barras (EAN-13 ou EAN-8) e o preço de venda."
        acoes={<Botao desabilitado={!svg} onClick={imprimir}>Imprimir etiquetas</Botao>}>
        {imprimiveis.length === 0 ? (
          <Aviso>Cadastre um código EAN-13 ou EAN-8 válido para imprimir etiquetas.</Aviso>
        ) : (
          <>
            <Grade>
              <CampoSelecao l={4} rotulo="Código" valor={escolhido?.codigo ?? ''} onChange={setEtiquetaCodigo} opcoes={imprimiveis.map((c) => ({ valor: c.codigo, texto: `${c.codigo} (${NOME_TIPO[c.tipo]})` }))} />
              <CampoTexto l={2} rotulo="Quantidade" valor={quantidade} onChange={setQuantidade} numero inputMode="numeric" ajuda="Até 60" />
            </Grade>
            <div className={`${estilos.etiquetas} ${estilos.espaco4} pf-area-impressao`}>
              {svg && Array.from({ length: qtd }, (_, i) => (
                <div key={i} className={estilos.etiqueta}>
                  <div className={estilos.etiquetaNome}>{ficha.produto.descricaoResumida || ficha.produto.nome}</div>
                  {/* SVG gerado localmente a partir do código (sem dado externo). */}
                  <div dangerouslySetInnerHTML={{ __html: svg }} />
                  <div className={estilos.etiquetaPreco}>R$ {fmtNum(preco)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Secao>
    </>
  );
}
