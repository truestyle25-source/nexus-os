
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function PDV(){
  const [integracoes,setIntegracoes]=useState<any[]>([]);
  useEffect(()=>{ load(); },[]);
  async function load(){ const token=localStorage.getItem('token'); const {data}=await api.get('/pdv/integracoes',{headers:{Authorization:`Bearer ${token}`}}); setIntegracoes(data); }
  async function criar(){ const token=localStorage.getItem('token'); await api.post('/pdv/integracoes',{nome:'PDV Principal',tipo:'API_OFICIAL',url:''},{headers:{Authorization:`Bearer ${token}`}}); load(); }
  return <div style={{padding:20}}>
    <h1>PDV - Seção 14 - Só API oficial</h1>
    <p>NUNCA inventar endpoints - usar só API oficial, SDK oficial, Webhook oficial, Banco autorizado</p>
    <p>Central mostra: Conectado, Atenção, Erro, Não configurado + última sync + qtd registros + erros + histórico</p>
    <button onClick={criar} style={{padding:10,marginBottom:20}}>+ NOVA INTEGRAÇÃO PDV</button>
    {integracoes.map((i:any)=><div key={i.id} style={{border:'1px solid #333',padding:10,marginBottom:10}}><b>{i.nome}</b> - {i.tipo} - Status: {i.status} - Última: {i.ultimaSincronizacao||'nunca'}</div>)}
  </div>
}
