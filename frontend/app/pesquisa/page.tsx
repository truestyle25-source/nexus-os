
'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
export default function Pesquisa(){
  const [q,setQ]=useState(''); const [res,setRes]=useState<any>(null);
  async function pesquisar(){
    const token=localStorage.getItem('token');
    const {data}=await api.get(`/pesquisa-global?q=${q}`,{headers:{Authorization:`Bearer ${token}`}});
    setRes(data);
  }
  return <div style={{padding:20}}>
    <h1>PESQUISA GLOBAL - Seção 34 - FIEL</h1>
    <p>Pesquisa Produtos, Clientes, Funcionários, Fornecedores, Vendas, Documentos, Registros - respeita permissões</p>
    <div style={{display:'flex',gap:10}}><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar..." style={{padding:10,width:300}}/><button onClick={pesquisar} style={{padding:10}}>PESQUISAR</button></div>
    {res && <pre style={{background:'#111',padding:10,marginTop:20}}>{JSON.stringify(res,null,2)}</pre>}
  </div>
}
