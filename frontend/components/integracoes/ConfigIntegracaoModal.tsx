'use client';
// Janela de configuração da Central de Integrações (abas Configuração · Sincronização · Histórico).
// Mesma linguagem visual dos modais da Central (tokens --nx-*). Campos variam por provedor
// (vêm do catálogo do backend). Segredos: só no estado do formulário enquanto a janela está
// aberta — nunca em localStorage; os salvos aparecem mascarados e "vazio = manter".
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, Info, Lock, Wifi, X, AlertTriangle } from 'lucide-react';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import {
  camposFaltando, centralApi, corDoStatus, ROTULO_OPERACAO, ROTULO_STATUS,
  type ConfiguracaoProvedor, type EventoIntegracao, type Provedor, type ResultadoTeste, type StatusCentral,
} from '@/lib/integracoes-central';

type Aba = 'config' | 'sync' | 'historico';

interface Props {
  provedor: Provedor;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  /** Fluxos OAuth existentes (Mercado Livre / Shopee) — a janela só os aciona. */
  oauth?: { autorizar: () => void; testar?: () => void; desconectar?: () => void; prontoServidor: boolean; ocupado: boolean; sincronizacao?: React.ReactNode };
  onClose: () => void;
  onAlterado: () => void;
}

const entrada = 'h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:outline-none focus:border-[var(--nx-accent)]';
const botaoSec = 'h-10 px-4 rounded-[10px] border border-[var(--nx-border)] text-[13px] font-medium text-[var(--nx-ink-2)] hover:border-[var(--nx-border-strong)] disabled:opacity-40 inline-flex items-center gap-2';
const botaoPri = 'h-10 px-4 rounded-[10px] bg-[var(--nx-accent)] text-[13px] font-medium text-[var(--nx-ink)] hover:bg-[var(--nx-accent-2)] disabled:opacity-50 inline-flex items-center gap-2';

