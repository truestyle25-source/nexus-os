'use client';
// Abas próprias do WhatsApp Business e do E-mail na janela de configuração:
//  - Envio real (texto/modelo aprovado no WhatsApp; texto no e-mail) pelo backend;
//  - Histórico individual: mensagens enviadas/recebidas com status de entrega (WhatsApp)
//    e e-mails enviados com status (E-mail); caixa de entrada (IMAP) quando habilitada.
// Nada é simulado: o status exibido é o gravado pelo servidor/webhook.
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Send } from 'lucide-react';
import { mensagemDeErroApi } from '@/lib/erros-api';
import { formatDateTime } from '@/lib/format';
import { comunicacaoApi, listaDeEmails, ROTULO_STATUS_MENSAGEM, type EnvioEmailRegistro, type MensagemCaixa, type MensagemWhats } from '@/lib/integracoes-central';

const entrada = 'h-10 w-full rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 text-[13px] text-[var(--nx-ink)] placeholder:text-[var(--nx-ink-3)] focus:outline-none focus:border-[var(--nx-accent)]';
const area = 'w-full min-h-[84px] rounded-[10px] border border-[var(--nx-border)] bg-[var(--nx-surface-2)] px-3 py-2 text-[13px] text-[var(--nx-ink)] focus:outline-none focus:border-[var(--nx-accent)]';
const botaoPri = 'h-10 px-4 rounded-[10px] bg-[var(--nx-accent)] text-[13px] font-medium text-[var(--nx-ink)] hover:bg-[var(--nx-accent-2)] disabled:opacity-50 inline-flex items-center gap-2';
const botaoSec = 'h-9 px-3 rounded-[10px] border border-[var(--nx-border)] text-[12px] font-medium text-[var(--nx-ink-2)] hover:border-[var(--nx-border-strong)] disabled:opacity-40 inline-flex items-center gap-2';
const erroPadrao = 'Não foi possível concluir a operação.';

function corStatus(s: string) {
  if (s === 'FALHOU') return 'var(--nx-amber)';
  if (['ENTREGUE', 'LIDA', 'ENVIADO', 'RECEBIDA'].includes(s)) return 'var(--nx-green)';
  return 'var(--nx-ink-2)';
}

function Aviso({ ok, texto }: { ok: boolean; texto: string }) {
  return <p role={ok ? 'status' : 'alert'} className={`rounded-[10px] border px-3 py-2 text-[12px] ${ok ? 'border-[color-mix(in_srgb,var(--nx-green)_35%,var(--nx-border))] text-[var(--nx-green)]' : 'border-[color-mix(in_srgb,var(--nx-amber)_40%,var(--nx-border))] text-[var(--nx-amber)]'}`}>{texto}</p>;
}

