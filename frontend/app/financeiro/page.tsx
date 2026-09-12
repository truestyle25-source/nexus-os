
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Financeiro(){
  const [dados,setDados]=useState<any>(null);
  const [desc,setDesc]=useState(''); const [valor,setValor]=useState(100); const [tipo,setTipo]=useState('DESPESA'); const [cat,setCat]=useState('operacionais');
  async function load(){ const token=localStorage.getItem('token'); const {data}=await api.get('/financeiro',{headers:{Authorization:`Bearer ${token}`}}); setDados(data); }
  useEffect(()=>{load()},[]);
  async function criar(){
    const token=localStorage.getItem('token');
    await api.post('/financeiro',{tipo,categoria:cat,descricao:desc,valor,origem:'MANUAL'},{headers:{Authorization:`Bearer ${token}`}});
    load();
  }
  return <div style={{padding:20}}>
    <h1>FINANCEIRO - Seção 15 - Completo</h1>
    <p>Receitas: Vendas, Outras receitas, Categorias, Centro custo | Despesas: Fornecedores, Salários, Serviços, Impostos, Operacionais | Contas a pagar/receber, Vencimentos, Fluxo caixa</p>
    {dados && <div style={{display:'flex',gap:20,marginBottom:20}}><div>Receitas: R$ {dados.fluxo.receitas.toFixed(2)}</div><div>Despesas: R$ {dados.fluxo.despesas.toFixed(2)}</div><div>Resultado: R$ {dados.fluxo.resultado.toFixed(2)}</div><div>A pagar: {dados.fluxo.contasAPagar}</div><div>A receber: {dados.fluxo.contasAReceber}</div></div>}
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <select value={tipo} onChange={e=>setTipo(e.target.value)} style={{padding:10}}><option>RECEITA</option><option>DESPESA</option></select>
      <input placeholder="Categoria" value={cat} onChange={e=>setCat(e.target.value)} style={{padding:10}}/>
      <input placeholder="Descrição" value={desc} onChange={e=>setDesc(e.target.value)} style={{padding:10,width:300}}/>
      <input type="number" value={valor} onChange={e=>setValor(Number(e.target.value))} style={{padding:10,width:100}}/>
      <button onClick={criar} style={{padding:10}}>+ NOVA {tipo}</button>
    </div>
  </div>
}
