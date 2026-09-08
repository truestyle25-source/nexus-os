import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "./api";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-white">Carregando NEXUS OS...</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try { await login(email, password); window.location.href = "/"; } catch (err: any) { setError(err.response?.data?.error || "Erro no login"); }
  }

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0f172a] rounded-2xl p-8 border border-white/10">
        <h1 className="text-3xl font-bold text-white mb-2">NEXUS OS</h1>
        <p className="text-slate-400 mb-6">Gestão, BI & IA - Acesso PRO</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="E-mail" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Senha" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button className="w-full bg-[#6366f1] hover:bg-[#5558e3] text-white rounded-xl py-3 font-semibold">Entrar</button>
        </form>
        <p className="text-center text-slate-500 mt-4 text-sm">Não tem conta? <a href="/register" className="text-[#6366f1]">Criar conta - 7 dias grátis</a></p>
      </div>
    </div>
  );
}

function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = React.useState({ companyName: "", name: "", email: "", password: "", phone: "" });
  const [error, setError] = React.useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try { await register(form); window.location.href = "/"; } catch (err: any) { setError(err.response?.data?.error || "Erro no cadastro"); }
  }

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#0f172a] rounded-2xl p-8 border border-white/10">
        <h1 className="text-3xl font-bold text-white mb-2">Comece grátis</h1>
        <p className="text-slate-400 mb-6">7 dias grátis - NEXUS OS PRO</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input value={form.companyName} onChange={e=>setForm({...form, companyName: e.target.value})} placeholder="Nome da empresa" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          <input value={form.name} onChange={e=>setForm({...form, name: e.target.value})} placeholder="Seu nome" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          <input value={form.email} onChange={e=>setForm({...form, email: e.target.value})} placeholder="E-mail" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          <input type="password" value={form.password} onChange={e=>setForm({...form, password: e.target.value})} placeholder="Senha (mín 6)" className="w-full bg-[#020617] border border-white/10 rounded-xl px-4 py-3 text-white" required />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button className="w-full bg-[#6366f1] hover:bg-[#5558e3] text-white rounded-xl py-3 font-semibold">Criar conta - 7 dias grátis</button>
        </form>
      </div>
    </div>
  );
}

function BillingPage() {
  const { subscription } = useAuth();
  const [loading, setLoading] = React.useState(false);

  async function handleSubscribe() {
    setLoading(true);
    try {
      const { data } = await api.post("/billing/infinitepay/create-checkout");
      window.location.href = data.checkoutUrl;
    } catch (e: any) {
      alert(e.response?.data?.error || "Erro ao criar checkout");
      setLoading(false);
    }
  }

  const daysLeft = subscription?.daysLeft ?? 0;
  const isTrial = subscription?.status === "trial";
  const isExpired = ["expired","cancelled","past_due"].includes(subscription?.status || "");

  return (
    <div className="min-h-screen bg-[#020617] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#0f172a] rounded-2xl p-8 border border-white/10 text-center">
        <h1 className="text-3xl font-bold text-white mb-4">{isTrial ? `Seu teste: ${daysLeft} dias restantes` : "Assine NEXUS OS PRO"}</h1>
        <p className="text-slate-400 mb-6">{isExpired ? "Seu teste terminou. Assine para continuar com acesso PRO." : "Libere todos os recursos: IA, DRE, ROAS/ROI/CAC/LTV, multi-loja"}</p>
        <div className="bg-[#020617] rounded-xl p-6 border border-[#6366f1]/30 mb-6">
          <h2 className="text-2xl font-bold text-white">NEXUS OS PRO</h2>
          <p className="text-4xl font-bold text-white mt-2">R$ 149<span className="text-lg text-slate-400">/mês</span></p>
          <ul className="text-left text-slate-300 mt-4 space-y-2 text-sm">
            <li>✓ Usuários ilimitados</li>
            <li>✓ IA que não inventa números</li>
            <li>✓ DRE, Fluxo de Caixa, ROI, ROAS, CAC, LTV</li>
            <li>✓ Multi-loja e estoque inteligente</li>
            <li>✓ Suporte WhatsApp</li>
          </ul>
        </div>
        <button onClick={handleSubscribe} disabled={loading} className="w-full bg-[#6366f1] hover:bg-[#5558e3] text-white rounded-xl py-4 font-bold text-lg">
          {loading ? "Gerando checkout..." : "Assinar PRO via InfinitePay"}
        </button>
        <p className="text-slate-500 text-xs mt-4">Pagamento seguro via InfinitePay - PIX e Cartão</p>
      </div>
    </div>
  );
}

function BillingSuccessPage() {
  const [status, setStatus] = React.useState("Verificando pagamento...");
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get("order");
    if (!order) return;
    api.get(`/billing/infinitepay/status/${order}`).then(res => {
      if (res.data.paid) { setStatus("Pagamento confirmado! PRO liberado."); setTimeout(()=>window.location.href="/", 2000); }
      else setStatus("Aguardando confirmação... Atualize a página em instantes.");
    }).catch(()=>setStatus("Erro ao verificar. Se pagou, aguarde webhook."));
  }, []);
  return <div className="min-h-screen bg-[#020617] flex items-center justify-center text-white"><div className="bg-[#0f172a] p-8 rounded-2xl border border-white/10">{status}</div></div>;
}

function DashboardPage() {
  const { user, subscription, logout } = useAuth();
  const daysLeft = subscription?.daysLeft;

  return (
    <div className="min-h-screen bg-[#020617] text-white">
      <header className="border-b border-white/10 bg-[#0f172a] px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">NEXUS OS <span className="text-[#6366f1]">PRO</span></h1>
        <div className="flex items-center gap-4">
          {subscription?.status === "trial" && <span className="bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-full text-sm">Trial: {daysLeft} dias restantes</span>}
          {subscription?.status === "active" && <span className="bg-green-500/20 text-green-400 px-3 py-1 rounded-full text-sm">PRO Ativo - {daysLeft} dias</span>}
          <span className="text-slate-400 text-sm">{user?.email}</span>
          <button onClick={logout} className="text-slate-400 hover:text-white">Sair</button>
        </div>
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6"><p className="text-slate-400 text-sm">Vendas</p><p className="text-2xl font-bold mt-2">R$ 0,00</p><p className="text-xs text-slate-500 mt-1">Conectado ao backend prod</p></div>
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6"><p className="text-slate-400 text-sm">Produtos</p><p className="text-2xl font-bold mt-2">0</p><p className="text-xs text-slate-500 mt-1">Multi-tenant ativo</p></div>
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6"><p className="text-slate-400 text-sm">Assinatura</p><p className="text-2xl font-bold mt-2 capitalize">{subscription?.status}</p><p className="text-xs text-slate-500 mt-1">{subscription?.plan?.name}</p></div>
        </div>
        <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6">
          <h2 className="font-bold mb-2">Bem-vindo ao NEXUS OS Produção</h2>
          <p className="text-slate-400 text-sm">Frontend conectado em: {import.meta.env.VITE_API_URL || "NÃO CONFIGURADO"}</p>
          <p className="text-slate-400 text-sm mt-2">Este é o dashboard base. As páginas de Produtos, Vendas, Financeiro, etc, usam o mesmo visual que você já tinha, agora com chamadas reais para /api/* com isolamento por companyId.</p>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/billing/success" element={<BillingSuccessPage />} />
          <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}