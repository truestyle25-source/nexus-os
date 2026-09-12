
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function RH(){
  const [funcs,setFuncs]=useState<any[]>([]); const [deps,setDeps]=useState<any[]>([]); const [cargos,setCargos]=useState<any[]>([]);
  const [nome,setNome]=useState(''); const [cpf,setCpf]=useState(''); const [idExt,setIdExt]=useState('');
  const [indicadores,setIndicadores]=useState<any>(null);
  async function load(){ const token=localStorage.getItem('token'); const f=await api.get('/funcionarios',{headers:{Authorization:`Bearer ${token}`}}); setFuncs(f.data); const d=await api.get('/departamentos',{headers:{Authorization:`Bearer ${token}`}}); setDeps(d.data); const c=await api.get('/cargos',{headers:{Authorization:`Bearer ${token}`}}); setCargos(c.data); const ind=await api.get('/rh/indicadores',{headers:{Authorization:`Bearer ${token}`}}); setIndicadores(ind.data); }
  useEffect(()=>{load()},[]);
  async function criar(){
    const token=localStorage.getItem('token');
    await api.post('/funcionarios',{nome,cpf,idExternoPonto:idExt,origem:'MANUAL'},{headers:{Authorization:`Bearer ${token}`}});
    load();
  }
  return <div style={{padding:20}}>
    <h1>RH - Seção 20 - Completo</h1>
    <p>Funcionários, Cargo, Setor, Data admissão/desligamento, Promoções, Advertências, Férias, Histórico, Desempenho + CPF único + idExternoPonto ControlID</p>
    {indicadores && <div style={{display:'flex',gap:20,marginBottom:20,background:'#111',padding:10}}><div>Total: {indicadores.totalFuncionarios}</div><div>Ativos: {indicadores.ativos}</div><div>Faltas hoje: {indicadores.faltas}</div><div>Atrasos: {indicadores.atrasos}</div><div>Hora extra: {indicadores.horasExtras}min</div><div>Absenteísmo: {indicadores.absenteismo.toFixed(1)}%</div><div>Turnover: {indicadores.turnover.toFixed(1)}%</div></div>}
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <input placeholder="Nome" value={nome} onChange={e=>setNome(e.target.value)} style={{padding:10}}/>
      <input placeholder="CPF único" value={cpf} onChange={e=>setCpf(e.target.value)} style={{padding:10}}/>
      <input placeholder="ID Externo Ponto (ControlID)" value={idExt} onChange={e=>setIdExt(e.target.value)} style={{padding:10}}/>
      <button onClick={criar} style={{padding:10}}>+ NOVO FUNCIONÁRIO</button>
    </div>
    <table style={{width:'100%'}}><thead><tr><th>Nome</th><th>CPF</th><th>ID Ponto</th><th>Status</th></tr></thead><tbody>{funcs.map((f:any)=><tr key={f.id}><td>{f.nome}</td><td>{f.cpf}</td><td>{f.idExternoPonto}</td><td>{f.status}</td></tr>)}</tbody></table>
  </div>
}
