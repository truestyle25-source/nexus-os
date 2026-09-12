
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Produtos(){
  const [produtos,setProdutos]=useState<any[]>([]);
  const [nome,setNome]=useState(''); const [custo,setCusto]=useState(10); const [preco,setPreco]=useState(20);
  async function load(){ const token=localStorage.getItem('token'); const {data}=await api.get('/produtos',{headers:{Authorization:`Bearer ${token}`}}); setProdutos(data.produtos ?? []); }
  useEffect(()=>{load()},[]);
  async function criar(){
    const token=localStorage.getItem('token');
    const filiais = await api.get('/empresas',{headers:{Authorization:`Bearer ${token}`}});
    const filialId = filiais.data[0]?.filiais?.[0]?.id;
    if(!filialId) return alert('Crie uma filial antes');
    await api.post('/produtos',{nome,custo,precoVenda:preco,origem:'MANUAL'},{headers:{Authorization:`Bearer ${token}`}});
    load();
  }
  return <div style={{padding:20}}>
    <h1>+ NOVO PRODUTO - Seção 8</h1>
    <p>Campos: Nome, SKU, Código barras, Categoria, Fornecedor, Custo, Preço, Margem, Unidade, Estoque min/max, Validade, Imagem, Descrição, Status, Origem</p>
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <input placeholder="Nome" value={nome} onChange={e=>setNome(e.target.value)} style={{padding:10}}/>
      <input type="number" placeholder="Custo" value={custo} onChange={e=>setCusto(Number(e.target.value))} style={{padding:10,width:100}}/>
      <input type="number" placeholder="Preço venda" value={preco} onChange={e=>setPreco(Number(e.target.value))} style={{padding:10,width:100}}/>
      <button onClick={criar} style={{padding:10,background:'#fff',color:'#000'}}>+ NOVO PRODUTO</button>
    </div>
    <table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>Nome</th><th>Custo</th><th>Preço</th><th>Margem</th><th>Origem</th></tr></thead>
    <tbody>{produtos.map((p:any)=><tr key={p.id} style={{borderTop:'1px solid #333'}}><td>{p.nome}</td><td>{p.custo ?? '— (sem permissão)'}</td><td>{p.precoVenda}</td><td>{p.margem!==undefined?Number(p.margem).toFixed(1)+'%':'—'}</td><td>{p.origem}</td></tr>)}</tbody></table>
  </div>
}
