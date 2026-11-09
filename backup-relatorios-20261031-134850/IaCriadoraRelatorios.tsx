'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import RelatorioCard, { type RelatorioGerado } from './RelatorioCard';

/**
 * Convite exibido quando o histórico veio VAZIO (resposta bem-sucedida).
 *
 * Só aparece depois de um 200 com lista vazia — nunca quando a chamada falha.
 * Não traz nenhum número: os KPIs são "—" e o texto diz que o layout é o que a
 * IA monta. Ele existe para mostrar o formato de saída antes do primeiro
 * relatório, não para simular um relatório.
 */
const RELATORIO_EXEMPLO: RelatorioGerado = {
  id: 'exemplo',
  empresaId: 'exemplo',
  perguntaOriginal: '',
  titulo: 'Como fica um relatório gerado aqui',
  tipo: 'vendas',
  dados: {
    resumo:
      'Este é o layout do relatório que a IA NEXUS monta a partir dos dados reais da empresa: KPIs, gráfico, insights e tabela, com exportação para Excel/CSV. Faça uma pergunta acima para gerar o primeiro relatório com números reais.',
    kpis: [
      { label: 'Faturamento', valor: '—', delta: 'exemplo', subiu: true },
      { label: 'Ticket médio', valor: '—', delta: 'exemplo', subiu: true },
      { label: 'Qtd vendas', valor: '—', delta: 'exemplo', subiu: true },
    ],
    tabela: [],
    fonte: 'vendas',
    periodo: { de: null, ate: null },
    fallback: false,
  },
  insights: [
    'Modelo de exibição — nenhum número aparece aqui, porque nenhum dado foi consultado ainda.',
    'Digite uma pergunta como “vendas por forma de pagamento nos últimos 30 dias”.',
    'Os KPIs, o gráfico e a tabela serão calculados sobre o banco real da empresa.',
  ],
  criadoEm: '',
  exemplo: true,
};

/**
 * Barra de criação de relatórios por IA (Seção 33): pergunta em linguagem
 * natural → backend interpreta, busca dados reais e persiste em
 * RelatorioGerado → card pixel-perfect renderizado logo abaixo.
 */
