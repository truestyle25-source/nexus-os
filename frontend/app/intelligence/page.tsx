
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Intelligence(){
  const [data,setData]=useState<any>(null);
  useEffect(()=>{ const token=localStorage.getItem('token'); api.get('/ia/intelligence-center',{headers:{Authorization:`Bearer ${token}`}}).then(r=>setData(r.data)); },[]);
  return <div style={{padding:20}}>
    <h1>NEXUS INTELLIGENCE CENTER - Seção 26 - FIEL</h1>
    <p>O que aconteceu, O que mudou, Problemas, Oportunidades, Recomendações com problema, causa, impacto, recomendação</p>
    {data && <div>
      <h3>O que aconteceu - Vendas, Estoque, Financeiro, RH</h3><pre style={{background:'#111',padding:10}}>{JSON.stringify(data.oQueAconteceu,null,2)}</pre>
      <h3>Problemas - Estoque baixo, Queda vendas, Aumento despesas, Faltas, Atrasos</h3>{data.problemas.map((p:any,i:number)=><div key={i} style={{border:'1px solid #333',padding:10,marginBottom:10}}><b>{p.tipo}</b>: {p.problema}<br/>Causa: {p.possivelCausa}<br/>Impacto: {p.impacto}<br/>Recomendação: {p.recomendacao}</div>)}
      <h3>Oportunidades - Produtos potencial, Setores crescimento, Horários maior venda</h3>{data.oportunidades.map((o:any,i:number)=><div key={i} style={{border:'1px solid #333',padding:10,marginBottom:10}}>{o.tipo}: {o.descricao}</div>)}
    </div>}
  </div>
}
