'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
import { t as traduzir, tMenu } from '@/lib/i18n';

/**
 * As quatro marcações do dia.
 *
 * São as mesmas quatro colunas de `Ponto` (`entrada`, `saidaIntervalo`,
 * `retornoIntervalo`, `saida`) — o tipo da marcação É o campo gravado. Antes
 * a tela só enviava `entrada`, então intervalo, retorno e saída nunca eram
 * preenchidos e a jornada não fechava.
 */
const TIPOS = {
  ENTRADA: 'Entrada',
  SAIDA_INTERVALO: 'Saída para intervalo',
  RETORNO: 'Retorno do intervalo',
  SAIDA: 'Saída final',
} as const;

/**
 * DIA do registro de ponto, lido da string ISO — nunca de `new Date(data)`.
 *
 * `Ponto.data` é `@db.Date`: o Postgres guarda a data pura e o Prisma devolve
 * `2026-10-02T00:00:00.000Z`. Isso é meia-noite UTC, que em São Paulo são as 21h
 * do dia ANTERIOR. `new Date(p.data).toLocaleDateString('pt-BR')` devolvia
 * 01/10/2026 para um ponto de 02/10 — a tabela inteira mostrava o dia errado,
 * e o gestor lia cada marcação na linha do dia anterior.
 *
 * O mesmo cuidado já está documentado em `rh/page.tsx` (`isoDia`).
 */
