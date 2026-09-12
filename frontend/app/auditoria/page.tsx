
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Auditoria(){
  const [logs,setLogs]=useState<any[]>([]);
  useEffect(()=>{ const token=localStorage.getItem('token'); api.get('/auditoria',{headers:{Authorization:`Bearer ${token}`}}).then(r=>setLogs(r.data)); },[]);
  return <div style={{padding:20}}><h1>AUDITORIA - Seção 32</h1><p>Usuario, Data, Ação, Entidade, Valor Anterior/Novo, Origem, IP, Contexto</p>
  {logs.map((l:any)=><div key={l.id} style={{borderBottom:'1px solid #333',padding:10}}><b>{l.acao}</b> {l.entidade} - {l.origem} - {new Date(l.createdAt).toLocaleString()} - {l.usuario?.nome}</div>)}
  </div>
}
