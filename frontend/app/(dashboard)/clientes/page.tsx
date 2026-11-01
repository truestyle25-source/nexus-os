'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Chart from 'chart.js/auto';
import {
  Archive,
  Download,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';
// Respeita Moeda / Idioma / Formato de hora da aba Configuracoes.
import { formatBRL } from '@/lib/format';
import { t as traduzir, tMenu } from '@/lib/i18n';

type StatusCliente = 'ATIVO' | 'INATIVO' | 'ARQUIVADO';
type TabCliente = 'TODOS' | StatusCliente;
type Ordenacao = 'valor' | 'compras' | 'recentes' | 'nome';

interface Cliente {
  id: string;
  empresaId: string;
  nome: string;
  documento: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  valorTotalComprado: number | string;
  ticketMedio: number | string;
  ultimaCompra: string | null;
  frequencia: number;
  status: StatusCliente;
  origem: string;
  createdAt: string;
  updatedAt: string;
}

interface ClienteForm {
  nome: string;
  documento: string;
  telefone: string;
  email: string;
  endereco: string;
  status: StatusCliente;
}

const FORM_VAZIO: ClienteForm = {
  nome: '',
  documento: '',
  telefone: '',
  email: '',
  endereco: '',
  status: 'ATIVO',
};

const styles = {
  card: 'bg-[var(--nexus-panel)] border border-[var(--nexus-border)] rounded-[16px] p-[18px]',
  input:
    'bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] rounded-[8px] h-[42px] px-[12px] text-[var(--nexus-text)] text-[13px] placeholder:text-[var(--nexus-muted)] focus:border-[var(--nexus-accent)] focus:outline-none',
  badgeAtivo:
    'bg-[rgba(var(--nx-green-rgb),0.10)] text-[var(--nx-green)] border border-[rgba(var(--nx-green-rgb),0.30)] rounded-[12px] px-[10px] py-[4px] text-[10px] font-semibold',
  badgeInativo:
    'bg-[var(--nexus-panel-2)] text-[var(--nexus-muted)] border border-[var(--nexus-border)] rounded-[12px] px-[10px] py-[4px] text-[10px]',
  btnPrimario:
    'bg-[var(--nexus-accent)] hover:bg-[var(--nexus-accent-2)] text-white text-[12px] font-bold rounded-[8px] px-[18px] h-[38px]',
  btnSecundario:
    'bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] text-[var(--nexus-muted)] rounded-[8px] text-[12px] px-[14px] h-[38px]',
  btnWhats:
    'bg-[rgba(var(--nx-green-rgb),0.10)] border border-[rgba(var(--nx-green-rgb),0.30)] text-[var(--nx-green)] rounded-[8px] text-[11px] px-[10px] h-[30px] font-bold',
  avatar:
    'w-[32px] h-[32px] rounded-[8px] bg-[var(--nexus-accent)] flex items-center justify-center text-[12px] font-bold text-white shrink-0',
  iaBar:
    'bg-[var(--nexus-panel)] border border-[var(--nexus-border)] rounded-[16px] p-[16px_18px] flex gap-[14px] items-center mb-[20px]',
  tabAtiva:
    'bg-[var(--nexus-accent)] text-white text-[12px] font-semibold px-[16px] py-[8px] rounded-[20px]',
  tabInativa:
    'bg-[var(--nexus-panel)] border border-[var(--nexus-border)] text-[var(--nexus-muted)] text-[12px] px-[16px] py-[8px] rounded-[20px]',
  th: 'text-[10px] text-[var(--nexus-muted)] uppercase tracking-[0.8px] p-[10px_8px] border-b border-[var(--nexus-border)] font-semibold text-left',
  td: 'text-[12px] text-[var(--nexus-text)] p-[12px_8px] border-b border-[var(--nexus-border)] leading-[1.3]',
  modalBase:
    'bg-[var(--nexus-panel)] border border-[var(--nexus-border)] rounded-[16px] p-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.18)] max-h-[90vh] overflow-y-auto',
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const numberFormatter = new Intl.NumberFormat('pt-BR');

function brl(valor: number | string | null | undefined): string {
  return formatBRL(valor);
}

function formatarData(valor: string | null | undefined): string {
  if (!valor) return '—';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '—' : dateFormatter.format(data);
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '—';
  return `${partes[0][0]}${partes.length > 1 ? partes[partes.length - 1][0] : ''}`.toUpperCase();
}

function statusLabel(status: StatusCliente): string {
  return status === 'ATIVO' ? 'Ativo' : status === 'INATIVO' ? 'Inativo' : 'Arquivado';
}

function normalizarStatus(valor: string | null | undefined): StatusCliente {
  return valor === 'INATIVO' || valor === 'ARQUIVADO' ? valor : 'ATIVO';
}

function extrairClientes(data: unknown): Cliente[] {
  if (Array.isArray(data)) return data as Cliente[];
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray((data as { clientes?: unknown }).clientes)) {
    return (data as { clientes: Cliente[] }).clientes;
  }
  if (Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: Cliente[] }).data;
  }
  return [];
}