function diaDoRegistro(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const iso = typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * HORA da marcação, no fuso da EMPRESA.
 *
 * O servidor apura atraso e hora extra em `instanteNaHoraLocal(dia, prevista,
 * fuso)`. Mostrar a marcação no fuso do NAVEGADOR faria a hora da tela não
 * bater com o atraso calculado: um gestor em outro fuso (ou em viagem)
 * veria "entrada 09:00" num registro marcado com 12 minutos de atraso, sem
 * explicação. O fuso vem de `X-Fuso-Empresa` (header de `GET /ponto`); sem
 * ele, cai no fuso do navegador — comportamento anterior.
 */
function horaDaMarca(v: string | Date | null | undefined, fuso: string): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  if (!fuso) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso, hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    // Fuso inválido cadastrado: mostra no fuso do navegador em vez de sumir.
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

export default function Ponto() {
  const router = useRouter();
  const [pontos, setPontos] = useState<any[]>([]);
  const [funcs, setFuncs] = useState<any[]>([]);
  const [funcId, setFuncId] = useState('');
  // Data REAL, devolvida pelo servidor no fuso da empresa. Antes o campo vinha
  // de um `<input type="date">` que o usuário editava, e a batida era gravada na
  // data escolhida — não na data em que a pessoa bateu o ponto.
  const [data, setData] = useState('');
  const [fuso, setFuso] = useState('');
  const [tipo, setTipo] = useState<'ENTRADA' | 'SAIDA_INTERVALO' | 'RETORNO' | 'SAIDA'>('ENTRADA');
  const [error, setError] = useState<string | null>(null);
  /** Aviso de resultado cortado pelo limite da consulta (não é erro). */
  const [avisoPonto, setAvisoPonto] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Integração REAL do relógio, lida de GET /rh/relogio. */
  const [relogio, setRelogio] = useState<any>(null);
  const [sincronizando, setSincronizando] = useState(false);

  async function load() {
    try {
      const [{ data: p, headers }, { data: f }, { data: rel }] = await Promise.all([
        api.getComHeaders('/ponto'),
        api.get('/funcionarios'),
        // Integração REAL do equipamento (GET /rh/relogio). Traz o id que
        // `POST /ponto/sincronizar/:integracaoId` exige e o status que o
        // servidor verificou por healthcheck. Sem isto, a tela não sabia se
        // havia integração configurada e criava uma nova a cada clique.
        api.get('/rh/relogio'),
      ]);
      setPontos(p);
      setFuncs(f);
      setRelogio(rel ?? null);
      // O servidor marca quando a página veio cheia e ainda há linhas depois
      // (`X-Truncated`). Sem isto, uma empresa com muitos registros veria
      // "Registros (2000)" e não saberia que o histórico estava cortado — o
      // corte silencioso era pior do que o corte.
      const truncado = headers.get('x-truncated') === 'true';
      const total = headers.get('x-total-count');
      // Fuso da EMPRESA, carimbado pelo servidor. Antes desta tela só descobria
      // o fuso DEPOIS da primeira marcação (`bater()`), e até lá mostrava um
      // "America/Sao_Paulo" fixo no campo Data — que é o dia errado para uma
      // empresa fora do fuso de Brasília.
      const fusoEmpresa = headers.get('x-fuso-empresa');
      if (fusoEmpresa) setFuso(fusoEmpresa);
      setAvisoPonto(truncado
        ? `Mostrando ${Array.isArray(p) ? p.length : 0} de ${total ?? 'mais'} registros. Use o Espelho de Ponto para consultar um período.`
        : null);
      // Enquanto o servidor não carimbar uma marcação, o campo mostra o dia de
      // HOJE calculado no fuso da empresa. `toISOString()` usaria o fuso UTC do
      // navegador e, depois das 21h no Brasil, mostraria o dia seguinte — a mesma
      // confusão que corrigimos no servidor, só que na tela.
      //
      // Usa `fusoEmpresa` (o header) e NÃO o estado `fuso`: o `setFuso` acima
      // só surte efeito na PRÓXIMA renderização, então ler `fuso` aqui ainda
      // devolveria '' e a data sairia no fuso fixo de São Paulo.
      if (!data) {
        const agora = new Date();
        const zona = fusoEmpresa || fuso || 'America/Sao_Paulo';
        const noFuso = new Intl.DateTimeFormat('en-CA', {
          timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(agora);
        setData(noFuso);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível carregar o ponto.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getToken()) { router.replace('/'); return; }
    void load();
  }, [router]);

  async function bater() {
    setError(null); setNotice(null);
    try {
      // Só o funcionário e o TIPO vão. Data e horário saem do servidor: o
      // relógio do navegador pode estar errado, e a marcação é o fato do
      // instante em que aconteceu.
      const r = await api.post('/ponto/manual', { funcionarioId: funcId, tipo });
      const p = r.data;
      // A data exibida é a que o SERVIDOR gravou, não a do navegador: é a única
      // forma de a tela e o banco concordarem sobre o dia.
      setData(p.dataMarcacao || '');
      setFuso(p.fuso || '');
      setNotice(`${TIPOS[tipo]} registrada em ${p.dataMarcacao}.`);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Não foi possível bater o ponto.');
    }
  }

  /**
   * Sincroniza com o Control iD usando a integração REAL já configurada.
   *
   * O que esta função FAZIA antes (e por isso nunca podia funcionar):
   *   1. lia `NEXT_PUBLIC_CONTROLID_URL` do ambiente do navegador;
   *   2. se não existisse, parava com um erro;
   *   3. se existisse, chamava `POST /ponto/integracao` criava uma integração
   *      NOVA a cada clique, com `usuario: 'admin'` e
   *      `senha: '***-pendente-configuracao'` — a senha-placeholder era
   *      CRIPTOGRAFADA e gravada no PostgreSQL (rh.routes.ts:908), e só então a
   *      sincronização era tentada e falhava no login do equipamento.
   *
   * Ou seja: o botão criava lixo persistido no banco a cada clique e ainda
   * reportava falha. Agora ele age sobre a integração que JÁ existe
   * (`GET /rh/relogio`), cujo id é o que a rota de sincronização exige. Se
   * não houver equipamento configurado, a tela diz isso — sem gravar nada.
   */
  async function sincronizar() {
    setError(null); setNotice(null);
    if (!relogio?.configurado || !relogio?.id) {
      setError(
        'Nenhum equipamento Control iD configurado para esta empresa. ' +
        'Cadastre a integração em Integrações/RH antes de sincronizar — ' +
        'a senha real do equipamento é informada pelo gestor e criptografada pelo servidor.',
      );
      return;
    }
    setSincronizando(true);
    try {
      const { data: sync } = await api.post(`/ponto/sincronizar/${relogio.id}`, {});
      const processados = Number(sync?.processados ?? 0);
      setNotice(
        `Sincronização Control iD concluída: ${processados} batida(s) processada(s) ` +
        `pela API oficial (login.fcgi, load_objects.fcgi, logout.fcgi).`,
      );
      await load();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível sincronizar com o Control iD.');
    } finally {
      setSincronizando(false);
    }
  }

  if (loading) return <main className="admin-page"><ModuleHeader title="Controle de ponto" /><p className="empty-state">Carregando...</p></main>;

  return (
    <main className="admin-page">
      <ModuleHeader title="Controle de ponto" subtitle="Sincroniza só via API oficial do ControlID iDClass — entrada, saída, atrasos, faltas e horas extras alimentam o RH e o dashboard." />
      {error && <p className="admin-message admin-error">{error}</p>}
      {avisoPonto && <p className="admin-message">{avisoPonto}</p>}
      {notice && <p className="admin-message admin-success">{notice}</p>}

      <section className="admin-panel admin-wide">
        <div className="admin-inline">
          <label>{traduzir('funcionario', "Funcionário")}<select value={funcId} onChange={(e) => setFuncId(e.target.value)}><option value="">Selecione</option>{funcs.map((f: any) => <option key={f.id} value={f.id}>{f.nome}{f.idExternoPonto ? ` — ID ${f.idExternoPonto}` : ''}</option>)}</select></label>
          {/*
            Tipo da marcação. Antes não existia: a tela enviava só `entrada`, e
            intervalo/retorno/saída nunca eram gravados. Registrar a jornada
            exige escolher qual das quatro está sendo marcada.
          */}
          <label>Marcação<select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            {(Object.keys(TIPOS) as Array<keyof typeof TIPOS>).map((k) => (
              <option key={k} value={k}>{TIPOS[k]}</option>
            ))}
          </select></label>
          {/*
            Data que será gravada: só LEITURA. Antes era um `<input type="date">`
            editável, e a pessoa podia registrar a batida em qualquer dia. Agora
            o servidor carimba o instante real e devolve o dia que gravou, que é
            o que aparece aqui — no fuso da empresa, não no do navegador.
          */}
          <label>{traduzir('data', "Data")}<input type="date" value={data} readOnly title={fuso ? `Fuso da empresa: ${fuso}` : undefined} /></label>
          <button className="admin-primary" type="button" onClick={bater} disabled={!funcId}>Registrar {TIPOS[tipo].toLowerCase()}</button>
          <button className="admin-secondary auth-secondary" type="button" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar ControlID'}
          </button>
          {/* Status real do equipamento, lido de GET /rh/relogio. Antes a tela
              mostrava o botão igual com ou sem integração configurada. */}
          <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>
            {relogio?.configurado
              ? `${relogio.nome || 'Equipamento'} • ${relogio.status}`
              : 'Nenhum equipamento Control iD configurado'}
          </span>
        </div>
      </section>

      <section className="admin-panel admin-wide" style={{ marginTop: 16 }}>
        <h2>Registros ({pontos.length})</h2>
        {pontos.length === 0 ? <p className="empty-state">Nenhum registro de ponto ainda.</p> : (
          <table className="admin-simple-table">
            {/*
              As quatro marcações do dia. Antes a tabela tinha só ENTRADA e
              SAÍDA: `saidaIntervalo` e `retornoIntervalo` eram gravados no banco
              e devolvidos pela API, mas não tinham célula — a tela confirmava
              "marcação registrada" e não mostrava nada. O estilo das células
              é o mesmo das duas colunas que já existiam.
            */}
            <thead><tr><th>{traduzir('data', "Data")}</th><th>{traduzir('funcionario', "Funcionário")}</th><th>{traduzir('entrada', "Entrada")}</th><th>Saída intervalo</th><th>Retorno</th><th>{traduzir('saida', "Saída")}</th><th>{traduzir('atraso', "Atraso")}</th><th>Hora extra</th><th>{traduzir('falta', "Falta")}</th></tr></thead>
            <tbody>{pontos.map((p: any) => (
              <tr key={p.id}>
                <td>{diaDoRegistro(p.data)}</td>
                <td>{p.funcionario?.nome}</td>
                <td>{horaDaMarca(p.entrada, fuso)}</td>
                <td>{horaDaMarca(p.saidaIntervalo, fuso)}</td>
                <td>{horaDaMarca(p.retornoIntervalo, fuso)}</td>
                <td>{horaDaMarca(p.saida, fuso)}</td>
                <td>{p.atrasoMinutos}min</td>
                <td>{p.horaExtraMinutos}min</td>
                <td>{p.falta ? 'sim' : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </main>
  );
}
