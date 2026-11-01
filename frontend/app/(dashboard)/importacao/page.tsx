'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getToken } from '@/lib/api';
import ModuleHeader from '@/components/ModuleHeader';

export default function Importacao() {
  const router = useRouter();
  const [dados, setDados] = useState('[{"nome":"Produto Teste","sku":"SKU001","custo":10,"precoVenda":20}]');
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (!getToken()) router.replace('/'); }, [router]);

  async function importar() {
    // Trava de duplo clique: sem ela, dois cliques rápidos disparavam DUAS
    // importações do mesmo arquivo, duplicando os produtos no banco.
    if (enviando) return;
    setError(null); setResultado(null); setEnviando(true);
    try {
      const parsed = JSON.parse(dados);
      const { data } = await api.post('/importacao', {
        tipo: 'json',
        dados: parsed,
        mapeamento: { entidade: 'Produto', campos: { nome: 'nome', sku: 'sku', custo: 'custo', precoVenda: 'precoVenda' }, confirmado: true },
      });
      setResultado(data);
    } catch (err: any) {
      setError(err instanceof SyntaxError ? 'JSON inválido.' : err.response?.data?.error || 'Não foi possível importar os dados.');
    } finally {
      setEnviando(false);
    }
  }

  const semErros = resultado && !resultado.erros?.length && !resultado.duplicidades?.length && resultado.qtdImportada > 0;

  return (
    <main className="admin-page">
      <ModuleHeader title="Importação" subtitle="Fluxo: upload → identificação de colunas → pré-visualização → mapeamento → validação → duplicidades → correção → confirmação → importação → auditoria." />
      {error && <p className="admin-message admin-error">{error}</p>}
      {semErros && (
        <p className="admin-message admin-success">
          {resultado.qtdImportada} registro(s) importado(s) com sucesso. A operação foi gravada na auditoria.
        </p>
      )}

      <section className="admin-panel admin-wide">
        <h2>Importar produtos (JSON)</h2>
        <textarea className="admin-pre" style={{ width: '100%', minHeight: 120, marginBottom: 12 }} value={dados} onChange={(e) => setDados(e.target.value)} />
        <button className="admin-primary" type="button" onClick={importar} disabled={enviando}>
          {enviando ? 'Importando…' : 'Importar com validação e auditoria'}
        </button>
        {resultado && <pre className="admin-pre" style={{ marginTop: 16 }}>{JSON.stringify(resultado, null, 2)}</pre>}
      </section>
    </main>
  );
}
