'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createInventoryMovement, createProduct, fetchProducts, getToken, type Product } from '@/lib/api';

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [productForm, setProductForm] = useState({ name: '', sku: '', cost: '0', salePrice: '0', minimumStock: '0' });
  const [movement, setMovement] = useState({ productId: '', quantity: '', type: 'entry' as 'entry' | 'exit' | 'adjustment' | 'loss' | 'return', reason: '' });

  async function load() {
    try { setProducts(await fetchProducts()); } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível carregar os produtos'); }
  }

  useEffect(() => {
    if (!getToken()) router.replace('/');
    else void load();
  }, [router]);

  async function handleProduct(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    try { await createProduct({ name: productForm.name, sku: productForm.sku, cost: Number(productForm.cost), salePrice: Number(productForm.salePrice), minimumStock: Number(productForm.minimumStock) }); setProductForm({ name: '', sku: '', cost: '0', salePrice: '0', minimumStock: '0' }); setNotice('Produto criado e auditado.'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o produto'); }
  }

  async function handleMovement(event: FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    try { await createInventoryMovement(movement.productId, { quantity: Number(movement.quantity), type: movement.type, reason: movement.reason }); setMovement({ ...movement, quantity: '', reason: '' }); setNotice('Movimentação registrada e estoque atualizado.'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível registrar a movimentação'); }
  }

  return <main className="admin-page"><header className="admin-header"><button className="back-button" type="button" onClick={() => router.push('/dashboard')}>← Dashboard</button><h1>Produtos e Estoque</h1><p>Dados persistidos por empresa. Sem produtos cadastrados, a lista permanece vazia.</p></header>{error && <p className="admin-message admin-error">{error}</p>}{notice && <p className="admin-message admin-success">{notice}</p>}<section className="admin-grid"><article className="admin-panel"><h2>Novo produto</h2><form onSubmit={handleProduct} className="admin-form"><label>Nome<input required minLength={2} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /></label><label>SKU<input required value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} /></label><label>Custo<input required type="number" min="0" step="0.01" value={productForm.cost} onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })} /></label><label>Preço de venda<input required type="number" min="0" step="0.01" value={productForm.salePrice} onChange={(e) => setProductForm({ ...productForm, salePrice: e.target.value })} /></label><label>Estoque mínimo<input required type="number" min="0" step="0.001" value={productForm.minimumStock} onChange={(e) => setProductForm({ ...productForm, minimumStock: e.target.value })} /></label><button className="admin-primary" type="submit">+ Novo produto</button></form></article><article className="admin-panel"><h2>Movimentar estoque</h2><form onSubmit={handleMovement} className="admin-form"><label>Produto<select required value={movement.productId} onChange={(e) => setMovement({ ...movement, productId: e.target.value })}><option value="">Selecione</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>)}</select></label><label>Tipo<select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value as typeof movement.type })}><option value="entry">Entrada</option><option value="exit">Saída</option><option value="adjustment">Ajuste</option><option value="loss">Perda</option><option value="return">Devolução</option></select></label><label>Quantidade<input required type="number" min="0.001" step="0.001" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: e.target.value })} /></label><label>Motivo<input value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} /></label><button className="admin-primary" type="submit" disabled={!movement.productId}>Registrar movimentação</button></form></article></section><section className="admin-panel admin-wide"><h2>Produtos ({products.length})</h2>{products.length === 0 ? <p className="empty-state">Não existem produtos registrados.</p> : <div className="admin-table">{products.map((product) => <div className="admin-list-row" key={product.id}><div><strong>{product.name}</strong><span>SKU {product.sku} • R$ {product.salePrice.toFixed(2)}</span></div><span>Estoque: {product.currentStock} {product.unit}{product.currentStock <= product.minimumStock ? ' • abaixo do mínimo' : ''}</span></div>)}</div>}</section></main>;
}