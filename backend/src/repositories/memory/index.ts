import { randomUUID } from 'node:crypto';
import type { AuditEntry, Company, InventoryMovement, Product, Role, Session, User } from '../../domain/types.js';
import type { AuditRepository, CompanyRepository, ProductRepository, RoleRepository, SessionRepository, UserRepository } from '../interfaces.js';
import { verifyRefreshToken } from '../../auth/hash.js';

export class InMemoryCompanyRepository implements CompanyRepository {
  private companies = new Map<string, Company>();

  async create(data: Omit<Company, 'id' | 'createdAt'>): Promise<Company> {
    const company: Company = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    this.companies.set(company.id, company);
    return company;
  }

  async findByCnpj(cnpj: string): Promise<Company | null> {
    for (const c of this.companies.values()) if (c.cnpj === cnpj) return c;
    return null;
  }

  async findById(id: string): Promise<Company | null> {
    return this.companies.get(id) ?? null;
  }
}

export class InMemoryRoleRepository implements RoleRepository {
  private roles = new Map<string, Role>();

  async create(data: Omit<Role, 'id'>): Promise<Role> {
    const role: Role = { ...data, id: randomUUID() };
    this.roles.set(role.id, role);
    return role;
  }

  async findById(id: string): Promise<Role | null> {
    return this.roles.get(id) ?? null;
  }

  async findByCompanyAndName(companyId: string, name: string): Promise<Role | null> {
    for (const r of this.roles.values()) {
      if (r.companyId === companyId && r.name === name) return r;
    }
    return null;
  }

  async listByCompany(companyId: string): Promise<Role[]> {
    return [...this.roles.values()].filter((role) => role.companyId === companyId);
  }
}

export class InMemoryUserRepository implements UserRepository {
  private users = new Map<string, User>();

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    return user;
  }

  async findByEmail(companyId: string, email: string): Promise<User | null> {
    const normalized = email.toLowerCase();
    for (const u of this.users.values()) {
      if (u.companyId === companyId && u.email === normalized) return u;
    }
    return null;
  }

  async findByEmailAcrossCompanies(email: string): Promise<User[]> {
    const normalized = email.toLowerCase();
    return [...this.users.values()].filter((u) => u.email === normalized);
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async listByCompany(companyId: string): Promise<User[]> {
    return [...this.users.values()].filter((user) => user.companyId === companyId);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();

  async create(data: Omit<Session, 'id' | 'createdAt'>): Promise<Session> {
    const session: Session = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    this.sessions.set(session.id, session);
    return session;
  }

  async findById(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<Session[]> {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  async findActiveByUserId(userId: string): Promise<Session[]> {
    const now = new Date();
    return [...this.sessions.values()].filter((session) => session.userId === userId && session.revokedAt === null && new Date(session.expiresAt) > now);
  }

  async findByUserAndRefreshToken(userId: string, refreshToken: string): Promise<Session | null> {
    const sessions = await this.findByUserId(userId);
    for (const session of sessions) {
      if (session.revokedAt !== null) continue;
      if (verifyRefreshToken(refreshToken, session.refreshHash)) {
        return session;
      }
    }
    return null;
  }

  async revokeById(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.set(id, { ...session, revokedAt: new Date().toISOString() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const sessions = await this.findByUserId(userId);
    for (const session of sessions) {
      this.sessions.set(session.id, { ...session, revokedAt: new Date().toISOString() });
    }
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  private entries: AuditEntry[] = [];

  async record(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    this.entries.push({ ...entry, id: randomUUID(), createdAt: new Date().toISOString() });
  }

  async listByCompany(companyId: string, limit = 50): Promise<AuditEntry[]> {
    return this.entries
      .filter((e) => e.companyId === companyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

export class InMemoryProductRepository implements ProductRepository {
  private products = new Map<string, Product>();
  private movements = new Map<string, InventoryMovement>();

  async create(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    if ([...this.products.values()].some((product) => product.companyId === data.companyId && product.sku === data.sku)) {
      throw new Error('SKU já cadastrado para esta empresa');
    }
    const now = new Date().toISOString();
    const product: Product = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    this.products.set(product.id, product);
    return product;
  }

  async findById(companyId: string, id: string): Promise<Product | null> {
    const product = this.products.get(id);
    return product?.companyId === companyId ? product : null;
  }

  async listByCompany(companyId: string): Promise<Product[]> {
    return [...this.products.values()].filter((product) => product.companyId === companyId);
  }

  async recordMovement(data: Omit<InventoryMovement, 'id' | 'createdAt'>): Promise<InventoryMovement> {
    const product = await this.findById(data.companyId, data.productId);
    if (!product) throw new Error('Produto não encontrado');
    const nextStock = product.currentStock + data.quantity;
    if (nextStock < 0) throw new Error('Estoque insuficiente');
    this.products.set(product.id, { ...product, currentStock: nextStock, updatedAt: new Date().toISOString() });
    const movement: InventoryMovement = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    this.movements.set(movement.id, movement);
    return movement;
  }
}
