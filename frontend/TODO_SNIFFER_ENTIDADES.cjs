// Arquivo: app/(dashboard)/estoque/page.tsx
// Fonte do snapshot: arquivo app/(dashboard)/estoque/page.tsx

import Search from 'lucide-react';
import {
    tb } from 'lucide-react';
import {
    Package,
    Search
} from 'lucide-react';

// seletores de filtro - com Marca incluso
<div className="flex flex-wrap items-center gap-3 mb-4">
    <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500"/>
        <input type="text"
                placeholder="Buscar por nome, SKU, EAN ou Marca..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="w-full h-9 rounded-full bg-[#121221] border border-white/[0.06] px-4 text-[13px] pl-9 focus:outline-none"/>
    </div>
    <select value={filtroFilial} onChange={(e) => setFiltroFilial(e.target.value)}
            className="h-9 rounded-full bg-[#121221] border border-white/[0.06] px-3 text-[12px] text-zinc-300">
        <option>Todas as filiais</option>
        {filiais.map((f: any) => <option key={f.id} value={f.nome}>{f.nome}</option>)}
    </select>
    <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}
            className="h-9 rounded-full bg-[#121221] border border-white/[0.06] px-3 text-[12px] text-zinc-300">
        <option value="Categoria">Categoria</option>
        {categorias.map((c: any) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
        <option>Alimentos</option>
        <option>Mercearia</option>
        <option>Laticinios</option>
        <option>Limpeza</option>
        <option>Bebidas</option>
    </select>
    <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
            className="h-9 rounded-full bg-[#121221] border border-white/[0.06] px-3 text-[12px] text-zinc-300">
        <option>Todos</option>
        <option>OK</option>
        <option>BAIXO</option>
        <option>RUPTURA</option>
        <option>VENCIDO</option>
        <option>PARADO</option>
    </select>
    <div className="ml-auto flex items-center gap-2 text-[11px] mono text-zinc-500">
        <Package className="w-3 h-3" />
        {produtosFiltrados.length} SKUs
    </div>
</div>
