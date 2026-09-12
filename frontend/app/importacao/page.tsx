
'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
export default function Importacao(){
  const [dados,setDados]=useState('[{"nome":"Produto Teste","sku":"SKU001","custo":10,"precoVenda":20}]');
  const [resultado,setResultado]=useState<any>(null);
  async function importar(){
    const token=localStorage.getItem('token');
    const parsed = JSON.parse(dados);
    const {data}=await api.post('/importacao',{tipo:'json',dados:parsed,mapeamento:{entidade:'Produto',campos:{nome:'nome',sku:'sku',custo:'custo',precoVenda:'precoVenda'},confirmado:true}},{headers:{Authorization:`Bearer ${token}`}});
    setResultado(data);
  }
  return <div style={{padding:20}}>
    <h1>IMPORTAÇÃO INTELIGENTE - Seção 30 - 11 passos FIEL</h1>
    <p>Fluxo: Upload, Identificação colunas, Pré-visualização, Mapeamento, Validação, Duplicidades, Erros, Correção, Confirmação, Importação, Auditoria</p>
    <textarea value={dados} onChange={e=>setDados(e.target.value)} style={{width:'100%',height:100,background:'#111',color:'#fff',padding:10}}/>
    <button onClick={importar} style={{padding:10,marginTop:10,background:'#fff',color:'#000'}}>IMPORTAR COM VALIDAÇÃO E AUDITORIA</button>
    {resultado && <pre style={{background:'#111',padding:10,marginTop:20}}>{JSON.stringify(resultado,null,2)}</pre>}
  </div>
}
