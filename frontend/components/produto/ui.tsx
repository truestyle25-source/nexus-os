'use client';
// Componentes de base da ficha do produto. Todas as medidas vêm dos tokens de ficha.module.css.
import { useId, useMemo, useState, type ReactNode } from 'react';
import s from './ficha.module.css';

type Largura = 2 | 3 | 4 | 6 | 8 | 12;
const larguraClasse: Record<Largura, string> = { 2: s.c2, 3: s.c3, 4: s.c4, 6: s.c6, 8: s.c8, 12: s.c12 };
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export { s as estilos, cx };

export function Secao({ titulo, descricao, acoes, children }: { titulo: string; descricao?: string; acoes?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.secao} aria-label={titulo}>
      <div className={s.secaoTopo}>
        <div>
          <h3 className={s.secaoTitulo}>{titulo}</h3>
          {descricao && <p className={s.secaoDescricao}>{descricao}</p>}
        </div>
        {acoes && <div className={s.acoes}>{acoes}</div>}
      </div>
      {children}
    </section>
  );
}

export function Grade({ children }: { children: ReactNode }) {
  return <div className={s.grade}>{children}</div>;
}

export function Campo({ rotulo, l = 3, ajuda, erro, children, id }: { rotulo: string; l?: Largura; ajuda?: ReactNode; erro?: string; children: (id: string) => ReactNode; id?: string }) {
  const gerado = useId();
  const campoId = id ?? gerado;
  return (
    <div className={cx(s.campo, larguraClasse[l], erro && s.erroCampo)}>
      <label className={s.rotulo} htmlFor={campoId} title={rotulo}>{rotulo}</label>
      {children(campoId)}
      {erro ? <span className={s.erroTexto} role="alert">{erro}</span> : ajuda ? <span className={s.ajuda}>{ajuda}</span> : null}
    </div>
  );
}

type PropsTexto = { rotulo: string; valor: string; onChange?: (v: string) => void; l?: Largura; ajuda?: ReactNode; erro?: string; numero?: boolean; somenteLeitura?: boolean; placeholder?: string; tipo?: string; maxLength?: number; inputMode?: 'decimal' | 'numeric' | 'text' };
export function CampoTexto(p: PropsTexto) {
  return (
    <Campo rotulo={p.rotulo} l={p.l} ajuda={p.ajuda} erro={p.erro}>
      {(id) => (
        <input
          id={id} className={cx(s.entrada, p.numero && s.entradaNumero)} value={p.valor} type={p.tipo ?? 'text'}
          readOnly={p.somenteLeitura || !p.onChange} placeholder={p.placeholder} maxLength={p.maxLength}
          inputMode={p.inputMode ?? (p.numero ? 'decimal' : undefined)}
          onChange={(e) => p.onChange?.(e.target.value)}
        />
      )}
    </Campo>
  );
}

export function CampoArea(p: { rotulo: string; valor: string; onChange?: (v: string) => void; l?: Largura; ajuda?: ReactNode; maxLength?: number }) {
  return (
    <Campo rotulo={p.rotulo} l={p.l ?? 12} ajuda={p.ajuda}>
      {(id) => <textarea id={id} className={cx(s.entrada, s.area)} value={p.valor} maxLength={p.maxLength} readOnly={!p.onChange} onChange={(e) => p.onChange?.(e.target.value)} />}
    </Campo>
  );
}