export default function ConfigIntegracaoModal({ provedor, descricao, icone: Icone, oauth, onClose, onAlterado }: Props) {
  const [aba, setAba] = useState<Aba>('config');
  const [estado, setEstado] = useState<ConfiguracaoProvedor | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [visivel, setVisivel] = useState<Record<string, boolean>>({});
  const [avancadoAberto, setAvancadoAberto] = useState(false);
  const [acao, setAcao] = useState<null | 'testar' | 'salvar' | 'desconectar' | 'remover'>(null);
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const [eventos, setEventos] = useState<EventoIntegracao[] | null>(null);

  const credenciais = provedor.disponibilidade === 'CREDENCIAIS';

  const carregar = useCallback(async () => {
    try {
      const dados = await centralApi.configuracao(provedor.id);
      setEstado(dados);
      setValores({ ...(dados.configuracao?.config ?? {}) });
    } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível concluir a operação.')); }
  }, [provedor.id]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => {
    if (aba !== 'historico') return;
    setEventos(null);
    centralApi.historico(provedor.id).then(setEventos).catch((e) => { setErro(mensagemDeErroApi(e, 'Não foi possível concluir a operação.')); setEventos([]); });
  }, [aba, provedor.id]);

  const status: StatusCentral = estado?.status ?? 'NAO_CONFIGURADO';
  const salvos = estado?.configuracao?.segredosSalvos ?? {};
  const configurado = Object.values(salvos).some(Boolean);
  const faltando = camposFaltando(provedor.campos, valores, salvos);

  async function executar(tipo: 'testar' | 'salvar') {
    setErro(null); setResultado(null);
    if (faltando.length) { setErro(`Preencha: ${faltando.join(', ')}.`); return; }
    setAcao(tipo);
    try {
      const r = tipo === 'testar' ? await centralApi.testar(provedor.id, valores) : await centralApi.salvar(provedor.id, valores);
      setResultado(r);
      if (tipo === 'salvar') {
        // Segredos digitados saem do formulário assim que o servidor confirma.
        setValores((v) => Object.fromEntries(Object.entries(v).filter(([k]) => !provedor.campos.find((c) => c.chave === k)?.secreto)));
        await carregar(); onAlterado();
      }
    } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível concluir a operação.')); } finally { setAcao(null); }
  }

  async function desconectar() {
    setErro(null); setResultado(null); setAcao('desconectar');
    try { await centralApi.desconectar(provedor.id); await carregar(); onAlterado(); } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível concluir a operação.')); } finally { setAcao(null); }
  }

  async function remover() {
    setErro(null); setResultado(null); setAcao('remover');
    try { await centralApi.remover(provedor.id); setConfirmarRemocao(false); setValores({}); await carregar(); onAlterado(); } catch (e) { setErro(mensagemDeErroApi(e, 'Não foi possível concluir a operação.')); } finally { setAcao(null); }
  }

  const principais = provedor.campos.filter((c) => !c.avancado);
  const avancados = provedor.campos.filter((c) => c.avancado);

  const campo = (c: Provedor['campos'][number]) => (
    <label key={c.chave} className="block">
      <span className="text-[12px] font-medium text-[var(--nx-ink-2)]">{c.rotulo}{c.obrigatorio && <span className="text-[var(--nx-red)]"> *</span>}</span>
      {c.tipo === 'selecao' ? (
        <select className={`${entrada} mt-1.5`} value={valores[c.chave] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))} aria-label={c.rotulo}>
          <option value="">Selecione…</option>
          {c.opcoes?.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      ) : (
        <div className="relative mt-1.5">
          <input
            className={`${entrada} ${c.secreto ? 'pr-10 font-mono' : ''}`}
            type={c.secreto && !visivel[c.chave] ? 'password' : 'text'}
            autoComplete="off" spellCheck={false} aria-label={c.rotulo}
            placeholder={c.secreto && salvos[c.chave] ? `Salva (${salvos[c.chave]}) — deixe vazio para manter` : ''}
            value={valores[c.chave] ?? ''}
            onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
          />
          {c.secreto && (
            <button type="button" onClick={() => setVisivel((v) => ({ ...v, [c.chave]: !v[c.chave] }))} aria-label={visivel[c.chave] ? `Ocultar ${c.rotulo}` : `Mostrar ${c.rotulo}`} className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)]">
              {visivel[c.chave] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      )}
      {c.ajuda && <span className="mt-1 block text-[11px] text-[var(--nx-ink-3)]">{c.ajuda}</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-black/70" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Configurar ${provedor.nome}`} className="w-full sm:max-w-2xl max-h-[92vh] overflow-hidden rounded-t-[16px] sm:rounded-[16px] bg-[var(--nx-surface)] border border-[var(--nx-border)] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Cabeçalho */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="h-11 w-11 shrink-0 rounded-[12px] bg-[var(--nx-surface-2)] border border-[var(--nx-border)] flex items-center justify-center">
            <Icone className="w-5 h-5 text-[var(--nx-ink-2)]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-bold text-[var(--nx-ink)]">{provedor.nome}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nx-border)] px-2 py-0.5 text-[10px] font-medium" style={{ color: corDoStatus(status) }} data-testid="status-modal">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: corDoStatus(status) }} />{ROTULO_STATUS[status]}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--nx-ink-2)]">{descricao}</p>
            {estado?.conta && <p className="mt-0.5 text-[11px] text-[var(--nx-ink-3)] truncate">Conta: {estado.conta}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="h-8 w-8 shrink-0 rounded-[10px] border border-[var(--nx-border)] text-[var(--nx-ink-3)] hover:text-[var(--nx-ink)] inline-flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-4 px-5 border-b border-[var(--nx-border)] overflow-x-auto" role="tablist">
          {([['config', 'Configuração'], ['sync', 'Sincronização'], ['historico', 'Histórico']] as const).map(([id, rotulo]) => (
            <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={`h-10 shrink-0 text-[13px] font-medium border-b-2 ${aba === id ? 'border-[var(--nx-accent)] text-[var(--nx-ink)]' : 'border-transparent text-[var(--nx-ink-3)] hover:text-[var(--nx-ink-2)]'}`}>{rotulo}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {aba === 'config' && (
            <>
              {oauth ? (
                <>
                  <div className="rounded-[12px] border border-[color-mix(in_srgb,var(--nx-accent)_35%,var(--nx-border))] bg-[color-mix(in_srgb,var(--nx-accent)_8%,transparent)] p-3 flex gap-3">
                    <Info className="w-5 h-5 shrink-0 text-[var(--nx-accent)]" />
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--nx-ink)]">Conexão via {provedor.autenticacao}</p>
                      <p className="text-[12px] text-[var(--nx-ink-2)]">Autorize sua conta para permitir a integração com o NEXUS OS. As credenciais do aplicativo ficam no servidor; o NEXUS OS nunca pede sua senha.</p>
                    </div>
                  </div>
                  <ol className="space-y-3 text-[13px] text-[var(--nx-ink-2)]">
                    <li className="flex gap-3"><Passo n={1} /><div className="flex-1"><p>Clique no botão abaixo para autorizar sua conta:</p>
                      <button type="button" className={`${botaoPri} mt-2`} onClick={oauth.autorizar} disabled={oauth.ocupado || !oauth.prontoServidor} title={oauth.prontoServidor ? undefined : 'Servidor sem as credenciais do aplicativo'}>
                        <ExternalLink className="w-4 h-4" />{status === 'CONECTADO' ? 'Reautorizar' : 'Autorizar'} com {provedor.nome}
                      </button>
                      {!oauth.prontoServidor && <p className="mt-1.5 text-[11px] text-[var(--nx-amber)]">Aguardando as credenciais do aplicativo no servidor.</p>}
                    </div></li>
                    <li className="flex gap-3"><Passo n={2} /><p>Após a autorização, clique em Testar conexão para validar o acesso.</p></li>
                    <li className="flex gap-3"><Passo n={3} /><p>A conexão fica salva para esta empresa; o status aparece no card.</p></li>
                  </ol>
                </>
              ) : (
                <>
                  <div className="rounded-[12px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] p-3 flex gap-3">
                    <Lock className="w-5 h-5 shrink-0 text-[var(--nx-ink-2)]" />
                    <p className="text-[12px] text-[var(--nx-ink-2)]"><strong className="text-[var(--nx-ink)]">{provedor.autenticacao}.</strong> A credencial é cifrada no servidor e nunca volta para o navegador. {provedor.documentacao && <a href={provedor.documentacao} target="_blank" rel="noreferrer noopener" className="underline">Documentação oficial</a>}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">{principais.map(campo)}</div>
                  {avancados.length > 0 && (
                    <div className="border-y border-[var(--nx-border)]">
                      <button type="button" onClick={() => setAvancadoAberto((a) => !a)} aria-expanded={avancadoAberto} className="w-full h-11 flex items-center justify-between text-[13px] font-semibold text-[var(--nx-ink)]">
                        <span>Configurações avançadas <span className="font-normal text-[var(--nx-ink-3)]">(opcional)</span></span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${avancadoAberto ? 'rotate-180' : ''}`} />
                      </button>
                      {avancadoAberto && <div className="pb-4 grid grid-cols-1 gap-4">{avancados.map(campo)}</div>}
                    </div>
                  )}
                </>
              )}
              {estado?.erro && status !== 'CONECTADO' && !resultado && <Mensagem ok={false} texto={`Último erro: ${estado.erro}`} />}
              {resultado && <Mensagem ok={resultado.ok} texto={`${resultado.mensagem}${resultado.conta ? ` Conta: ${resultado.conta.nome}${resultado.conta.documento ? ` (${resultado.conta.documento})` : ''}.` : ''}`} />}
              {erro && <Mensagem ok={false} texto={erro} />}
              {credenciais && configurado && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" className={botaoSec} onClick={desconectar} disabled={acao !== null}>{acao === 'desconectar' ? 'Desconectando…' : 'Desconectar'}</button>
                  {!confirmarRemocao ? (
                    <button type="button" className={`${botaoSec} hover:text-[var(--nx-red)]`} onClick={() => setConfirmarRemocao(true)} disabled={acao !== null}>Remover</button>
                  ) : (
                    <span className="inline-flex flex-wrap items-center gap-2 text-[12px] text-[var(--nx-ink-2)]">Remover configuração e credenciais? O histórico é mantido.
                      <button type="button" className={`${botaoSec} text-[var(--nx-red)]`} onClick={remover} disabled={acao !== null}>{acao === 'remover' ? 'Removendo…' : 'Confirmar remoção'}</button>
                      <button type="button" className={botaoSec} onClick={() => setConfirmarRemocao(false)}>Voltar</button>
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {aba === 'sync' && (
            oauth?.sincronizacao ?? (
              <div className="space-y-2 text-[13px] text-[var(--nx-ink-2)]">
                <p>Última validação: {estado?.ultimoTesteEm ? formatDateTime(estado.ultimoTesteEm) : '—'}</p>
                <p>Última sincronização: {estado?.ultimoSyncEm ? formatDateTime(estado.ultimoSyncEm) : '—'}</p>
                <p className="text-[12px] text-[var(--nx-ink-3)]">Esta integração ainda não sincroniza dados automaticamente. A conexão com Financeiro e demais módulos chega na próxima fase.</p>
              </div>
            )
          )}

          {aba === 'historico' && (
            eventos === null ? <p className="text-[13px] text-[var(--nx-ink-3)]">Carregando…</p>
            : eventos.length === 0 ? <p className="text-[13px] text-[var(--nx-ink-3)]">Nenhum evento registrado ainda.</p>
            : (
              <ul className="divide-y divide-[var(--nx-border)]" data-testid="historico-integracao">
                {eventos.map((e) => (
                  <li key={e.id} className="py-2.5 flex items-start gap-3">
                    {e.resultado === 'SUCESSO' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-[var(--nx-green)] shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-[var(--nx-amber)] shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[var(--nx-ink)]">{ROTULO_OPERACAO[e.operacao] ?? e.operacao}{e.codigoErro ? ` · ${e.codigoErro}` : ''}</p>
                      {e.mensagem && <p className="text-[12px] text-[var(--nx-ink-2)] break-words">{e.mensagem}</p>}
                      <p className="text-[11px] text-[var(--nx-ink-3)]">{formatDateTime(e.em)}{e.usuario ? ` · ${e.usuario}` : ''}{e.duracaoMs != null ? ` · ${e.duracaoMs} ms` : ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        {/* Rodapé */}
        {aba === 'config' && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-t border-[var(--nx-border)]">
            {credenciais ? (
              <>
                <button type="button" className={botaoSec} onClick={() => executar('testar')} disabled={acao !== null}><Wifi className="w-4 h-4" />{acao === 'testar' ? 'Testando…' : 'Testar conexão'}</button>
                <div className="flex gap-2 ml-auto">
                  <button type="button" className={botaoSec} onClick={onClose}>Cancelar</button>
                  <button type="button" className={botaoPri} onClick={() => executar('salvar')} disabled={acao !== null}><Lock className="w-4 h-4" />{acao === 'salvar' ? 'Validando e salvando…' : 'Salvar configuração'}</button>
                </div>
              </>
            ) : (
              <>
                <button type="button" className={botaoSec} onClick={oauth?.testar} disabled={!oauth?.testar || oauth.ocupado || status !== 'CONECTADO'}><Wifi className="w-4 h-4" />Testar conexão</button>
                <div className="flex gap-2 ml-auto">
                  {oauth?.desconectar && status === 'CONECTADO' && <button type="button" className={botaoSec} onClick={oauth.desconectar} disabled={oauth.ocupado}>Desconectar</button>}
                  <button type="button" className={botaoSec} onClick={onClose}>Fechar</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Passo({ n }: { n: number }) {
  return <span className="h-6 w-6 shrink-0 rounded-full bg-[var(--nx-accent)] text-[var(--nx-ink)] text-[12px] font-bold inline-flex items-center justify-center">{n}</span>;
}

function Mensagem({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <div role={ok ? 'status' : 'alert'} className={`rounded-[10px] border px-3 py-2 text-[12px] flex gap-2 ${ok ? 'border-[color-mix(in_srgb,var(--nx-green)_35%,var(--nx-border))] text-[var(--nx-green)]' : 'border-[color-mix(in_srgb,var(--nx-amber)_40%,var(--nx-border))] text-[var(--nx-amber)]'}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}<span>{texto}</span>
    </div>
  );
}