// ----------------------------- WhatsApp -----------------------------------------
export function EnvioWhatsApp({ conectado }: { conectado: boolean }) {
  const [para, setPara] = useState('');
  const [tipo, setTipo] = useState<'TEXTO' | 'MODELO'>('MODELO');
  const [texto, setTexto] = useState('');
  const [modelo, setModelo] = useState('');
  const [idioma, setIdioma] = useState('pt_BR');
  const [parametros, setParametros] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar() {
    setAviso(null); setEnviando(true);
    try {
      const r = await comunicacaoApi.enviarWhats(tipo === 'TEXTO'
        ? { para, tipo, texto }
        : { para, tipo, modelo: { nome: modelo.trim(), idioma: idioma.trim(), parametros: parametros.split('|').map((p) => p.trim()).filter(Boolean) } });
      setAviso(r.status === 'ENVIADA' ? { ok: true, texto: 'Mensagem aceita pela Meta. A entrega e a leitura aparecem no Histórico quando o webhook confirmar.' } : { ok: false, texto: r.erro ?? 'Falha no envio.' });
    } catch (e) { setAviso({ ok: false, texto: mensagemDeErroApi(e, erroPadrao) }); } finally { setEnviando(false); }
  }

  if (!conectado) return <p className="text-[13px] text-[var(--nx-ink-3)]">Conecte e valide o WhatsApp na aba Configuração para enviar mensagens.</p>;
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--nx-ink-3)]">Texto livre só é aceito até 24 h após a última mensagem do cliente. Fora dessa janela, use um modelo aprovado pela Meta.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Telefone do cliente</span><input className={`${entrada} mt-1`} value={para} onChange={(e) => setPara(e.target.value)} placeholder="(11) 99999-8888" aria-label="Telefone do cliente" inputMode="tel" /></label>
        <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Tipo</span>
          <select className={`${entrada} mt-1`} value={tipo} onChange={(e) => setTipo(e.target.value as 'TEXTO' | 'MODELO')} aria-label="Tipo de mensagem"><option value="MODELO">Modelo aprovado</option><option value="TEXTO">Texto (janela de 24 h)</option></select>
        </label>
      </div>
      {tipo === 'TEXTO' ? (
        <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Mensagem</span><textarea className={`${area} mt-1`} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={4096} aria-label="Mensagem" /></label>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block sm:col-span-2"><span className="text-[12px] text-[var(--nx-ink-2)]">Nome do modelo</span><input className={`${entrada} mt-1 font-mono`} value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="confirmacao_pedido" aria-label="Nome do modelo" /></label>
          <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Idioma</span><input className={`${entrada} mt-1 font-mono`} value={idioma} onChange={(e) => setIdioma(e.target.value)} aria-label="Idioma do modelo" /></label>
          <label className="block sm:col-span-3"><span className="text-[12px] text-[var(--nx-ink-2)]">Parâmetros do corpo (separe com |)</span><input className={`${entrada} mt-1`} value={parametros} onChange={(e) => setParametros(e.target.value)} placeholder="Mariana | Pedido 1047" aria-label="Parâmetros do modelo" /></label>
        </div>
      )}
      <button type="button" className={botaoPri} onClick={enviar} disabled={enviando || !para.trim() || (tipo === 'TEXTO' ? !texto.trim() : !modelo.trim())}><Send className="w-4 h-4" />{enviando ? 'Enviando…' : 'Enviar mensagem'}</button>
      {aviso && <Aviso {...aviso} />}
    </div>
  );
}

