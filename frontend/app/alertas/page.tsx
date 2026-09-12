
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Alertas(){
  const [alertas,setAlertas]=useState<any[]>([]); const [notifs,setNotifs]=useState<any[]>([]);
  async function load(){ const token=localStorage.getItem('token'); const a=await api.get('/alertas',{headers:{Authorization:`Bearer ${token}`}}); setAlertas(a.data); const n=await api.get('/notificacoes',{headers:{Authorization:`Bearer ${token}`}}); setNotifs(n.data); }
  useEffect(()=>{load()},[]);
  async function executar(){ const token=localStorage.getItem('token'); const {data}=await api.post('/automacao/executar',{},{headers:{Authorization:`Bearer ${token}`}}); alert(`Automação executada - ${data.alertasCriados} alertas - Motor SE/ENTÃO Seção 29`); load(); }
  return <div style={{padding:20}}>
    <h1>ALERTAS + NOTIFICAÇÕES + AUTOMAÇÃO - Seções 27,28,29 - FIEL</h1>
    <p>Alertas: estoque abaixo mínimo, sem estoque, validade, queda vendas, meta abaixo, conta vencimento, aumento despesas, falta, atraso, hora extra, anomalia IA - Seção 27</p>
    <p>Motor: SE estoque {'<'} mínimo ENTÃO alerta - SE meta {'<'}70% ENTÃO alerta+IA - SE despesa aumenta ENTÃO alerta - Seção 29</p>
    <button onClick={executar} style={{padding:10,background:'#fff',color:'#000',marginBottom:20}}>EXECUTAR AUTOMAÇÃO - VERIFICAR REGRAS SE/ENTÃO</button>
    <h3>Alertas ({alertas.length}) - Tipo, Prioridade, Status, Origem, Entidade</h3>{alertas.map((a:any)=><div key={a.id} style={{border:'1px solid #333',padding:10,marginBottom:5}}><b>{a.tipo} - {a.prioridade}</b> {a.titulo} - {a.descricao} - {new Date(a.createdAt).toLocaleString()}</div>)}
    <h3>Notificações ({notifs.length}) - Tipo, Data, Prioridade, Status, Usuário, Origem, Link Seção 28</h3>{notifs.map((n:any)=><div key={n.id} style={{border:'1px solid #333',padding:10,marginBottom:5}}><b>{n.tipo}</b> {n.titulo} - Lida: {n.lida?'SIM':'NÃO'} - Link: {n.link||'sem link'}</div>)}
  </div>
}
