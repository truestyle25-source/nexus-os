
'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
export default function Vendas(){
  const [produtos,setProdutos]=useState<any[]>([]);
  const [vendas,setVendas]=useState<any[]>([]);
  const [produtoId,setProdutoId]=useState(''); const [qtd,setQtd]=useState(1);
  const [carrinho,setCarrinho]=useState<any[]>([]);
  useEffect(()=>{ const token=localStorage.getItem('token'); api.get('/produtos',{headers:{Authorization:`Bearer ${token}`}}).then(r=>setProdutos(r.data.produtos ?? [])); loadVendas(); },[]);
  async function loadVendas(){ const token=localStorage.getItem('token'); const {data}=await api.get('/vendas',{headers:{Authorization:`Bearer ${token}`}}); setVendas(data); }
  function addCarrinho(){ const prod=produtos.find((p:any)=>p.id===produtoId); if(!prod) return; setCarrinho([...carrinho,{produtoId, nome:prod.nome, quantidade:qtd, preco:Number(prod.precoVenda)}]); }
  async function finalizar(){
    const token=localStorage.getItem('token');
    const filiais = await api.get('/empresas',{headers:{Authorization:`Bearer ${token}`}});
    const filialId = filiais.data[0]?.filiais?.[0]?.id;
    const {data} = await api.post('/vendas',{filialId,itens:carrinho.map((c:any)=>({produtoId:c.produtoId,quantidade:c.quantidade})),origem:'MANUAL'},{headers:{Authorization:`Bearer ${token}`}});
    alert(`Venda ${data.venda.id} finalizada - Fluxo 13 passos executado: baixa estoque, faturamento, ticket, metas, financeiro, cliente, auditoria`);
    setCarrinho([]); loadVendas();
  }
  return <div style={{padding:20}}>
    <h1>+ NOVA VENDA - Seção 13 - Fluxo 13 passos Seção 2</h1>
    <p>Produto, Quantidade, Preço, Desconto, Total, Cliente, Funcionário, Setor, Filial, Forma pagamento, Data/hora, Origem, Status</p>
    <div style={{display:'flex',gap:10,marginBottom:20}}>
      <select value={produtoId} onChange={e=>setProdutoId(e.target.value)} style={{padding:10,width:300}}><option value="">Selecione produto</option>{produtos.map((p:any)=><option key={p.id} value={p.id}>{p.nome} - R$ {p.precoVenda} - Estoque: {p.estoques?.[0]?.quantidade||0}</option>)}</select>
      <input type="number" value={qtd} onChange={e=>setQtd(Number(e.target.value))} style={{padding:10,width:80}}/>
      <button onClick={addCarrinho} style={{padding:10}}>ADD</button>
      <button onClick={finalizar} style={{padding:10,background:'#fff',color:'#000'}}>+ FINALIZAR VENDA</button>
    </div>
    <div>Carrinho: {carrinho.map((c,i)=><span key={i} style={{marginRight:10}}>{c.nome} x{c.quantidade}</span>)}</div>
    <h3 style={{marginTop:20}}>Últimas vendas</h3>
    <table style={{width:'100%'}}><thead><tr><th>ID</th><th>Total</th><th>Status</th><th>Origem</th></tr></thead><tbody>{vendas.map((v:any)=><tr key={v.id}><td>{v.id.slice(0,8)}</td><td>R$ {v.total}</td><td>{v.status}</td><td>{v.origem}</td></tr>)}</tbody></table>
  </div>
}