export function HistoricoWhatsApp() {
  const [itens, setItens] = useState<MensagemWhats[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { setItens(null); comunicacaoApi.mensagensWhats().then(setItens).catch((e) => { setErro(mensagemDeErroApi(e, erroPadrao)); setItens([]); }); }, []);
  useEffect(() => { carregar(); }, [carregar]);
  return (
    <section className="space-y-2" aria-label="Mensagens do WhatsApp">
      <div className="flex items-center justify-between"><h3 className="text-[13px] font-semibold text-[var(--nx-ink)]">Mensagens</h3><button type="button" className={botaoSec} onClick={carregar}><RefreshCw className="w-3.5 h-3.5" />Atualizar</button></div>
      {erro && <Aviso ok={false} texto={erro} />}
      {itens === null ? <p className="text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : itens.length === 0 ? <p className="text-[13px] text-[var(--nx-ink-3)]">Nenhuma mensagem ainda.</p> : (
        <ul className="divide-y divide-[var(--nx-border)]" data-testid="mensagens-whatsapp">
          {itens.map((m) => (
            <li key={m.id} className="py-2.5 flex gap-3">
              {m.direcao === 'RECEBIDA' ? <ArrowDownLeft className="w-4 h-4 mt-0.5 shrink-0 text-[var(--nx-ink-2)]" /> : <ArrowUpRight className="w-4 h-4 mt-0.5 shrink-0 text-[var(--nx-ink-2)]" />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[var(--nx-ink)]">{m.direcao === 'RECEBIDA' ? 'De' : 'Para'} {m.nomeContato ? `${m.nomeContato} · ` : ''}+{m.telefone}</p>
                {m.conteudo && <p className="text-[12px] text-[var(--nx-ink-2)] break-words">{m.conteudo}</p>}
                {m.erro && <p className="text-[12px] text-[var(--nx-amber)] break-words">{m.erro}</p>}
                <p className="text-[11px] text-[var(--nx-ink-3)]">{formatDateTime(m.createdAt)} · <span style={{ color: corStatus(m.status) }}>{ROTULO_STATUS_MENSAGEM[m.status] ?? m.status}</span></p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------- E-mail -----------------------------------------
export function EnvioEmail({ conectado, recebe }: { conectado: boolean; recebe: boolean }) {
  const [para, setPara] = useState('');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [caixa, setCaixa] = useState<MensagemCaixa[] | null>(null);
  const [lendo, setLendo] = useState(false);

  async function enviar() {
    setAviso(null); setEnviando(true);
    try {
      const r = await comunicacaoApi.enviarEmail({ para: listaDeEmails(para), assunto, texto });
      setAviso(r.status === 'ENVIADO' ? { ok: true, texto: 'E-mail aceito pelo servidor SMTP.' } : { ok: false, texto: r.erro ?? 'Falha no envio.' });
    } catch (e) { setAviso({ ok: false, texto: mensagemDeErroApi(e, erroPadrao) }); } finally { setEnviando(false); }
  }
  async function lerCaixa() {
    setLendo(true); setAviso(null);
    try { setCaixa(await comunicacaoApi.caixa()); } catch (e) { setAviso({ ok: false, texto: mensagemDeErroApi(e, erroPadrao) }); } finally { setLendo(false); }
  }

  if (!conectado) return <p className="text-[13px] text-[var(--nx-ink-3)]">Conecte e valide a conta de e-mail na aba Configuração para enviar.</p>;
  return (
    <div className="space-y-3">
      <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Para (separe vários com vírgula)</span><input className={`${entrada} mt-1`} value={para} onChange={(e) => setPara(e.target.value)} placeholder="cliente@exemplo.com" aria-label="Destinatários" inputMode="email" /></label>
      <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Assunto</span><input className={`${entrada} mt-1`} value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={300} aria-label="Assunto" /></label>
      <label className="block"><span className="text-[12px] text-[var(--nx-ink-2)]">Mensagem</span><textarea className={`${area} mt-1`} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Mensagem do e-mail" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={botaoPri} onClick={enviar} disabled={enviando || !para.trim() || !assunto.trim() || !texto.trim()}><Send className="w-4 h-4" />{enviando ? 'Enviando…' : 'Enviar e-mail'}</button>
        {recebe && <button type="button" className={botaoSec} onClick={lerCaixa} disabled={lendo}><RefreshCw className="w-3.5 h-3.5" />{lendo ? 'Lendo…' : 'Ver caixa de entrada'}</button>}
      </div>
      {aviso && <Aviso {...aviso} />}
      {caixa && (caixa.length === 0 ? <p className="text-[13px] text-[var(--nx-ink-3)]">Caixa de entrada vazia.</p> : (
        <ul className="divide-y divide-[var(--nx-border)]" aria-label="Caixa de entrada">
          {caixa.map((m) => (
            <li key={m.uid} className="py-2">
              <p className={`text-[13px] ${m.lida ? 'text-[var(--nx-ink-2)]' : 'text-[var(--nx-ink)] font-semibold'} break-words`}>{m.assunto ?? '(sem assunto)'}</p>
              <p className="text-[11px] text-[var(--nx-ink-3)] break-words">{m.de ?? '—'}{m.data ? ` · ${formatDateTime(m.data)}` : ''}</p>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function HistoricoEmail() {
  const [itens, setItens] = useState<EnvioEmailRegistro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { comunicacaoApi.enviosEmail().then(setItens).catch((e) => { setErro(mensagemDeErroApi(e, erroPadrao)); setItens([]); }); }, []);
  return (
    <section className="space-y-2" aria-label="E-mails enviados">
      <h3 className="text-[13px] font-semibold text-[var(--nx-ink)]">E-mails enviados</h3>
      {erro && <Aviso ok={false} texto={erro} />}
      {itens === null ? <p className="text-[13px] text-[var(--nx-ink-3)]">Carregando…</p> : itens.length === 0 ? <p className="text-[13px] text-[var(--nx-ink-3)]">Nenhum e-mail enviado ainda.</p> : (
        <ul className="divide-y divide-[var(--nx-border)]" data-testid="envios-email">
          {itens.map((m) => (
            <li key={m.id} className="py-2.5">
              <p className="text-[13px] text-[var(--nx-ink)] break-words">{m.assunto}</p>
              <p className="text-[12px] text-[var(--nx-ink-2)] break-words">Para: {m.para}{m.anexos ? ` · ${m.anexos} anexo(s)` : ''}</p>
              {m.erro && <p className="text-[12px] text-[var(--nx-amber)]">{m.erro}</p>}
              <p className="text-[11px] text-[var(--nx-ink-3)]">{formatDateTime(m.createdAt)} · <span style={{ color: corStatus(m.status) }}>{ROTULO_STATUS_MENSAGEM[m.status] ?? m.status}</span></p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
