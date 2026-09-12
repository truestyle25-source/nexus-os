
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function DRE(){
  const [dre,setDre]=useState<any>(null);
  useEffect(()=>{ load(); },[]);
  async function load(){ const token=localStorage.getItem('token'); const {data}=await api.get('/dre',{headers:{Authorization:`Bearer ${token}`}}); setDre(data); }
  return <div style={{padding:20}}>
    <h1>DRE - Seção 16 - Baseada em dados reais, sem números fictícios</h1>
    <p>Estrutura: Receita bruta, Deduções, Receita líquida, Custos, Despesas, Resultado operacional, Lucro/prejuízo, Margens</p>
    {dre && <div style={{background:'#111',padding:20}}>
      <div>Receita bruta: R$ {dre.detalhes.receitaBruta.toFixed(2)}</div>
      <div>Deduções: R$ {dre.detalhes.deducoes.toFixed(2)}</div>
      <div>Receita líquida: R$ {dre.detalhes.receitaLiquida.toFixed(2)}</div>
      <div>Custos (custo produto x qtd vendida): R$ {dre.detalhes.custos.toFixed(2)}</div>
      <div>Despesas: R$ {dre.detalhes.despesas.toFixed(2)}</div>
      <div>Resultado operacional: R$ {dre.detalhes.resultadoOperacional.toFixed(2)}</div>
      <div>Lucro/prejuízo: R$ {dre.detalhes.lucroPrejuizo.toFixed(2)}</div>
      <div>Margem bruta: {dre.detalhes.margemBruta.toFixed(1)}%</div>
      <div>Margem líquida: {dre.detalhes.margemLiquida.toFixed(1)}%</div>
    </div>}
  </div>
}