export default function IaCriadoraRelatorios({ tab }: { tab?: string }) {
  const [pergunta, setPergunta] = useState('');
  const [relatorios, setRelatorios] = useState<RelatorioGerado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * O histórico não pôde ser lido (401/403/500/rede). Distinto de "não há
   * relatórios": no segundo caso mostramos o card de exemplo como convite para
   * gerar o primeiro, no primeiro temos que dizer que o acesso falhou.
   */
  const [falhaAoCarregar, setFalhaAoCarregar] = useState(false);

  // Histórico: 20 últimos; se vazio, mostra o card de exemplo.
  //
  // IMPORTANTE: erro e "vazio" são estados DIFERENTES. Antes, o `catch` também
  // caía no card de exemplo, o que fazia uma sessão expirada (401), uma
  // permissão negada (403) ou uma queda do servidor (500) aparecerem na tela
  // como "nenhum relatório ainda" — o usuário era levado a acreditar que não
  // tinha dados quando, na verdade, não conseguia acessá-los. Um erro precisa
  // ser dito como erro.
  useEffect(() => {
    let ativo = true;
    api
      .get<RelatorioGerado[]>('/relatorios/ia/historico')
      .then(({ data }) => {
        if (ativo) setRelatorios(Array.isArray(data) ? data : []);
      })
      .catch((e: unknown) => {
        if (!ativo) return;
        setFalhaAoCarregar(true);
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 403) {
          setErro('Você não tem permissão para ver os relatórios desta empresa.');
        } else if (status === undefined) {
          setErro('Não foi possível falar com o servidor. Verifique a conexão.');
        } else {
          setErro(`Não foi possível carregar o histórico de relatórios (erro ${status}).`);
        }
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  async function perguntar() {
    const p = pergunta.trim();
    if (p.length < 5) {
      setErro('Descreva o relatório em pelo menos 5 caracteres.');
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      const { data } = await api.post<RelatorioGerado>('/relatorios/ia/criar', {
        pergunta: p,
        tab,
      });
      setRelatorios((atual) => [data, ...atual.filter((r) => !r.exemplo)]);
      setPergunta('');
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar o relatório agora.');
    } finally {
      setGerando(false);
    }
  }

  return (
    <section className="ia-criadora" aria-label="Criar relatório com IA">
      <style>{`
        .ia-criadora { display: flex; flex-direction: column; gap: 14px; }
        .ia-bar {
          display: flex; align-items: center; gap: 14px;
          padding: 18px 20px; border-radius: 16px;
          background: linear-gradient(135deg, #1c1c3a, #252550);
          border: 1px solid #3a3a6a;
          flex-wrap: wrap;
        }
        @keyframes iaPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.55); }
          50% { box-shadow: 0 0 0 9px rgba(124, 58, 237, 0); }
        }
        .ia-bar-icon {
          width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          display: grid; place-items: center;
          color: #ffffff; font-size: 20px; line-height: 1;
          animation: iaPulse 2s ease-in-out infinite;
        }
        .ia-bar-body { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 10px; }
        .ia-bar-titles { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .ia-bar-title { font-size: 13px; font-weight: 700; color: #ffffff; letter-spacing: 0.04em; }
        .ia-bar-title em { font-style: normal; color: #a78bfa; }
        .ia-bar-sub { font-size: 12px; color: #8a8ab0; }
        .ia-form { display: flex; gap: 10px; flex-wrap: wrap; }
        .ia-input {
          flex: 1; min-width: 220px; height: 40px;
          background: rgba(10, 10, 20, 0.72);
          border: 1px solid #3a3a6a; border-radius: 10px;
          padding: 0 14px; font-size: 13px; color: #ffffff; outline: none;
        }
        .ia-input::placeholder { color: #7b7b9a; }
        .ia-input:focus { border-color: #7c3aed; }
        .ia-input:disabled { opacity: 0.6; }
        .ia-btn {
          height: 40px; padding: 0 18px; border: none; border-radius: 10px;
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer;
          white-space: nowrap;
        }
        .ia-btn:hover:not(:disabled) { filter: brightness(1.1); }
        .ia-btn:disabled { opacity: 0.6; cursor: wait; }
        .ia-erro { font-size: 12px; color: #ef4444; margin: -6px 0 0 4px; }
        .ia-lista { display: flex; flex-direction: column; gap: 14px; }
        .ia-loading { font-size: 12px; color: #7b7b9a; }
        @media (max-width: 640px) {
          .ia-bar { padding: 14px; }
          .ia-btn { width: 100%; }
        }
      `}</style>

      <div className="ia-bar">
        <div className="ia-bar-icon" aria-hidden="true">✦</div>
        <div className="ia-bar-body">
          <div className="ia-bar-titles">
            <span className="ia-bar-title">IA <em>NEXUS</em> — Criador de relatórios</span>
            <span className="ia-bar-sub">
              Pergunte em linguagem natural: eu busco os dados reais da empresa e monto o
              relatório completo.
            </span>
          </div>
          <div className="ia-form">
            <input
              className="ia-input"
              type="text"
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void perguntar();
              }}
              placeholder="Ex.: vendas por forma de pagamento nos últimos 30 dias"
              disabled={gerando}
              aria-label="Descreva o relatório que deseja gerar"
            />
            <button
              className="ia-btn"
              type="button"
              onClick={() => void perguntar()}
              disabled={gerando}
            >
              {gerando ? 'Gerando…' : 'Gerar relatório'}
            </button>
          </div>
        </div>
      </div>

      {erro && <p className="ia-erro" role="alert">{erro}</p>}

      <div className="ia-lista" aria-live="polite">
        {carregando ? (
          <p className="ia-loading">Carregando histórico de relatórios…</p>
        ) : falhaAoCarregar ? (
          // Falha de leitura não vira "sem relatórios": sem histórico não há
          // como saber se existe algo, e mostrar o convite de exemplo aqui
          // esconderia o erro por trás de uma tela que parece normal.
          <p className="ia-loading">Não foi possível carregar os relatórios desta empresa.</p>
        ) : relatorios.length === 0 ? (
          // Convite para gerar o primeiro relatório — só quando sabemos, pela
          // resposta bem-sucedida, que realmente não existe nenhum.
          <RelatorioCard relatorio={RELATORIO_EXEMPLO} />
        ) : (
          relatorios.map((r) => <RelatorioCard key={r.id} relatorio={r} />)
        )}
      </div>
    </section>
  );
}