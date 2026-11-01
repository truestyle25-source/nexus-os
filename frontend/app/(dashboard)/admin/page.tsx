'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAdminUser, fetchAdminAudit, fetchAdminUsers, getToken, type AdminUser, type AuditEntry } from '@/lib/api';
import { t as traduzir, tMenu } from '@/lib/i18n';

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '' });

  async function load() {
    try {
      const [loadedUsers, loadedAudit] = await Promise.all([fetchAdminUsers(), fetchAdminAudit()]);
      setUsers(loadedUsers);
      setAudit(loadedAudit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a administração');
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    void load();
  }, [router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await createAdminUser(form);
      setForm((current) => ({ ...current, name: '', email: '', password: '' }));
      setNotice('Usuário criado e auditado com sucesso.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o usuário');
    }
  }

  return (
    <main className="admin-page">
      <header className="admin-header"><div><button className="back-button" type="button" onClick={() => router.push('/')}>← Dashboard</button><h1>Configurações</h1><p>Usuários, papéis e auditoria da empresa autenticada.</p></div></header>
      {error && <p className="admin-message admin-error">{error}</p>}
      {notice && <p className="admin-message admin-success">{notice}</p>}
      <section className="admin-grid">
        <article className="admin-panel"><h2>Novo usuário</h2><form onSubmit={handleCreate} className="admin-form"><label>{traduzir('nome', "Nome")}<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>{traduzir('e_mail', "E-mail")}<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Senha<input required minLength={8} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><p className="empty-state">As permissões são administradas pelo catálogo de permissões do NEXUS OS.</p><button className="admin-primary" type="submit">Criar usuário</button></form></article>
        <article className="admin-panel"><h2>Permissões</h2><p className="empty-state">As permissões são vinculadas diretamente a cada usuário pelo catálogo do NEXUS OS. A tela de edição de permissões pode ser usada quando essa operação estiver disponível para o perfil autenticado.</p></article>
      </section>
      <section className="admin-panel admin-wide"><h2>Usuários ({users.length})</h2>{users.length === 0 ? <p className="empty-state">Nenhum usuário cadastrado.</p> : <div className="admin-table">{users.map((user) => <div className="admin-list-row" key={user.id}><div><strong>{user.name}</strong><span>{user.email}</span></div><span>{user.status}</span></div>)}</div>}</section>
      <section className="admin-panel admin-wide"><h2>Auditoria recente ({audit.length})</h2>{audit.length === 0 ? <p className="empty-state">Nenhuma operação auditada.</p> : <div className="admin-table">{audit.map((entry) => <div className="admin-list-row" key={entry.id}><div><strong>{entry.action} • {entry.entity}</strong><span>{entry.origin}</span></div><span>{new Date(entry.createdAt).toLocaleString('pt-BR')}</span></div>)}</div>}</section>
    </main>
  );
}