export function CampoSelecao(p: { rotulo: string; valor: string; onChange?: (v: string) => void; opcoes: Array<{ valor: string; texto: string }>; l?: Largura; ajuda?: ReactNode; erro?: string; vazio?: string; desabilitado?: boolean }) {
  return (
    <Campo rotulo={p.rotulo} l={p.l} ajuda={p.ajuda} erro={p.erro}>
      {(id) => (
        <select id={id} className={s.entrada} value={p.valor} disabled={p.desabilitado || !p.onChange} onChange={(e) => p.onChange?.(e.target.value)}>
          {p.vazio !== undefined && <option value="">{p.vazio}</option>}
          {p.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      )}
    </Campo>
  );
}

export function Alternador({ rotulo, ligado, onChange, l = 3, desabilitado, ajuda, alinharCampo }: { rotulo: string; ligado: boolean; onChange?: (v: boolean) => void; l?: Largura; desabilitado?: boolean; ajuda?: string; alinharCampo?: boolean }) {
  const off = desabilitado || !onChange;
  return (
    <div className={cx(s.campo, larguraClasse[l], alinharCampo && s.alinharCampo)}>
      <label className={cx(s.alternador, ligado && s.alternadorLigado, off && s.alternadorDesligado)} title={ajuda ?? rotulo}>
        <input type="checkbox" role="switch" checked={ligado} disabled={off} onChange={(e) => onChange?.(e.target.checked)} aria-label={rotulo} />
        <span className={s.trilho} aria-hidden />
        <span className={s.alternadorTexto}>{rotulo}</span>
      </label>
      {ajuda && <span className={s.ajuda}>{ajuda}</span>}
    </div>
  );
}

export function Botao({ children, onClick, primario, perigo, pequeno, desabilitado, tipo = 'button', titulo }: { children: ReactNode; onClick?: () => void; primario?: boolean; perigo?: boolean; pequeno?: boolean; desabilitado?: boolean; tipo?: 'button' | 'submit'; titulo?: string }) {
  return (
    <button type={tipo} className={cx(s.botao, primario && s.botaoPrimario, perigo && s.botaoPerigo, pequeno && s.botaoPequeno)} onClick={onClick} disabled={desabilitado} title={titulo}>
      {children}
    </button>
  );
}

export function Selo({ children, tom }: { children: ReactNode; tom?: 'ok' | 'alerta' | 'erro' }) {
  return <span className={cx(s.selo, tom === 'ok' && s.seloOk, tom === 'alerta' && s.seloAlerta, tom === 'erro' && s.seloErro)}>{children}</span>;
}

export function Metrica({ rotulo, valor, ajuda }: { rotulo: string; valor: ReactNode; ajuda?: ReactNode }) {
  return (
    <div className={s.metrica}>
      <div className={s.metricaRotulo}>{rotulo}</div>
      <div className={s.metricaValor}>{valor}</div>
      {ajuda && <div className={s.metricaAjuda}>{ajuda}</div>}
    </div>
  );
}

export function Aviso({ children, tom }: { children: ReactNode; tom?: 'erro' | 'ok' }) {
  return <div className={cx(s.aviso, tom === 'erro' && s.avisoErro, tom === 'ok' && s.avisoOk)} role={tom === 'erro' ? 'alert' : undefined}>{children}</div>;
}

export interface Coluna<T> { chave: string; titulo: string; num?: boolean; render: (linha: T) => ReactNode; ordenar?: (linha: T) => string | number | null }

/** Tabela com ordenação por coluna, pesquisa local opcional, estados vazio/carregando e paginação. */
export function Tabela<T>({ colunas, linhas, carregando, vazio = 'Nenhum registro.', chave, pesquisa, paginacao }: {
  colunas: Array<Coluna<T>>; linhas: T[]; carregando?: boolean; vazio?: string; chave: (l: T, i: number) => string;
  pesquisa?: (l: T) => string;
  paginacao?: { pagina: number; limite: number; total: number; onPagina: (p: number) => void };
}) {
  const [ordem, setOrdem] = useState<{ chave: string; asc: boolean } | null>(null);
  const [termo, setTermo] = useState('');
  const visiveis = useMemo(() => {
    let r = linhas;
    if (pesquisa && termo.trim()) {
      const t = termo.trim().toLowerCase();
      r = r.filter((l) => pesquisa(l).toLowerCase().includes(t));
    }
    const col = ordem && colunas.find((c) => c.chave === ordem.chave);
    if (col?.ordenar) {
      r = [...r].sort((a, b) => {
        const va = col.ordenar!(a); const vb = col.ordenar!(b);
        if (va === vb) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return (va < vb ? -1 : 1) * (ordem!.asc ? 1 : -1);
      });
    }
    return r;
  }, [linhas, termo, ordem, colunas, pesquisa]);
  const paginas = paginacao ? Math.max(1, Math.ceil(paginacao.total / paginacao.limite)) : 1;
  return (
    <div>
      {pesquisa && (
        <div className={s.filtros}>
          <input className={s.entrada} placeholder="Pesquisar nesta lista…" value={termo} onChange={(e) => setTermo(e.target.value)} aria-label="Pesquisar" />
        </div>
      )}
      <div className={s.tabelaCaixa}>
        <table className={s.tabela}>
          <thead>
            <tr>
              {colunas.map((c) => (
                <th key={c.chave} className={c.num ? s.num : undefined} aria-sort={ordem?.chave === c.chave ? (ordem.asc ? 'ascending' : 'descending') : undefined}>
                  {c.ordenar ? (
                    <button type="button" onClick={() => setOrdem((o) => ({ chave: c.chave, asc: o?.chave === c.chave ? !o.asc : true }))}>
                      {c.titulo}{ordem?.chave === c.chave ? (ordem.asc ? ' ▲' : ' ▼') : ''}
                    </button>
                  ) : c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={colunas.length} className={s.vazio}>Carregando…</td></tr>
            ) : visiveis.length === 0 ? (
              <tr><td colSpan={colunas.length} className={s.vazio}>{vazio}</td></tr>
            ) : visiveis.map((l, i) => (
              <tr key={chave(l, i)}>
                {colunas.map((c) => <td key={c.chave} className={c.num ? s.num : undefined}>{c.render(l)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginacao && paginacao.total > 0 && (
        <div className={s.rodapeTabela}>
          <span>{paginacao.total} registro(s) · página {paginacao.pagina} de {paginas}</span>
          <span className={s.acoes}>
            <Botao pequeno desabilitado={paginacao.pagina <= 1} onClick={() => paginacao.onPagina(paginacao.pagina - 1)}>Anterior</Botao>
            <Botao pequeno desabilitado={paginacao.pagina >= paginas} onClick={() => paginacao.onPagina(paginacao.pagina + 1)}>Próxima</Botao>
          </span>
        </div>
      )}
    </div>
  );
}

export function Modal({ titulo, children, acoes, aoFechar }: { titulo: string; children: ReactNode; acoes: ReactNode; aoFechar: () => void }) {
  return (
    <div className={s.fundo} role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className={s.modal}>
        <h3 className={s.secaoTitulo} style={{ marginBottom: 'var(--pf-4)' }}>{titulo}</h3>
        {children}
        <div className={s.modalAcoes}>{acoes}</div>
      </div>
    </div>
  );
}

/** Célula da grade para conteúdo que não é um campo (botão, aviso). `alinharCampo` desce o conteúdo à linha dos campos. */
export function Celula({ l = 3, children, alinharCampo }: { l?: Largura; children: ReactNode; alinharCampo?: boolean }) {
  return <div className={cx(larguraClasse[l], alinharCampo && s.alinharCampo)}>{children}</div>;
}
