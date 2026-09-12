
'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
export default function IA(){
  const [pergunta,setPergunta]=useState('Quanto vendemos hoje? Qual produto vendeu mais?'); const [resposta,setResposta]=useState<any>(null); const [loading,setLoading]=useState(false);
  async function perguntar(){
    setLoading(true);
    try {
      const token=localStorage.getItem('token');
      const {data}=await api.post('/ia/perguntar',{pergunta},{headers:{Authorization:`Bearer ${token}`}});
      setResposta(data);
    } catch(e:any){ setResposta({resposta:'Erro: '+(e.response?.data?.error||e.message)}); }
    setLoading(false);
  }
  return <div style={{padding:20}}>
    <h1>NEXUS AI - Seções 22 a 26 - FIEL</h1>
    <p>Arquitetura: NEXUS OS → BACKEND → OPENAI API oficial → BACKEND → NEXUS AI - Chave nunca frontend Seção 22 e 39</p>
    <p>ASSISTENTE: Quanto vendemos hoje? Produto mais vendido? Setor? Ticket médio? Estoque?</p>
    <p>ANALISTA: Queda vendas, aumento despesas, redução margem, produtos parados, estoque baixo, anomalias</p>
    <p>COPILOTO: Recomendações, Insights, Previsões, Alertas inteligentes - Seção 23</p>
    <p>Seção 24: Nunca inventa dados - Se não tem info, informa</p>
    <p>Seção 25: Respeita permissões - se não pode financeiro, IA não revela</p>
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <input value={pergunta} onChange={e=>setPergunta(e.target.value)} style={{padding:10,width:500}}/>
      <button onClick={perguntar} disabled={loading} style={{padding:10,background:'#fff',color:'#000'}}>{loading?'NEXUS AI PENSANDO...':'PERGUNTAR IA'}</button>
    </div>
    {resposta && <div style={{background:'#111',padding:20}}><p><b>Resposta:</b> {resposta.resposta}</p><pre style={{background:'#000',padding:10,marginTop:10,fontSize:12}}>{JSON.stringify(resposta.contexto||{},null,2)}</pre><p style={{fontSize:10,opacity:0.5}}>{resposta.fluxo} - Permissões: {resposta.permissoesRespeitadas?'SIM':'NÃO'}</p></div>}
  </div>
}
