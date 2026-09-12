
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Estoque(){
  const [dados,setDados]=useState<any>(null);
  const [produtoId,setProdutoId]=useState(''); const [qtd,setQtd]=useState(10); const [tipo,setTipo]=useState('ENTRADA');
  async function load(){ const token=localStorage.getItem('token'); const {data}=await api.get('/estoque',{headers:{Authorization:`Bearer ${token}`}}); setDados(data); }
  useEffect(()=>{load()},[]);
  async function movimentar(){
    const token=localStorage.getItem('token');
    const filiais = await api.get('/empresas',{headers:{Authorization:`Bearer ${token}`}});
    const filialId = filiais.data[0]?.filiais?.[0]?.id;
    await api.post('/estoque/movimentar',{produtoId,filialId,quantidade:qtd,tipo,origem:'MANUAL',motivo:'Mov manual PARTE 2'},{headers:{Authorization:`Bearer ${token}`}});
    load();
  }
  return <div style={{padding:20}}>
    <h1>ESTOQUE - Seção 9 - Controle completo</h1>
    {dados && <div style={{display:'flex',gap:20,marginBottom:20}}>
      <div>Valor total: {dados.indicadores.valorTotal!==undefined ? `R$ ${dados.indicadores.valorTotal.toFixed(2)}` : 'sem permissão para ver custos'}</div>
      <div style={{color:'orange'}}>Baixo: {dados.indicadores.qtdBaixo}</div>
      <div style={{color:'red'}}>Sem estoque: {dados.indicadores.qtdSemEstoque}</div>
    </div>}
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <input placeholder="produtoId" value={produtoId} onChange={e=>setProdutoId(e.target.value)} style={{padding:10,width:300}}/>
      <input type="number" value={qtd} onChange={e=>setQtd(Number(e.target.value))} style={{padding:10,width:80}}/>
      <select value={tipo} onChange={e=>setTipo(e.target.value)} style={{padding:10}}><option>ENTRADA</option><option>SAIDA</option><option>AJUSTE</option><option>PERDA</option><option>AVARIA</option></select>
      <button onClick={movimentar} style={{padding:10}}>MOVIMENTAR COM AUDITORIA</button>
    </div>
    <p>Toda movimentação registra: Produto, Quantidade, Tipo, Data/hora, Usuário, Origem, Motivo, Documento</p>
  </div>
}