function normalizarCliente(cliente: Cliente): Cliente {
  return {
    ...cliente,
    status: normalizarStatus(cliente.status),
    valorTotalComprado: Number(cliente.valorTotalComprado || 0),
    ticketMedio: Number(cliente.ticketMedio || 0),
    frequencia: Number(cliente.frequencia || 0),
  };
}

function mensagemErro(erro: unknown): string {
  return erro instanceof Error && erro.message
    ? erro.message
    : 'Não foi possível concluir a operação.';
}

export default function ClientesPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState('');
  const [tab, setTab] = useState<TabCliente>('TODOS');
  const [ordem, setOrdem] = useState<Ordenacao>('valor');
  const [form, setForm] = useState<ClienteForm>(FORM_VAZIO);
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [iaPergunta, setIaPergunta] = useState('');
  const [iaResposta, setIaResposta] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nomeInputRef = useRef<HTMLInputElement>(null);
  const graficoStatusRef = useRef<HTMLCanvasElement>(null);
  const graficoTopRef = useRef<HTMLCanvasElement>(null);
  const graficoStatus = useRef<Chart | null>(null);
  const graficoTop = useRef<Chart | null>(null);

  function mostrarToast(mensagem: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(mensagem);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    graficoStatus.current?.destroy();
    graficoTop.current?.destroy();
  }, []);

  async function carregarClientes() {
    setCarregando(true);
    setErro(null);
    try {
      // O backend esconde ARQUIVADO quando a chamada não traz `status` (default:
      // só ATIVO+INATIVO), então a base é montada com uma chamada por status.
      // `allSettled` (e não `Promise.all`) porque antes UMA falha qualquer —
      // por exemplo a consulta de ARQUIVADO — derrubava a aba inteira e mostrava
      // "erro" mesmo com as outras duas respostas já em mãos.
      const resultados = await Promise.allSettled(
        (['ATIVO', 'INATIVO', 'ARQUIVADO'] as const).map((status) =>
          api.get<Cliente[]>('/clientes', { params: { status } }),
        ),
      );
      const mapa = new Map<string, Cliente>();
      const falhas = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      resultados.forEach((resultado) => {
        if (resultado.status !== 'fulfilled') return;
        extrairClientes(resultado.value.data).forEach((item) => {
          const cliente = normalizarCliente(item);
          mapa.set(cliente.id, cliente);
        });
      });
      if (falhas.length === resultados.length) {
        // Nenhuma resposta veio: aí sim é erro de verdade (token, permissão, rede).
        setErro(mensagemErro(falhas[0].reason));
        return;
      }
      if (falhas.length > 0) {
        setErro(
          `Não foi possível carregar ${falhas.length} de ${resultados.length} faixa(s) de status. Os demais clientes foram listados normalmente.`,
        );
      }
      setClientes(Array.from(mapa.values()));
    } catch (erroCarregamento) {
      setErro(mensagemErro(erroCarregamento));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    void carregarClientes();
  }, [router]);

  const contagens = useMemo(() => ({
    todos: clientes.length,
    ativos: clientes.filter((cliente) => cliente.status === 'ATIVO').length,
    inativos: clientes.filter((cliente) => cliente.status === 'INATIVO').length,
    arquivados: clientes.filter((cliente) => cliente.status === 'ARQUIVADO').length,
  }), [clientes]);

  const kpis = useMemo(() => {
    const valorTotal = clientes.reduce((total, cliente) => total + Number(cliente.valorTotalComprado || 0), 0);
    const compras = clientes.reduce((total, cliente) => total + Number(cliente.frequencia || 0), 0);
    // Ticket médio = valor total / nº de compras. Antes era a média das médias
    // por cliente (`soma(ticketMedio) / nº de clientes`), que NÃO é o ticket
    // médio do negócio: com um cliente de 1 compra de R$ 1.000 e outro de 100
    // compras de R$ 10, a média das médias dá R$ 505, enquanto o valor real por
    // venda é R$ 19,90. O módulo Vendas já calcula como faturamento/qtdVendas —
    // agora a aba usa a mesma conta e não discorda do resto do sistema.
    const ticketMedio = compras > 0 ? valorTotal / compras : 0;
    return [
      { label: 'Clientes', value: numberFormatter.format(clientes.length) },
      { label: 'Ativos', value: numberFormatter.format(contagens.ativos) },
      { label: 'Inativos', value: numberFormatter.format(contagens.inativos) },
      { label: 'Compras registradas', value: numberFormatter.format(compras) },
      { label: 'Valor total comprado', value: brl(valorTotal) },
      { label: 'Ticket médio', value: brl(ticketMedio) },
    ];
  }, [clientes, contagens.ativos, contagens.inativos]);

  const clientesFiltrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR');
    const resultado = clientes.filter((cliente) => {
      const combinaStatus = tab === 'TODOS' || cliente.status === tab;
      const pesquisa = !termo || [cliente.nome, cliente.documento, cliente.telefone, cliente.email, cliente.endereco]
        .some((valor) => valor?.toLocaleLowerCase('pt-BR').includes(termo));
      return combinaStatus && pesquisa;
    });
    return [...resultado].sort((a, b) => {
      if (ordem === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
      if (ordem === 'compras') return b.frequencia - a.frequencia;
      if (ordem === 'recentes') return new Date(b.ultimaCompra || b.createdAt).getTime() - new Date(a.ultimaCompra || a.createdAt).getTime();
      return Number(b.valorTotalComprado || 0) - Number(a.valorTotalComprado || 0);
    });
  }, [busca, clientes, ordem, tab]);

  const topClientes = useMemo(
    () => [...clientes].sort((a, b) => Number(b.valorTotalComprado || 0) - Number(a.valorTotalComprado || 0)).slice(0, 5),
    [clientes],
  );

  useEffect(() => {
    const canvas = graficoStatusRef.current;
    if (!canvas) return;
    const temaCores = getComputedStyle(document.documentElement);
    const corVerde = temaCores.getPropertyValue('--nx-green').trim() || '#22c55e';
    const corNeutra = temaCores.getPropertyValue('--nexus-muted').trim() || '#6a6a7a';
    const corAcento = temaCores.getPropertyValue('--nexus-accent').trim() || '#7c3aed';
    const corBorda = temaCores.getPropertyValue('--nexus-border').trim() || '#23233f';
    const corPainel = temaCores.getPropertyValue('--nexus-panel').trim() || '#15152b';
    graficoStatus.current?.destroy();
    graficoStatus.current = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Ativos', 'Inativos', 'Arquivados'],
        datasets: [{ data: [contagens.ativos, contagens.inativos, contagens.arquivados], backgroundColor: [corVerde, corNeutra, corAcento], borderColor: corPainel, borderWidth: 3 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { color: corNeutra, boxWidth: 10, font: { size: 10 } } } } },
    });
    return () => { graficoStatus.current?.destroy(); graficoStatus.current = null; };
  }, [contagens.ativos, contagens.inativos, contagens.arquivados]);

  useEffect(() => {
    const canvas = graficoTopRef.current;
    if (!canvas) return;
    const temaCores = getComputedStyle(document.documentElement);
    const corVerde = temaCores.getPropertyValue('--nx-green').trim() || '#22c55e';
    const corNeutra = temaCores.getPropertyValue('--nexus-muted').trim() || '#6a6a7a';
    const corAcento = temaCores.getPropertyValue('--nexus-accent').trim() || '#7c3aed';
    const corBorda = temaCores.getPropertyValue('--nexus-border').trim() || '#23233f';
    const corPainel = temaCores.getPropertyValue('--nexus-panel').trim() || '#15152b';
    graficoTop.current?.destroy();
    graficoTop.current = new Chart(canvas, {
      type: 'bar',
      data: { labels: topClientes.map((cliente) => iniciais(cliente.nome)), datasets: [{ label: 'Valor comprado', data: topClientes.map((cliente) => Number(cliente.valorTotalComprado || 0)), backgroundColor: corAcento, borderRadius: 6, borderSkipped: false }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { grid: { display: false }, ticks: { color: corNeutra, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: corBorda }, ticks: { color: corNeutra, font: { size: 10 }, callback: (value) => brl(Number(value)) } } },
        plugins: { legend: { display: false } },
      },
    });
    return () => { graficoTop.current?.destroy(); graficoTop.current = null; };
  }, [topClientes]);
  useEffect(() => {
    const atualizarCoresGraficos = () => {
      const estilo = getComputedStyle(document.documentElement);

      const verde = estilo.getPropertyValue('--nx-green').trim() || '#22c55e';
      const neutra = estilo.getPropertyValue('--nexus-muted').trim() || '#6a6a7a';
      const acento = estilo.getPropertyValue('--nexus-accent').trim() || '#7c3aed';
      const borda = estilo.getPropertyValue('--nexus-border').trim() || '#23233f';
      const painel = estilo.getPropertyValue('--nexus-panel').trim() || '#15152b';

      const graficoStatusAtual = graficoStatus.current;

      if (graficoStatusAtual) {
        const dataset = graficoStatusAtual.data.datasets[0];

        if (dataset) {
          dataset.backgroundColor = [verde, neutra, acento];
          dataset.borderColor = painel;
        }

        const legenda = graficoStatusAtual.options.plugins?.legend?.labels;

        if (legenda) {
          legenda.color = neutra;
        }

        graficoStatusAtual.update('none');
      }

      const graficoTopAtual = graficoTop.current;

      if (graficoTopAtual) {
        const dataset = graficoTopAtual.data.datasets[0];

        if (dataset) {
          dataset.backgroundColor = acento;
        }

        const escalas = graficoTopAtual.options.scales;

        if (escalas?.x?.ticks) {
          escalas.x.ticks.color = neutra;
        }

        if (escalas?.y?.ticks) {
          escalas.y.ticks.color = neutra;
        }

        if (escalas?.y?.grid) {
          escalas.y.grid.color = borda;
        }

        graficoTopAtual.update('none');
      }
    };

    const observador = new MutationObserver(() => {
      requestAnimationFrame(atualizarCoresGraficos);
    });

    const opcoes: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style']
    };

    observador.observe(document.documentElement, opcoes);

    if (document.body) {
      observador.observe(document.body, opcoes);
    }

    atualizarCoresGraficos();

    return () => observador.disconnect();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setForm(FORM_VAZIO);
    setModalAberto(true);
    setTimeout(() => nomeInputRef.current?.focus(), 0);
  }

  function abrirEdicao(cliente: Cliente) {
    setEditando(cliente);
    setForm({ nome: cliente.nome, documento: cliente.documento || '', telefone: cliente.telefone || '', email: cliente.email || '', endereco: cliente.endereco || '', status: cliente.status });
    setModalAberto(true);
    setTimeout(() => nomeInputRef.current?.focus(), 0);
  }

  function fecharModal() {
    if (salvando) return;
    setModalAberto(false);
    setEditando(null);
    setForm(FORM_VAZIO);
  }

  useEffect(() => {
    if (!modalAberto) return;
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') fecharModal(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modalAberto, salvando]);

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!form.nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      // `status` vai no MESMO corpo do POST/PUT: antes a aba criava/editava e
      // depois fazia um PATCH separado só para o status. Se essa 2ª chamada
      // falhasse, o cadastro já estaria gravado, a tela mostraria erro e o
      // retry duplicaria o cliente. Uma requisição só fecha essa janela.
      const payload = {
        nome: form.nome.trim(),
        documento: form.documento.trim() || undefined,
        telefone: form.telefone.trim() || undefined,
        email: form.email.trim() || undefined,
        endereco: form.endereco.trim() || undefined,
        status: form.status,
        origem: 'MANUAL',
      };
      if (editando) {
        await api.put(`/clientes/${editando.id}`, payload);
        mostrarToast('Cliente atualizado com sucesso.');
      } else {
        await api.post<Cliente>('/clientes', payload);
        mostrarToast('Cliente cadastrado com sucesso.');
      }
      setModalAberto(false);
      setEditando(null);
      setForm(FORM_VAZIO);
      await carregarClientes();
    } catch (erroSalvar) {
      setErro(mensagemErro(erroSalvar));
    } finally {
      setSalvando(false);
    }
  }

  async function arquivar(cliente: Cliente) {
    if (!window.confirm(`Arquivar ${cliente.nome}?`)) return;
    setErro(null);
    try {
      await api.patch(`/clientes/${cliente.id}/status`, { status: 'ARQUIVADO' });
      mostrarToast('Cliente arquivado.');
      await carregarClientes();
    } catch (erroArquivar) {
      setErro(mensagemErro(erroArquivar));
    }
  }

  function analisarIA() {
    const pergunta = iaPergunta.trim();
    if (!pergunta) { setIaResposta('Digite uma pergunta sobre os clientes.'); return; }
    const normalizada = pergunta.toLocaleLowerCase('pt-BR');
    const inativos = clientes.filter((cliente) => cliente.status === 'INATIVO');
    const topo = [...clientes].sort((a, b) => Number(b.valorTotalComprado || 0) - Number(a.valorTotalComprado || 0))[0];
    if (normalizada.includes('inativ') || normalizada.includes('risco') || normalizada.includes('saiu')) {
      setTab('INATIVO');
      setIaResposta(inativos.length ? `${inativos.length} cliente(s) inativo(s) na base. A tabela está filtrando por Inativos.` : 'Nenhum cliente inativo encontrado na base.');
    } else if (normalizada.includes('top') || normalizada.includes('ltv') || normalizada.includes('valor')) {
      setOrdem('valor');
      setIaResposta(topo ? `${topo.nome} lidera o valor total comprado: ${brl(topo.valorTotalComprado)}.` : 'Ainda não há valores de compras para comparar.');
    } else if (normalizada.includes('compr') || normalizada.includes('frequ')) {
      setOrdem('compras');
      const maisFrequente = [...clientes].sort((a, b) => b.frequencia - a.frequencia)[0];
      setIaResposta(maisFrequente ? `${maisFrequente.nome} possui ${maisFrequente.frequencia} compra(s) registrada(s).` : 'Ainda não há compras registradas.');
    } else {
      setIaResposta(`A base possui ${clientes.length} cliente(s), ${contagens.ativos} ativo(s) e ${contagens.inativos} inativo(s).`);
    }
  }

  function exportarCSV() {
    const linhas = [
      ['Nome', 'Documento', 'Telefone', 'Email', 'Endereço', 'Status', 'Compras', 'Valor total', 'Ticket médio', 'Última compra'],
      ...clientesFiltrados.map((cliente) => [cliente.nome, cliente.documento || '', cliente.telefone || '', cliente.email || '', cliente.endereco || '', statusLabel(cliente.status), String(cliente.frequencia), String(cliente.valorTotalComprado), String(cliente.ticketMedio), cliente.ultimaCompra || '']),
    ];
    const csv = linhas.map((linha) => linha.map((celula) => `"${String(celula).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clientes_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function limparFiltros() {
    setBusca('');
    setTab('TODOS');
    setOrdem('valor');
  }

  function atualizarForm(campo: keyof ClienteForm, valor: string) {
    setForm((atual) => campo === 'status'
      ? { ...atual, status: valor as StatusCliente }
      : { ...atual, [campo]: valor });
  }

  return (
    <main className="p-6 md:p-8 space-y-5 max-w-[1400px] mx-auto">
      <ModuleHeader
        kicker="CRM"
        title={traduzir('clientes', "Clientes")}
        subtitle="Base real da empresa: cadastro, histórico de compras, status e leitura da IA sobre os seus dados."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportarCSV}
              disabled={clientesFiltrados.length === 0}
              className={`${styles.btnSecundario} inline-flex items-center gap-2 disabled:opacity-40`}
            >
              <Download className="w-4 h-4" />
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={abrirNovo}
              className={`${styles.btnPrimario} inline-flex items-center gap-2`}
            >
              <Plus className="w-4 h-4" />
              Novo cliente
            </button>
          </div>
        }
      />

      {erro && (
        <div
          role="alert"
          className="bg-[rgba(var(--nx-red-rgb),0.10)] border border-[rgba(var(--nx-red-rgb),0.30)] text-[var(--nx-red)] rounded-[14px] px-4 py-3 text-[12.5px]"
        >
          {erro}
        </div>
      )}

      {/* Indicadores reais da base */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={styles.card}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--nexus-muted)] font-semibold">
              {kpi.label}
            </p>
            <p className="text-[18px] font-bold text-[var(--nexus-text)] mt-1.5 truncate">{kpi.value}</p>
          </div>
        ))}
      </section>

      {/* Leitura da IA sobre a base real (só conta o que existe) */}
      <section className={styles.iaBar}>
        <div className="w-9 h-9 rounded-[10px] bg-[var(--nexus-accent)] flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <form
            onSubmit={(evento) => {
              evento.preventDefault();
              analisarIA();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={iaPergunta}
              onChange={(evento) => setIaPergunta(evento.target.value)}
              placeholder="Pergunte à IA sobre a base de clientes (inativos, top valor, frequência…)"
              aria-label="Pergunta para a IA sobre clientes"
              className={`${styles.input} flex-1 min-w-[220px]`}
            />
            <button type="submit" className={styles.btnPrimario}>
              Analisar
            </button>
          </form>
          {iaResposta && (
            <p className="text-[12px] text-[var(--nexus-text)] leading-relaxed mt-2.5">{iaResposta}</p>
          )}
        </div>
      </section>


      {/* Gráficos reais da base */}
      <section className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
        <div className={styles.card}>
          <h2 className="text-[13px] font-semibold text-[var(--nexus-text)]">Clientes por status</h2>
          <p className="text-[11px] text-[var(--nexus-muted)] mt-1">Distribuição atual da base cadastrada.</p>
          <div className="relative h-[210px] mt-4">
            <canvas ref={graficoStatusRef} />
          </div>
        </div>
        <div className={styles.card}>
          <h2 className="text-[13px] font-semibold text-[var(--nexus-text)]">Top 5 por valor comprado</h2>
          <p className="text-[11px] text-[var(--nexus-muted)] mt-1">
            Somente clientes com compras registradas aparecem com valor.
          </p>
          <div className="relative h-[210px] mt-4">
            {topClientes.length === 0 ? (
              <p className="text-[12px] text-[var(--nexus-muted)] h-full flex items-center justify-center text-center px-4">
                Nenhuma compra registrada para ranquear ainda.
              </p>
            ) : (
              <canvas ref={graficoTopRef} />
            )}
          </div>
        </div>
      </section>

      {/* Base de clientes */}
      <section className={styles.card}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--nexus-muted)]" />
            <input
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar por nome, documento, telefone, e-mail ou endereço"
              aria-label="Buscar clientes"
              className={`${styles.input} w-full pl-9`}
            />
          </div>
          <select
            value={ordem}
            onChange={(evento) => setOrdem(evento.target.value as Ordenacao)}
            aria-label="Ordenar clientes por"
            className={`${styles.input} min-w-[190px]`}
          >
            <option className="bg-[var(--nexus-panel-2)]" value="valor">Maior valor comprado</option>
            <option className="bg-[var(--nexus-panel-2)]" value="compras">Mais compras</option>
            <option className="bg-[var(--nexus-panel-2)]" value="recentes">Compra mais recente</option>
            <option className="bg-[var(--nexus-panel-2)]" value="nome">Nome (A–Z)</option>
          </select>
          <button
            type="button"
            onClick={limparFiltros}
            className={`${styles.btnSecundario} inline-flex items-center gap-2`}
          >
            <RotateCcw className="w-4 h-4" />
            Limpar filtros
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-4" role="tablist" aria-label={traduzir('filtrar_por_status', "Filtrar por status")}>
          {(
            [
              ['TODOS', contagens.todos],
              ['ATIVO', contagens.ativos],
              ['INATIVO', contagens.inativos],
              ['ARQUIVADO', contagens.arquivados],
            ] as Array<[TabCliente, number]>
          ).map(([valor, total]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={tab === valor}
              onClick={() => setTab(valor)}
              className={tab === valor ? styles.tabAtiva : styles.tabInativa}
            >
              {valor === 'TODOS' ? 'Todos' : statusLabel(valor)} ({numberFormatter.format(total)})
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="space-y-2 mt-4" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((linha) => (
              <div
                key={linha}
                className="h-[46px] rounded-[10px] bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] animate-pulse"
              />
            ))}
          </div>
        ) : clientesFiltrados.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[13px] font-medium text-[var(--nexus-text)]">
              {clientes.length === 0
                ? 'Nenhum cliente cadastrado ainda'
                : 'Nenhum cliente encontrado com estes filtros'}
            </p>
            <p className="text-[11.5px] text-[var(--nexus-muted)] mt-1.5">
              {clientes.length === 0
                ? 'Cadastre o primeiro cliente para começar a acompanhar compras e ticket médio.'
                : 'Ajuste a busca, o status ou a ordenação para ver outros resultados.'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-4">
              {clientes.length > 0 && (
                <button type="button" onClick={limparFiltros} className={styles.btnSecundario}>
                  Limpar filtros
                </button>
              )}
              <button type="button" onClick={abrirNovo} className={styles.btnPrimario}>
                Novo cliente
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto mt-4">
              <table className="w-full min-w-[980px] border-collapse">
                <thead>
                  <tr>
                    {[
                      'Cliente',
                      'Documento',
                      'Contato',
                      'Compras',
                      'Valor total',
                      'Ticket médio',
                      'Última compra',
                      'Status',
                      'Ações',
                    ].map((coluna) => (
                      <th key={coluna} scope="col" className={styles.th}>
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientesFiltrados.map((cliente) => {
                    const telefoneWhats = (cliente.telefone || '').replace(/\D/g, '');
                    return (
                      <tr key={cliente.id} className="hover:bg-[var(--nexus-panel-2)] transition-colors">
                        <td className={styles.td}>
                          <div className="flex items-center gap-2.5">
                            <span className={styles.avatar}>{iniciais(cliente.nome)}</span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-[var(--nexus-text)] truncate max-w-[220px]">
                                {cliente.nome}
                              </span>
                              <span className="block text-[10.5px] text-[var(--nexus-muted)]">
                                {cliente.origem || 'MANUAL'}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className={styles.td}>{cliente.documento || '—'}</td>

                        <td className={styles.td}>
                          <span className="block">{cliente.telefone || '—'}</span>
                          <span className="block text-[10.5px] text-[var(--nexus-muted)]">
                            {cliente.email || '—'}
                          </span>
                        </td>
                        <td className={styles.td}>{numberFormatter.format(cliente.frequencia)}</td>
                        <td className={styles.td}>{brl(cliente.valorTotalComprado)}</td>
                        <td className={styles.td}>{brl(cliente.ticketMedio)}</td>
                        <td className={styles.td}>{formatarData(cliente.ultimaCompra)}</td>
                        <td className={styles.td}>
                          <span
                            className={
                              cliente.status === 'ATIVO' ? styles.badgeAtivo : styles.badgeInativo
                            }
                          >
                            {statusLabel(cliente.status)}
                          </span>
                        </td>
                        <td className={styles.td}>
                          <div className="flex items-center gap-1.5">
                            {telefoneWhats && (
                              <a
                                href={`https://wa.me/${telefoneWhats}`}
                                target="_blank"
                                rel="noreferrer"
                                title={`Falar com ${cliente.nome} no WhatsApp`}
                                className={`${styles.btnWhats} inline-flex items-center gap-1`}
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                WhatsApp
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => abrirEdicao(cliente)}
                              aria-label={`Editar ${cliente.nome}`}
                              title="Editar cliente"
                              className="w-[30px] h-[30px] rounded-[8px] bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] text-[var(--nexus-muted)] hover:text-[var(--nexus-text)] inline-flex items-center justify-center transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {cliente.status !== 'ARQUIVADO' && (
                              <button
                                type="button"
                                onClick={() => void arquivar(cliente)}
                                aria-label={`Arquivar ${cliente.nome}`}
                                title="Arquivar cliente"
                                className="w-[30px] h-[30px] rounded-[8px] bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] text-[var(--nexus-muted)] hover:text-[var(--nexus-text)] inline-flex items-center justify-center transition-colors"
                              >
                                <Archive className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--nexus-muted)] mt-3">
              Mostrando {numberFormatter.format(clientesFiltrados.length)} de{' '}
              {numberFormatter.format(clientes.length)} cliente(s) da base.
            </p>
          </>
        )}
      </section>

      {/* Modal de cadastro/edição */}
      {modalAberto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="clientes-backdrop absolute inset-0 bg-black/60 backdrop-blur-[6px]"
            onClick={fecharModal}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editando ? 'Editar cliente' : 'Novo cliente'}
            className={`clientes-modal relative w-full max-w-[560px] ${styles.modalBase}`}
          >
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-[16px] font-bold text-[var(--nexus-text)]">
                  {editando ? 'Editar cliente' : 'Novo cliente'}
                </h2>
                <p className="text-[11.5px] text-[var(--nexus-muted)] mt-1">
                  {editando
                    ? 'Os dados são gravados na base real da empresa.'
                    : 'O histórico de compras passa a ser calculado a partir das vendas vinculadas.'}
                </p>
              </div>
              <button
                type="button"
                onClick={fecharModal}
                disabled={salvando}
                aria-label={traduzir('fechar', "Fechar")}
                className="w-8 h-8 rounded-[8px] bg-[var(--nexus-panel-2)] border border-[var(--nexus-border)] text-[var(--nexus-muted)] hover:text-[var(--nexus-text)] inline-flex items-center justify-center transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={salvar} className="space-y-3.5">
              <label className="block">
                <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">Nome *</span>
                <input
                  ref={nomeInputRef}
                  required
                  value={form.nome}
                  onChange={(evento) => atualizarForm('nome', evento.target.value)}
                  placeholder="Nome completo ou razão social"
                  className={`${styles.input} w-full`}
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block">
                  <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">CPF/CNPJ</span>
                  <input
                    value={form.documento}
                    onChange={(evento) => atualizarForm('documento', evento.target.value)}
                    placeholder="Somente números"
                    className={`${styles.input} w-full`}
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">{traduzir('telefone', "Telefone")}</span>
                  <input
                    value={form.telefone}
                    onChange={(evento) => atualizarForm('telefone', evento.target.value)}
                    placeholder="(11) 90000-0000"
                    className={`${styles.input} w-full`}
                  />
                </label>
              </div>
              <label className="block">
                <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">{traduzir('e_mail', "E-mail")}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(evento) => atualizarForm('email', evento.target.value)}
                  placeholder="cliente@email.com"
                  className={`${styles.input} w-full`}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">{traduzir('endereco', "Endereço")}</span>
                <input
                  value={form.endereco}
                  onChange={(evento) => atualizarForm('endereco', evento.target.value)}
                  placeholder="Rua, número, bairro, cidade"
                  className={`${styles.input} w-full`}
                />
              </label>
              <label className="block">
                <span className="block text-[11px] text-[var(--nexus-muted)] mb-1.5">{traduzir('status', "Status")}</span>
                <select
                  value={form.status}
                  onChange={(evento) => atualizarForm('status', evento.target.value)}
                  className={`${styles.input} w-full`}
                >
                  <option className="bg-[var(--nexus-panel-2)]" value="ATIVO">{traduzir('ativo', "Ativo")}</option>
                  <option className="bg-[var(--nexus-panel-2)]" value="INATIVO">{traduzir('inativo', "Inativo")}</option>
                  <option className="bg-[var(--nexus-panel-2)]" value="ARQUIVADO">Arquivado</option>
                </select>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={fecharModal}
                  disabled={salvando}
                  className={`${styles.btnSecundario} disabled:opacity-40`}
                >{traduzir('cancelar', "Cancelar")}</button>
                <button
                  type="submit"
                  disabled={salvando || !form.nome.trim()}
                  className={`${styles.btnPrimario} disabled:opacity-40`}
                >
                  {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="clientes-toast fixed bottom-5 right-5 z-[70] rounded-[14px] border border-[rgba(var(--nx-green-rgb),0.30)] bg-[var(--nexus-panel)] px-4 py-3 text-[12.5px] text-[var(--nexus-text)] shadow-[0_16px_40px_rgba(0,0,0,0.16)]"
        >
          {toast}
        </div>
      )}
      <style jsx global>{`
        .clientes-modal {
          animation: clientesModalIn 0.18s ease-out both;
        }
        @keyframes clientesModalIn {
          from { transform: translateY(10px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .clientes-backdrop {
          animation: clientesFadeIn 0.16s ease-out both;
        }
        @keyframes clientesFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .clientes-toast {
          animation: clientesToastIn 0.22s ease-out both;
        }
        @keyframes clientesToastIn {
          from { transform: translateY(-14px) scale(0.97); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .clientes-modal,
          .clientes-backdrop,
          .clientes-toast {
            animation: none;
          }
        }
      `}</style>
    </main>
  );
}


