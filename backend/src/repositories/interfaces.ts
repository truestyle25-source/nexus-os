import type { AuditEntry, Company, Role, Session, User } from '../domain/types.js';

export interface CompanyRepository {
  create(data: Omit<Company, 'id' | 'createdAt'>, client?: unknown): Promise<Company>;
  findByCnpj(cnpj: string, client?: unknown): Promise<Company | null>;
  findById(id: string, client?: unknown): Promise<Company | null>;
}

export interface RoleRepository {
  create(data: Omit<Role, 'id'>, client?: unknown): Promise<Role>;
  findById(id: string, client?: unknown): Promise<Role | null>;
  findByCompanyAndName(companyId: string, name: string, client?: unknown): Promise<Role | null>;
  listByCompany(companyId: string, client?: unknown): Promise<Role[]>;
}

export interface UserRepository {
  create(data: Omit<User, 'id' | 'createdAt'>, client?: unknown): Promise<User>;
  findByEmail(companyId: string, email: string, client?: unknown): Promise<User | null>;
  findByEmailAcrossCompanies(email: string, client?: unknown): Promise<User[]>;
  findById(id: string, client?: unknown): Promise<User | null>;
  listByCompany(companyId: string, client?: unknown): Promise<User[]>;
}

export interface SessionRepository {
  create(data: Omit<Session, 'id' | 'createdAt'>, client?: unknown): Promise<Session>;
  findById(id: string, client?: unknown): Promise<Session | null>;
  findByUserId(userId: string, client?: unknown): Promise<Session[]>;
  findActiveByUserId(userId: string, client?: unknown): Promise<Session[]>;
  findByUserAndRefreshToken(userId: string, refreshToken: string, client?: unknown): Promise<Session | null>;
  revokeById(id: string, client?: unknown): Promise<void>;
  revokeAllForUser(userId: string, client?: unknown): Promise<void>;
}

export interface AuditRepository {
  record(entry: Omit<AuditEntry, 'id' | 'createdAt'>, client?: unknown): Promise<void>;
  listByCompany(companyId: string, limit?: number): Promise<AuditEntry[]>;
}
