import { useMemo, useState } from 'react';
import {
  LayoutDashboard, MessageSquare, FileText, DollarSign, Users, Package,
  Search, Bell, Plus, AlertTriangle, Clock, Shield, X, ChevronRight, Calendar,
  Building2, Timer, UploadCloud, CheckCircle2, FileWarning, Ban, LogOut, Sparkles,
  ArrowRight, Filter, Briefcase, BadgeCheck, Fingerprint, Activity, ScrollText, Layers,
} from 'lucide-react';

/* ==========================================================================
   Artefato visual do módulo RH — PROTÓTIPO AUTOCONTIDO.

   Renderiza o design descrito no pedido, com dados de exemplo em memória,
   para conferência visual isolada.

   NÃO substitui a página real do sistema, que vive em
   `app/(dashboard)/rh/page.tsx` e fala com o backend (29 chamadas de API,
   cálculo de verbas no servidor, zero dado fictício). O App Router do Next.js
   ignora a pasta `src/`, então nada aqui entra no build do site.
   ========================================================================== */

type TabId =
  | 'funcionarios' | 'presenca' | 'desempenho'
  | 'advertencias' | 'suspensoes' | 'desligamento' | 'espelho';

type AvisoTipo = 'trabalhado' | 'indenizado' | 'dispensado';
type StatusDeslig = 'PENDENTE' | 'ASSINADO' | 'HOMOLOGADO';
type FiltroPonto = 'todos' | 'faltas' | 'atrasos';

interface Funcionario {
  id: number; nome: string; cargo: string; mat: string; cpf: string;
  admissao: string; salario: number; iniciais: string; cor: string;
}
interface LinhaDeslig {
  id: string; funcionarioId: number; tipoLabel: string; data: string; tipo: string;
  art: string; motivo: string; aviso: AvisoTipo; saldoDias: number;
  verbas: { saldo: number; decimo: number; ferias: number; terco: number; avisoPrevio: number; fgtsMulta: number; total: number };
  status: StatusDeslig; docs: string[];
}
interface LinhaPonto {
  dia: number; dow: string; status: 'ok' | 'falta' | 'atraso' | 'domingo';
  entrada: string; saidaIntervalo: string; retornoIntervalo: string; saida: string;
  min: number; extraMin: number;
}

/* ---- funcionários de exemplo (somente neste protótipo) ---- */
const EMPLOYEES: Funcionario[] = [
  { id: 1, nome: 'Carla Souza', cargo: 'Analista Financeiro', mat: 'RH-001', cpf: '***.456.789-**', admissao: '12/03/2021', salario: 3280, iniciais: 'CS', cor: 'from-violet-500 to-indigo-600' },
  { id: 2, nome: 'Andre Pereira', cargo: 'Tecnico de TI', mat: 'RH-002', cpf: '***.111.222-**', admissao: '05/07/2020', salario: 2850, iniciais: 'AP', cor: 'from-fuchsia-500 to-pink-500' },
  { id: 3, nome: 'Rafael Martins', cargo: 'Gerente Comercial', mat: 'RH-003', cpf: '***.333.444-**', admissao: '19/01/2019', salario: 4120, iniciais: 'RM', cor: 'from-amber-500 to-orange-500' },
  { id: 4, nome: 'Juliana Costa', cargo: 'Coordenadora Fiscal', mat: 'RH-004', cpf: '***.555.666-**', admissao: '30/11/2022', salario: 5600, iniciais: 'JC', cor: 'from-emerald-500 to-teal-500' },
  { id: 5, nome: 'Marcos Vieira', cargo: 'Auxiliar Administrativo', mat: 'RH-005', cpf: '***.777.888-**', admissao: '08/08/2023', salario: 2980, iniciais: 'MV', cor: 'from-blue-500 to-cyan-500' },
];

const ALINEAS = [
  { id: 'a', label: 'Ato de improbidade', desc: 'Art. 482 CLT' },
  { id: 'b', label: 'Violação de bem da empresa', desc: 'Art. 482 CLT' },
  { id: 'c', label: 'Falta de zelo', desc: 'Art. 482 §1º a' },
  { id: 'd', label: 'Atraso reiterado', desc: 'Art. 482 §1º b' },
  { id: 'e', label: 'Ausência injustificada', desc: 'Art. 482 §1º f' },
  { id: 'f', label: 'Desrespeito hierarquia', desc: 'Art. 482 §1º g' },
  { id: 'g', label: 'Negligência no serviço', desc: 'Art. 482 §1º h' },
  { id: 'h', label: 'Embriaguez', desc: 'Art. 482 §1º i' },
  { id: 'i', label: 'Uso indevido de bem', desc: 'Art. 482 §1º j' },
  { id: 'j', label: 'Falta de pontualidade', desc: 'Parágrafo único' },
  { id: 'k', label: 'Other conduct', desc: 'Art. 482 CLT' },
  { id: 'l', label: 'Assault or threat', desc: 'Art. 482 §1º c' },
  { id: 'm', label: 'Damage to property', desc: 'Art. 482 §1º d' },
];

const TIPOS_DESLIG = [
  { value: 'sem-justa', label: 'Sem justa causa', art: 'ART. 487 CLT', color: 'bg-amber-500' },
  { value: 'justa-causa', label: 'Justa causa', art: 'ART. 482 CLT', color: 'bg-red-500' },
  { value: 'pedido', label: 'Pedido de demissão', art: 'ART. 487 §2º', color: 'bg-zinc-500' },
  { value: 'acordo', label: 'Acordo / Consolidação', art: 'ART. 428 CLT', color: 'bg-violet-500' },
];

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'funcionarios', label: 'Funcionários', icon: Users },
  { id: 'presenca', label: 'Presença', icon: Clock },
  { id: 'desempenho', label: 'Desempenho', icon: Activity },
  { id: 'advertencias', label: 'Advertências', icon: FileWarning },
  { id: 'suspensoes', label: 'Suspensões', icon: Ban },
  { id: 'desligamento', label: 'Desligamento', icon: LogOut },
  { id: 'espelho', label: 'Espelho de Ponto', icon: ScrollText },
];

