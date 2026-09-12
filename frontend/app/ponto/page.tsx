
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Ponto(){
  const [pontos,setPontos]=useState<any[]>([]); const [funcs,setFuncs]=useState<any[]>([]);
  const [funcId,setFuncId]=useState(''); const [data,setData]=useState(new Date().toISOString().slice(0,10));
  useEffect(()=>{ load(); },[]);
  async function load(){ const token=localStorage.getItem('token'); const p=await api.get('/ponto',{headers:{Authorization:`Bearer ${token}`}}); setPontos(p.data); const f=await api.get('/funcionarios',{headers:{Authorization:`Bearer ${token}`}}); setFuncs(f.data); }
  async function bater(){
    const token=localStorage.getItem('token');
    await api.post('/ponto/manual',{funcionarioId:funcId,data,entrada:new Date().toISOString()},{headers:{Authorization:`Bearer ${token}`}});
    load();
  }
  async function sincronizar(){
    const token=localStorage.getItem('token');
    // cria integracao exemplo e sincroniza
    const integ = await api.post('/ponto/integracao',{nome:'iDClass Principal',url:process.env.NEXT_PUBLIC_CONTROLID_URL || '',usuario:'admin'},{headers:{Authorization:`Bearer ${token}`}});
    const sync = await api.post(`/ponto/sincronizar/${integ.data.integracao.id}`,{},{headers:{Authorization:`Bearer ${token}`}});
    alert('Sincronização ControlID API oficial: ' + sync.data.mensagem + '\n\nCódigo oficial:\n' + sync.data.codigoOficial);
  }
  return <div style={{padding:20}}>
    <h1>CONTROLE DE PONTO - Seção 21 - ControlID iDClass API oficial</h1>
    <p>Sincroniza: Entrada, Saída, Intervalo, Retorno, Atrasos, Faltas, Horas extras, Banco horas, Saída antecipada, Inconsistências</p>
    <p>Fluxo: PONTO → RH → INDICADORES → DASHBOARD → IA</p>
    <p>API oficial: POST /login.fcgi + POST /load_objects.fcgi com object access_logs - NUNCA inventar endpoint - Seção 21 e 39</p>
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <select value={funcId} onChange={e=>setFuncId(e.target.value)} style={{padding:10,width:300}}><option value="">Funcionário</option>{funcs.map((f:any)=><option key={f.id} value={f.id}>{f.nome} - ID Ponto: {f.idExternoPonto||'sem id'}</option>)}</select>
      <input type="date" value={data} onChange={e=>setData(e.target.value)} style={{padding:10}}/>
      <button onClick={bater} style={{padding:10}}>BATER PONTO MANUAL</button>
      <button onClick={sincronizar} style={{padding:10,background:'#fff',color:'#000'}}>SINCRONIZAR CONTROLID OFICIAL</button>
    </div>
    <table style={{width:'100%'}}><thead><tr><th>Data</th><th>Func</th><th>Entrada</th><th>Saída</th><th>Atraso</th><th>Hora extra</th><th>Falta</th><th>Inconsistência</th><th>Origem</th></tr></thead><tbody>{pontos.map((p:any)=><tr key={p.id}><td>{new Date(p.data).toLocaleDateString()}</td><td>{p.funcionario?.nome}</td><td>{p.entrada?new Date(p.entrada).toLocaleTimeString():''}</td><td>{p.saida?new Date(p.saida).toLocaleTimeString():''}</td><td>{p.atrasoMinutos}min</td><td>{p.horaExtraMinutos}min</td><td>{p.falta?'SIM':''}</td><td>{p.inconsistencia||''}</td><td>{p.origem}</td></tr>)}</tbody></table>
  </div>
}