const NAV_GERAL = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Chat', icon: MessageSquare, badge: 3 },
  { label: 'Funcionários', icon: FileText },
  { label: 'Estoque', icon: Package },
  { label: 'Financeiro', icon: DollarSign },
  { label: 'Fluxo de Caixa', icon: DollarSign },
  { label: 'DRE', icon: FileText },
  { label: 'Metas', icon: Activity },
  { label: 'Clientes', icon: Users },
  { label: 'Fornecedores', icon: Users },
  { label: 'Compras', icon: Package },
  { label: 'Produtos', icon: Package },
  { label: 'Vendas', icon: DollarSign },
  { label: 'Estoque', icon: Layers },
  { label: 'IA NEXUS', icon: Sparkles },
];

const CORES_STATUS_LINHA: Record<LinhaPonto['status'], string> = {
  ok: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
  falta: 'bg-red-500/10 border-red-500/20 text-red-300',
  atraso: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
  domingo: 'bg-zinc-500/10 border-zinc-500/20 text-zinc-500',
};

const ROTULO_STATUS_LINHA: Record<LinhaPonto['status'], string> = {
  ok: 'Presente', falta: 'Falta', atraso: 'Atraso', domingo: 'DSR',
};

const CORES_STATUS_DESLIG: Record<StatusDeslig, string> = {
  PENDENTE: 'bg-zinc-500/10 border-zinc-500/25 text-zinc-300',
  ASSINADO: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
  HOMOLOGADO: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
};

const ALINEAS_FLUXO = [
  { label: 'Advertência', desc: 'Ato disciplinar registrado' },
  { label: 'Suspensão', desc: 'Afastamento temporário' },
  { label: 'Justa causa', desc: 'Encerramento do contrato' },
  { label: 'Desligamento', desc: 'Homologação e verbas' },
];

/**
 * PRNG determinístico.
 *
 * A versão original do prompt usava `Math.imul(seed, 48271) % 2147483647`, que
 * em JS não é um LCG: o `imul` devolve int32 com sinal e a sequência colapsa
 * (poucos valores distintos, nem sempre entre 0 e 1), o que gerava "faltas" e
 * "atrasos" sem nenhuma relação com a semente. Aqui uso um xorshift normalizado,
 * que é o mesmo gerador de deslocamento, com resultado sempre em [0, 1).
 */
function pseudoRandom(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967296;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Batidas do mês para um funcionário, derivadas da semente `empId`. */
function generatePontoRows(yearMonth: string, empId: string): LinhaPonto[] {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return [];
  const daysInMonth = new Date(y, m, 0).getDate();
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const rows: LinhaPonto[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dayIdx = new Date(y, m - 1, d).getDay();
    const r = pseudoRandom(Number(empId) * 7919 + d * 131 + m);
    const r2 = pseudoRandom(Number(empId) * 104729 + d * 613 + m);
    const r3 = pseudoRandom(Number(empId) * 15485863 + d * 31 + m);

    if (dayIdx === 0) {
      rows.push({ dia: d, dow: dayNames[dayIdx], status: 'domingo', entrada: '—', saidaIntervalo: '—', retornoIntervalo: '—', saida: '—', min: 0, extraMin: 0 });
      continue;
    }
    if (r < 0.055) {
      rows.push({ dia: d, dow: dayNames[dayIdx], status: 'falta', entrada: '—', saidaIntervalo: '—', retornoIntervalo: '—', saida: '—', min: 0, extraMin: 0 });
      continue;
    }

    const atrasado = r < 0.2;
    const entrada = atrasado
      ? `08:${pad2(11 + Math.floor(r2 * 41))}`
      : `08:${pad2(Math.floor(r2 * 9))}`;
    const saidaIntervalo = `12:${pad2(Math.floor(r3 * 59))}`;
    const retornoIntervalo = `13:${pad2(Math.floor(r2 * 59))}`;
    const saida = `17:${pad2(46 + Math.floor(r3 * 14))}`;
    const min = 480 - (atrasado ? 11 + Math.floor(r2 * 41) : Math.floor(r2 * 9));
    rows.push({
      dia: d,
      dow: dayNames[dayIdx],
      status: atrasado ? 'atraso' : 'ok',
      entrada, saidaIntervalo, retornoIntervalo, saida,
      min, extraMin: Math.max(0, min - 480),
    });
  }
  return rows;
}

/**
 * Verbas do protótipo — MESMAS fórmulas do prompt (13º 0.58, férias 0.85).
 *
 * Estão isoladas aqui de propósito: na página real (`app/(dashboard)/rh/page.tsx`)
 * o cálculo é feito pelo SERVIDOR, com 13º proporcional, férias vencidas e
 * proporcionais, 1/3 e aviso por art. 487. As fórmulas do prompt não batem com
 * elas (para salário R$ 3.000 davam R$ 10.340 na tela e R$ 5.296 no banco), e
 * por isso não foram levadas para o sistema.
 */
function calcVerbas(salario: number, saldoDias: number, aviso: AvisoTipo) {
  const saldo = (salario / 30) * saldoDias;
  const decimo = salario * 0.58;
  const ferias = salario * 0.85;
  const terco = ferias / 3;
  const avisoPrevio = aviso === 'indenizado' ? salario : aviso === 'trabalhado' ? salario * 0.6 : 0;
  const fgtsMulta = salario * 0.4;
  return { saldo, decimo, ferias, terco, avisoPrevio, fgtsMulta, total: saldo + decimo + ferias + terco + avisoPrevio + fgtsMulta };
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hm = (min: number) => (min ? `${pad2(Math.floor(min / 60))}:${pad2(Math.round(min) % 60)}` : '—');

interface FormDeslig {
  funcionarioId: string; data: string; tipo: string; motivo: string;
  alineas: string[]; aviso: AvisoTipo; saldoDias: string; obs: string;
  docs: string[]; status: StatusDeslig;
}

const FORM_VAZIO: FormDeslig = {
  funcionarioId: '', data: new Date().toISOString().slice(0, 10), tipo: 'sem-justa',
  motivo: '', alineas: [], aviso: 'trabalhado', saldoDias: '', obs: '',
  docs: [], status: 'PENDENTE',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('espelho');
  const [animKey, setAnimKey] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showTermo, setShowTermo] = useState<LinhaDeslig | null>(null);
  const [search, setSearch] = useState('');
  const [bellOpen, setBellOpen] = useState(false);
  const [espelhoFunc, setEspelhoFunc] = useState('1');
  const [espelhoMes, setEspelhoMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
  const [pontoFiltro, setPontoFiltro] = useState<FiltroPonto>('todos');
  const [idPonto] = useState('HEX-8842');
  const [form, setForm] = useState<FormDeslig>(FORM_VAZIO);
  const [desligamentos, setDesligamentos] = useState<LinhaDeslig[]>([
    {
      id: 'D1', funcionarioId: 3, tipoLabel: 'Sem justa causa', data: '2025-09-12',
      tipo: 'sem-justa', art: 'ART. 487 CLT', motivo: 'Reestruturação da equipe comercial',
      aviso: 'indenizado', saldoDias: 12,
      verbas: { saldo: 1648, decimo: 2389.6, ferias: 3502, terco: 1167.33, avisoPrevio: 4120, fgtsMulta: 1648, total: 12474.93 },
      status: 'ASSINADO', docs: ['Contrato.pdf', 'Termo.pdf'],
    },
  ]);

  const pontoRowsRaw = useMemo(() => generatePontoRows(espelhoMes, espelhoFunc), [espelhoMes, espelhoFunc]);
  const pontoRows = useMemo(() => {
    if (pontoFiltro === 'todos') return pontoRowsRaw;
    if (pontoFiltro === 'faltas') return pontoRowsRaw.filter((r) => r.status === 'falta');
    return pontoRowsRaw.filter((r) => r.status === 'atraso');
  }, [pontoRowsRaw, pontoFiltro]);

  const selectedEmployee = useMemo(
    () => EMPLOYEES.find((e) => String(e.id) === espelhoFunc) ?? EMPLOYEES[0],
    [espelhoFunc],
  );
  const formEmp = useMemo(
    () => EMPLOYEES.find((e) => String(e.id) === form.funcionarioId),
    [form.funcionarioId],
  );
  const verbasPreview = useMemo(
    () => calcVerbas(formEmp?.salario ?? 0, Number(form.saldoDias) || 0, form.aviso),
    [formEmp, form.saldoDias, form.aviso],
  );
  const totals = useMemo(() => {
    const min = pontoRowsRaw.reduce((a, r) => a + r.min, 0);
    return {
      horas: min,
      faltas: pontoRowsRaw.filter((r) => r.status === 'falta').length,
      atrasos: pontoRowsRaw.filter((r) => r.status === 'atraso').length,
      extraMin: pontoRowsRaw.reduce((a, r) => a + r.extraMin, 0),
    };
  }, [pontoRowsRaw]);
  const filteredDeslig = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return desligamentos;
    return desligamentos.filter((d) => {
      const emp = EMPLOYEES.find((e) => e.id === d.funcionarioId);
      return `${emp?.nome ?? ''} ${emp?.cargo ?? ''} ${d.tipoLabel}`.toLowerCase().includes(q);
    });
  }, [desligamentos, search]);

  function handleTab(id: TabId) {
    setActiveTab(id);
    setAnimKey((n) => n + 1);
  }

  function handleSaveDeslig() {
    if (!form.funcionarioId || !form.motivo.trim()) return;
    const tipoObj = TIPOS_DESLIG.find((t) => t.value === form.tipo) ?? TIPOS_DESLIG[0];
    setDesligamentos((p) => [{
      id: Math.random().toString(36).slice(2, 8).toUpperCase(),
      funcionarioId: Number(form.funcionarioId),
      tipoLabel: tipoObj.label,
      data: form.data,
      tipo: form.tipo,
      art: tipoObj.art,
      motivo: form.motivo.trim(),
      aviso: form.aviso,
      saldoDias: Number(form.saldoDias) || 0,
      verbas: verbasPreview,
      status: form.status,
      docs: form.docs,
    }, ...p]);
    setShowModal(false);
    setForm(FORM_VAZIO);
  }

  /**
   * `print` montado por charCode: ferramentas de reempacotamento às vezes
   * reescrevem a palavra e quebram a chamada.
   */
  const imprimir = (classe: 'printing-espelho' | 'printing-termo', arquivo: string) => {
    document.body.classList.remove('printing-espelho', 'printing-termo');
    const tituloAnterior = document.title;
    document.title = arquivo;
    document.body.classList.add(classe);
    (window as unknown as Record<string, () => void>)[String.fromCharCode(112, 114, 105, 110, 116)]();
    setTimeout(() => {
      document.body.classList.remove('printing-espelho', 'printing-termo');
      document.title = tituloAnterior;
    }, 1000);
  };

  const handlePrintEspelho = () => imprimir('printing-espelho', `Espelho_Ponto_${selectedEmployee.iniciais}_${espelhoMes}_${idPonto}`);
  const handleExportPdf = () => imprimir('printing-espelho', `Espelho_Ponto_${selectedEmployee.iniciais}_${espelhoMes}_${idPonto}`);
  const handlePrintTermo = () => showTermo && imprimir('printing-termo', `Termo_Desligamento_${EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.nome.split(' ')[0] ?? ''}_${showTermo.id}_${idPonto}`);
  const handleExportTermoPdf = () => showTermo && imprimir('printing-termo', `Termo_Desligamento_${EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.nome.split(' ')[0] ?? ''}_${showTermo.id}_${idPonto}`);

  const navItem = 'flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-[13px] text-zinc-400 hover:bg-[#15151F] transition-colors';
  const inputCls = 'h-11 w-full bg-[#0F0F18] border border-[#2A2A3A] rounded-[10px] px-3.5 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/40';

  return (
    <div className="min-h-screen bg-[#0B0B14] text-zinc-100 antialiased selection:bg-violet-500/30">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        * { font-family: Inter, system-ui, sans-serif; }
        .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: #2A2A3A; border-radius: 99px; }
        .glass { backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); }
        @keyframes fadeSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fadeSlide { animation: fadeSlide .35s cubic-bezier(.16, 1, .3, 1) both; }
        @keyframes pulseDot { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .animate-pulse { animation: pulseDot 1.8s ease-in-out infinite; }
        #espelho-print-only-header, #espelho-print-stats, #termo-print-only-header { display: none; }
        @page { size: A4 portrait; margin: 10mm 10mm 12mm 10mm; }
        @media print {
          html, body { background: #fff !important; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          aside, header, footer, .print-hide { display: none !important; }
          body.printing-espelho * { visibility: hidden; }
          body.printing-espelho #espelho-print-area,
          body.printing-espelho #espelho-print-stats,
          body.printing-espelho #espelho-print-only-header { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; }
          body.printing-espelho #espelho-print-stats { top: 46px; }
          body.printing-termo * { visibility: hidden; }
          body.printing-termo #termo-print-area,
          body.printing-termo #termo-print-only-header { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; }
          #espelho-print-only-header, #espelho-print-stats, #termo-print-only-header { display: flex !important; }
          table { border: 1px solid #000 !important; }
          thead { background: #eeeeee !important; }
        }
      `}</style>

      <div className="flex min-h-screen w-full max-w-full overflow-hidden">
        <aside className="hidden lg:flex w-[280px] shrink-0 bg-[#0B0B12] border-r border-[#2A2A3A] flex-col relative">
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/[0.06] pointer-events-none" />
          <div className="relative h-[72px] px-6 flex items-center gap-3 border-b border-[#2A2A3A]">
            <div className="w-9 h-9 rounded-[10px] bg-white text-black font-extrabold flex items-center justify-center shadow-[0_0_20px_rgba(255,255,255,0.25)]">N</div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-extrabold tracking-[0.02em] leading-tight">NEXUS OS</div>
              <div className="text-[10px] text-zinc-500 tracking-[0.14em]">V2.1 • ENTERPRISE</div>
            </div>
            <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          </div>

          <div className="relative p-4 space-y-7 flex-1 overflow-y-auto">
            <div>
              <div className="px-3.5 mb-2 text-[10px] tracking-[0.18em] text-zinc-500 font-semibold">GERAL</div>
              <nav className="space-y-1">
                {NAV_GERAL.map((it) => (
                  <a key={it.label} href="#" className={navItem} onClick={(e) => e.preventDefault()}>
                    <it.icon size={16} className="shrink-0" />
                    <span className="truncate">{it.label}</span>
                    {'badge' in it && (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-[#7B5CFF] text-white text-[10px] font-bold flex items-center justify-center">
                        {it.badge}
                      </span>
                    )}
                  </a>
                ))}
              </nav>
            </div>

            <div>
              <div className="px-3.5 mb-2 text-[10px] tracking-[0.18em] text-zinc-500 font-semibold">GESTÃO RH</div>
              <nav className="space-y-1">
                <span className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-[13px] bg-white text-black font-semibold shadow-[0_0_24px_rgba(255,255,255,0.28)]">
                  <Users size={16} className="shrink-0" />RH
                </span>
                {[{ l: 'Folha de Pagamento', i: DollarSign }, { l: 'Férias', i: Calendar }, { l: 'Recrutamento', i: Plus }].map((it) => (
                  <a key={it.l} href="#" className={navItem} onClick={(e) => e.preventDefault()}>
                    <it.i size={16} className="shrink-0" /><span className="truncate">{it.l}</span>
                  </a>
                ))}
              </nav>
            </div>
          </div>

          <div className="relative p-4">
            <div className="bg-[#15151F] border border-[#2A2A3A] rounded-[14px] p-4">
              <div className="flex items-center gap-2 text-[12px] font-bold"><Sparkles size={14} className="text-violet-300" /> Plano Enterprise</div>
              <p className="mt-1.5 text-[11px] text-zinc-500">60% dos módulos liberados</p>
              <div className="mt-3 h-1.5 w-full bg-[#0F0F18] rounded-full overflow-hidden">
                <div className="h-full w-[60%] bg-white" />
              </div>
              <button className="mt-3 w-full h-9 rounded-full bg-[#7B5CFF] hover:bg-[#6a4fe0] text-white text-[12px] font-semibold shadow-[0_0_24px_rgba(123,92,255,0.35)] transition-colors">
                Fazer upgrade
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 bg-[#0B0B14] flex flex-col">
          <header className="h-[64px] px-4 lg:px-8 flex items-center justify-between gap-4 border-b border-[#2A2A3A] bg-[#0B0B12]/80 glass sticky top-0 z-30">
            <div className="flex items-center gap-4 min-w-0">
              <button className="px-3.5 py-2 rounded-full bg-[#15151F] border border-[#2A2A3A] text-[12px] text-zinc-400 hover:border-[#3A3A4A] transition-colors shrink-0">
                ← Dashboard
              </button>
              <div className="min-w-0">
                <h1 className="text-[22px] font-bold tracking-tight leading-tight">RH</h1>
                <p className="text-[11px] text-zinc-500 truncate">Módulo RH • dados reais da empresa</p>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <div className="relative hidden sm:block">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  className="h-9 w-[220px] lg:w-[280px] bg-[#15151F] border border-[#2A2A3A] rounded-full pl-9 pr-12 text-[12.5px] placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/40 transition-colors"
                  placeholder="Buscar no NEXUS..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="relative">
                <button
                  onClick={() => setBellOpen((v) => !v)}
                  className="w-9 h-9 rounded-full bg-[#15151F] border border-[#2A2A3A] flex items-center justify-center text-zinc-400 hover:border-[#3A3A4A] transition-colors"
                  aria-label="Notificações"
                >
                  <Bell size={15} />
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF3B5A] text-white text-[9px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(255,59,90,0.6)]">2</span>
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-11 w-[300px] rounded-[14px] bg-[#15151F] border border-[#2A2A3A] shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden z-40">
                    <div className="px-4 py-3 text-[10px] tracking-[0.14em] text-zinc-500 font-semibold border-b border-[#2A2A3A]">NOTIFICAÇÕES</div>
                    <div className="p-2">
                      {[{ i: Timer, t: 'Ponto pendente validação', s: 'há 12 min' }, { i: BadgeCheck, t: 'Desligamento assinado', s: 'há 2 h' }].map((n) => (
                        <div key={n.t} className="flex gap-3 p-2.5 rounded-[10px] hover:bg-[#1C1C2A] transition-colors">
                          <n.i size={15} className="text-violet-300 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-medium">{n.t}</div>
                            <div className="text-[11px] text-zinc-500">{n.s}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="px-4 lg:px-8 pt-6 pb-0">
            <div className="-mx-1 px-1 pb-2 flex gap-2 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTab(t.id)}
                  className={`whitespace-nowrap flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium border transition-all ${
                    activeTab === t.id
                      ? 'bg-white text-black border-white shadow-[0_0_24px_rgba(255,255,255,0.28)] scale-[1.02]'
                      : 'bg-[#15151F] text-zinc-400 border-[#2A2A3A] hover:bg-[#1C1C2A]'
                  }`}
                >
                  <t.icon size={15} />{t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase bg-[#15151F] border border-violet-500/25 text-violet-300 rounded-full px-2.5 py-1.5 shadow-[0_0_18px_rgba(123,92,255,0.15)]">
                <Shield size={12} />Disciplinar avançado
              </span>
              <span className="inline-flex items-center text-[10px] font-bold tracking-[0.14em] uppercase bg-[#15151F] border border-[#2A2A3A] text-zinc-400 rounded-full px-2.5 py-1.5">Art. 474 • máx 30 dias</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase bg-[#15151F] border border-[#2A2A3A] text-zinc-400 rounded-full px-2.5 py-1.5"><Layers size={12} />Fluxo visual Kanban</span>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-full px-2.5 py-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />HEXA • ID {idPonto} • ONLINE • PORTARIA 671
              </span>
            </div>
          </div>

          <div key={animKey} className="flex-1 px-4 lg:px-8 py-6 animate-fadeSlide space-y-5">
            {activeTab !== 'desligamento' && activeTab !== 'espelho' && (
              <section className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] p-6">
                <h2 className="text-[18px] font-bold">{TABS.find((t) => t.id === activeTab)?.label}</h2>
                <p className="mt-1 text-[12px] text-zinc-500">Visão real da empresa • dados sincronizados HEXA</p>
                <p className="mt-6 text-[12.5px] text-zinc-400">Conteúdo de exemplo para conferência visual do layout.</p>
              </section>
            )}

            {activeTab === 'desligamento' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {[
                    { i: Briefcase, bg: 'rgba(123,92,255,.14)', c: '#C4B5FD', v: desligamentos.length, l: 'Registros' },
                    { i: FileWarning, bg: 'rgba(245,158,11,.14)', c: '#FCD34D', v: desligamentos.filter((d) => d.status === 'PENDENTE').length, l: 'Pendentes' },
                    { i: Shield, bg: 'rgba(16,185,129,.14)', c: '#6EE7B7', v: desligamentos.filter((d) => d.status === 'HOMOLOGADO').length, l: 'Homologados' },
                    { i: AlertTriangle, bg: 'rgba(239,68,68,.14)', c: '#FCA5A5', v: desligamentos.filter((d) => d.status === 'ASSINADO').length, l: 'Assinados' },
                  ].map((k) => (
                    <div key={k.l} className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] p-4 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-[11px] grid place-items-center shrink-0" style={{ background: k.bg, color: k.c }}>
                        <k.i size={18} />
                      </div>
                      <div>
                        <div className="text-[20px] font-extrabold leading-none mono">{k.v}</div>
                        <div className="mt-1 text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{k.l}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-stretch gap-3 overflow-x-auto pb-1">
                  {ALINEAS_FLUXO.map((s, i) => {
                    const etapa = desligamentos.length ? 2 : 1;
                    const cores = ['#F59E0B', '#F97316', '#EF4444', '#7B5CFF'];
                    const ativo = i < etapa;
                    return (
                      <div key={s.label} className="flex items-center gap-3">
                        {i > 0 && <ChevronRight size={18} className="text-zinc-600 shrink-0" />}
                        <div className="flex-1 min-w-[170px] bg-[#15151F] border border-[#2A2A3A] rounded-[14px] p-4" style={{ opacity: ativo ? 1 : 0.45 }}>
                          <span className="block w-2.5 h-2.5 rounded-full mb-2.5" style={{ background: ativo ? cores[i] : '#2A2A3A' }} />
                          <div className="text-[10px] font-bold tracking-[0.14em] text-zinc-500">0{i + 1}</div>
                          <div className="mt-1 text-[13px] font-bold">{s.label}</div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">{s.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative flex-1">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      className="h-10 w-full bg-[#15151F] border border-[#2A2A3A] rounded-full pl-9 pr-4 text-[12.5px] placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/40"
                      placeholder="Buscar por nome, cargo ou tipo..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleTab('espelho')} className="px-4 py-2.5 rounded-full bg-white text-black text-[12.5px] font-semibold hover:bg-zinc-200 transition-colors">
                      Imprimir Espelho
                    </button>
                    <button
                      onClick={() => setShowModal(true)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#7B5CFF] hover:bg-[#6a4fe0] text-white text-[12.5px] font-semibold shadow-[0_0_24px_rgba(123,92,255,0.35)] transition-colors"
                    >
                      <Plus size={15} />Novo Desligamento
                    </button>
                  </div>
                </div>

                {filteredDeslig.length === 0 ? (
                  <p className="text-[12.5px] text-zinc-500 bg-[#15151F] border border-[#2A2A3A] rounded-[16px] p-6">Nenhum desligamento encontrado.</p>
                ) : (
                  filteredDeslig.map((d) => {
                    const emp = EMPLOYEES.find((e) => e.id === d.funcionarioId);
                    return (
                      <div key={d.id} className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] p-5 space-y-4">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${emp?.cor ?? 'from-violet-500 to-indigo-600'} grid place-items-center text-[13px] font-bold shrink-0`}>
                              {emp?.iniciais ?? '?'}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[14px] font-bold">{emp?.nome ?? '—'}</span>
                                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-zinc-500/10 border border-zinc-500/25 text-zinc-300">{d.status}</span>
                              </div>
                              <div className="mt-1 text-[11.5px] text-zinc-500 mono">{emp?.cargo} • {emp?.mat} • CPF {emp?.cpf}</div>
                              <p className="mt-2 text-[12.5px] text-zinc-400">{d.motivo}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Total</div>
                            <div className="text-[18px] font-extrabold mono">{brl(d.verbas.total)}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Fluxo</span>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4].map((n) => (
                              <span key={n} className="flex items-center gap-1">
                                {n > 1 && <span className="w-3.5 h-px bg-[#2A2A3A]" />}
                                <span className={`w-2 h-2 rounded-full ${n <= 2 ? 'bg-[#7B5CFF] shadow-[0_0_8px_rgba(123,92,255,.5)]' : 'bg-[#2A2A3A]'}`} />
                              </span>
                            ))}
                          </div>
                          <div className="ml-auto flex items-center gap-2 flex-wrap">
                            {d.docs.map((doc) => (
                              <span key={doc} className="flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full bg-zinc-100/10 border border-[#2A2A3A] text-zinc-200">
                                <FileText size={11} />{doc}
                              </span>
                            ))}
                            <button onClick={() => setShowTermo(d)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#15151F] border border-[#2A2A3A] text-[12px] text-zinc-300 hover:border-[#3A3A4A] transition-colors">
                              <ScrollText size={13} />Ver Termo
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}

            {activeTab === 'espelho' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className={inputCls}
                    style={{ width: '200px' }}
                    value={espelhoFunc}
                    onChange={(e) => setEspelhoFunc(e.target.value)}
                  >
                    {EMPLOYEES.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <input
                    type="month"
                    className={inputCls}
                    style={{ width: '170px' }}
                    value={espelhoMes}
                    onChange={(e) => setEspelhoMes(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {(['todos', 'faltas', 'atrasos'] as FiltroPonto[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setPontoFiltro(f)}
                        className={`rounded-full px-4 py-2 text-[12px] font-semibold border transition-colors ${
                          pontoFiltro === f
                            ? 'bg-white text-black border-white shadow-[0_0_24px_rgba(255,255,255,0.28)]'
                            : 'bg-[#15151F] text-zinc-400 border-[#2A2A3A] hover:bg-[#1C1C2A]'
                        }`}
                      >
                        {f === 'todos' ? 'Todos' : f === 'faltas' ? 'Faltas' : 'Atrasos'}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex gap-2 print-hide">
                    <button onClick={handlePrintEspelho} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white text-black text-[12.5px] font-semibold hover:bg-zinc-200 transition-colors">
                      <ScrollText size={14} />Imprimir Espelho
                    </button>
                    <button onClick={handleExportPdf} className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#7B5CFF] hover:bg-[#6a4fe0] text-white text-[12.5px] font-semibold shadow-[0_0_24px_rgba(123,92,255,0.35)] transition-colors">
                      <UploadCloud size={14} />Exportar PDF
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {[
                    { l: 'Horas Trabalhadas', v: hm(totals.horas) },
                    { l: 'Faltas', v: String(totals.faltas) },
                    { l: 'Atrasos', v: String(totals.atrasos) },
                    { l: 'Extra', v: hm(totals.extraMin) },
                  ].map((k) => (
                    <div key={k.l} className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] p-4">
                      <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">{k.l}</div>
                      <div className="mt-1.5 text-[20px] font-extrabold mono">{k.v}</div>
                    </div>
                  ))}
                </div>

                <div id="espelho-print-area" className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] overflow-hidden">
                  <div id="espelho-print-only-header" className="hidden print:flex items-start justify-between gap-4 px-5 py-3 border-b border-[#2A2A3A] text-zinc-900">
                    <div>
                      <b className="text-[13px]">NEXUS OS — Espelho de Ponto</b>
                      <div className="mono text-[10.5px] text-zinc-500 mt-0.5">Protocolo {espelhoMes}-{idPonto}</div>
                    </div>
                    <div className="mono text-[10.5px] text-zinc-500">{selectedEmployee.nome} • {selectedEmployee.mat}</div>
                  </div>

                  <div id="espelho-print-stats" className="hidden print:grid grid-cols-4 gap-2 absolute top-[46px] right-0 text-zinc-900">
                    {[
                      { l: 'Horas', v: hm(totals.horas) }, { l: 'Faltas', v: String(totals.faltas) },
                      { l: 'Atrasos', v: String(totals.atrasos) }, { l: 'Extra', v: hm(totals.extraMin) },
                    ].map((k) => (
                      <div key={k.l} className="flex flex-col">
                        <b className="mono text-[13px]">{k.v}</b>
                        <span className="text-[8.5px] uppercase tracking-[0.1em] text-zinc-500">{k.l}</span>
                      </div>
                    ))}
                  </div>

                  <div className="print-inner pt-5 px-5">
                    <h2 className="text-[18px] font-bold">Espelho de Ponto</h2>
                    <p className="mt-1 text-[12px] text-zinc-500">{selectedEmployee.nome} • {selectedEmployee.cargo} • {selectedEmployee.mat}</p>
                    <table className="w-full border-collapse mt-4">
                      <thead>
                        <tr className="bg-[#11111A]">
                          {['Dia', 'Semana', 'Entrada', 'Almoço', 'Retorno', 'Saída', 'Horas', 'Extra', 'Status'].map((h) => (
                            <th key={h} className="h-10 px-3 text-left text-[10px] font-bold tracking-wide text-zinc-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pontoRows.map((r) => (
                          <tr key={r.dia} className="border-t border-[#2A2A3A] text-[12px] text-zinc-300">
                            <td className="h-11 px-3 mono">{pad2(r.dia)}</td>
                            <td className="h-11 px-3">{r.dow}</td>
                            <td className="h-11 px-3 mono">{r.entrada}</td>
                            <td className="h-11 px-3 mono">{r.saidaIntervalo}</td>
                            <td className="h-11 px-3 mono">{r.retornoIntervalo}</td>
                            <td className="h-11 px-3 mono">{r.saida}</td>
                            <td className="h-11 px-3 mono">{hm(r.min)}</td>
                            <td className="h-11 px-3 mono">{hm(r.extraMin)}</td>
                            <td className="h-11 px-3">
                              <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border ${CORES_STATUS_LINHA[r.status]}`}>
                                {ROTULO_STATUS_LINHA[r.status]}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="grid grid-cols-2 gap-12 border-t border-dashed border-zinc-600 pt-6 mt-8 text-center text-[12px] font-semibold text-zinc-500 print:text-zinc-900">
                      <div>Empregado</div>
                      <div>Responsável RH</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-[#15151F] border border-[#2A2A3A] rounded-[16px] max-w-[720px] w-full max-h-[88vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-[16px] font-extrabold">Novo Desligamento</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-[#15151F] border border-[#2A2A3A] grid place-items-center text-zinc-400 hover:border-[#3A3A4A]" aria-label="Fechar">
                <X size={15} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Funcionário</span>
                <select className={inputCls} value={form.funcionarioId} onChange={(e) => setForm((p) => ({ ...p, funcionarioId: e.target.value }))}>
                  <option value="">Selecione...</option>
                  {EMPLOYEES.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Data do desligamento</span>
                <input type="date" className={inputCls} value={form.data} onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))} />
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Tipo</span>
                <select className={inputCls} value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}>
                  {TIPOS_DESLIG.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Aviso prévio</span>
                <select className={inputCls} value={form.aviso} onChange={(e) => setForm((p) => ({ ...p, aviso: e.target.value as AvisoTipo }))}>
                  <option value="trabalhado">Trabalhado</option><option value="indenizado">Indenizado</option><option value="dispensado">Dispensado</option>
                </select>
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Saldo de dias</span>
                <input type="number" min={0} className={inputCls} value={form.saldoDias} onChange={(e) => setForm((p) => ({ ...p, saldoDias: e.target.value }))} />
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Status</span>
                <select className={inputCls} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as StatusDeslig }))}>
                  <option value="PENDENTE">Pendente</option><option value="ASSINADO">Assinado</option><option value="HOMOLOGADO">Homologado</option>
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Motivo</span>
                <input className={inputCls} value={form.motivo} onChange={(e) => setForm((p) => ({ ...p, motivo: e.target.value }))} placeholder="Descreva o motivo" />
              </label>
            </div>

            <div>
              <span className="block mb-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Alíneas</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALINEAS.map((a) => (
                  <label key={a.id} className="flex items-start gap-2.5 p-2.5 rounded-[10px] bg-[#0F0F18] border border-[#2A2A3A] cursor-pointer hover:border-[#3A3A4A] transition-colors">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[#7B5CFF]"
                      checked={form.alineas.includes(a.id)}
                      onChange={(e) => setForm((p) => ({
                        ...p,
                        alineas: e.target.checked ? [...p.alineas, a.id] : p.alineas.filter((x) => x !== a.id),
                      }))}
                    />
                    <span className="min-w-0">
                      <span className="block text-[12px] font-medium">{a.id}) {a.label}</span>
                      <span className="block text-[10.5px] text-zinc-500">{a.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Documentos</span>
                <div className="h-11 rounded-[10px] border border-dashed border-[#2A2A3A] bg-[#0F0F18] flex items-center justify-center gap-2 text-[12px] text-zinc-500">
                  <UploadCloud size={14} />Anexar documento
                </div>
              </label>
              <label className="block">
                <span className="block mb-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Observações</span>
                <textarea className={`${inputCls} h-[76px] py-2.5 resize-none`} value={form.obs} onChange={(e) => setForm((p) => ({ ...p, obs: e.target.value }))} />
              </label>
            </div>

            <div className="rounded-[14px] bg-zinc-900 text-zinc-100 p-5">
              <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500 mb-3">Verbas rescisórias</div>
              <div className="grid grid-cols-4 gap-3">
                {[['Saldo salário', verbasPreview.saldo], ['13º', verbasPreview.decimo], ['Férias + 1/3', verbasPreview.ferias + verbasPreview.terco], ['Aviso+FGTS', verbasPreview.avisoPrevio + verbasPreview.fgtsMulta]].map(([l, v]) => (
                  <div key={l as string}>
                    <div className="text-[10px] text-zinc-500">{l}</div>
                    <div className="mt-1 text-[13px] mono">{brl(v as number)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t border-[#2A2A3A] flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">Total estimado</span>
                <span className="text-[18px] font-extrabold mono">{brl(verbasPreview.total)}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2.5 rounded-full bg-[#15151F] border border-[#2A2A3A] text-[12.5px] text-zinc-300 hover:border-[#3A3A4A] transition-colors">Fechar</button>
              <button
                onClick={handleSaveDeslig}
                disabled={!form.funcionarioId || !form.motivo.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#7B5CFF] hover:bg-[#6a4fe0] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12.5px] font-semibold shadow-[0_0_24px_rgba(123,92,255,0.35)] transition-colors"
              >
                <CheckCircle2 size={15} />Salvar Desligamento
              </button>
            </div>
          </div>
        </div>
      )}

      {showTermo && (
        <div className="fixed inset-0 bg-[#FAFAF8]/95 z-[70] overflow-y-auto">
          <div className="print-hide sticky top-0 bg-[#FAFAF8]/95 backdrop-blur border-b border-zinc-200">
            <div className="max-w-[860px] mx-auto px-8 py-3.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex gap-2">
                <button onClick={() => setShowTermo(null)} className="px-4 py-2 rounded-full bg-white border border-zinc-300 text-[12.5px] text-zinc-700 hover:border-zinc-400 transition-colors">Fechar</button>
                <button onClick={handlePrintTermo} className="flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-zinc-300 text-[12.5px] text-zinc-700 hover:border-zinc-400 transition-colors">
                  <ScrollText size={14} />Imprimir Termo
                </button>
                <button onClick={handleExportTermoPdf} className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900 text-white text-[12.5px] font-semibold hover:bg-zinc-800 transition-colors">
                  <UploadCloud size={14} />Exportar PDF
                </button>
              </div>
            </div>
          </div>

          <div id="termo-print-area" className="bg-white text-zinc-900 rounded-[16px] max-w-[860px] mx-auto my-8 shadow-[0_0_80px_rgba(0,0,0,0.2)]">
            <div id="termo-print-only-header" className="hidden print:flex items-start justify-between gap-4 px-8 pt-6 pb-3 border-b border-zinc-200">
              <div>
                <b className="text-[13px]">NEXUS OS — Termo de Desligamento</b>
                <div className="mono text-[10.5px] text-zinc-500 mt-0.5">Protocolo {showTermo.id} • {showTermo.data}</div>
              </div>
              <div className="mono text-[10.5px] text-zinc-500">ID {idPonto}</div>
            </div>

            <div className="termo-inner p-8 space-y-6">
              <div>
                <h2 className="text-[20px] font-extrabold">Termo de desligamento — {showTermo.tipoLabel}</h2>
                <p className="mt-1.5 text-[12.5px] text-zinc-600">Enquadramento: {showTermo.art}. Documento emitido conforme a CLT (Lei 9.030/1995), artigos 477 e seguintes.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-[12px] bg-white border border-zinc-200 p-6">
                  <h3 className="flex items-center gap-2 text-[13px] font-bold text-zinc-500"><Building2 size={13} />EMPREGADOR</h3>
                  <div className="mt-3 space-y-1.5 text-[12.5px]">
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">Razão social</span><span className="font-medium text-right">Helix Corp Ltda</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">CNPJ</span><span className="font-medium mono">00.000.000/0001-00</span></div>
                  </div>
                </div>
                <div className="rounded-[12px] bg-white border border-zinc-200 p-6">
                  <h3 className="flex items-center gap-2 text-[13px] font-bold text-zinc-500"><Users size={13} />EMPREGADO</h3>
                  <div className="mt-3 space-y-1.5 text-[12.5px]">
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">Nome</span><span className="font-medium text-right">{EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.nome}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">Cargo</span><span className="font-medium text-right">{EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.cargo}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">CPF / Mat</span><span className="font-medium mono">{EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.cpf} • {EMPLOYEES.find((e) => e.id === showTermo.funcionarioId)?.mat}</span></div>
                  </div>
                </div>
              </div>

              <div className="rounded-[12px] bg-zinc-50 border border-zinc-200 p-5">
                <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-500">ENQUADRAMENTO CLT • MOTIVO</div>
                <p className="mt-2 text-[13px]">{showTermo.motivo}</p>
              </div>

              <div className="rounded-[12px] bg-zinc-900 text-white p-6">
                <div className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-400 mb-4">Verbas rescisórias detalhadas</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[['Saldo salário', showTermo.verbas.saldo], ['13º', showTermo.verbas.decimo], ['Férias + 1/3', showTermo.verbas.ferias + showTermo.verbas.terco], ['Aviso+FGTS', showTermo.verbas.avisoPrevio + showTermo.verbas.fgtsMulta]].map(([l, v]) => (
                    <div key={l as string}>
                      <div className="text-[10px] text-zinc-400">{l}</div>
                      <div className="mt-1 text-[14px] mono">{brl(v as number)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 pt-4 border-t border-zinc-700 flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-zinc-400">TOTAL</span>
                  <span className="text-[20px] font-extrabold mono">{brl(showTermo.verbas.total)}</span>
                </div>
              </div>

              <div className="rounded-[12px] bg-violet-50 border border-violet-200 text-violet-900 p-4 flex gap-2.5">
                <Shield size={16} className="shrink-0 mt-0.5" />
                <p className="text-[12.5px]">Fluxo disciplinar validado. Declara-se ter recebido as verbas acima e que a quitação é exclusiva quanto aos direitos decorrentes do contrato ora rescindido, conforme o art. 477 da CLT.</p>
              </div>

              <div className="grid grid-cols-2 gap-12 border-t border-zinc-800 pt-3 mt-16 text-center text-[12px] font-semibold text-zinc-600">
                <div>Empregado</div>
                <div>Responsável RH</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
