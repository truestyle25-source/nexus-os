import { randomUUID } from 'node:crypto';
import type { CompanyRepository, RoleRepository, UserRepository, AuditRepository, SessionRepository } from '../repositories/interfaces.js';
import { hashPassword, hashRefreshToken, verifyPassword, verifyRefreshToken } from '../auth/hash.js';
import { signJwt, verifyJwt } from '../auth/jwt.js';
import { isValidCnpj, normalizeCnpj } from '../domain/cnpj.js';
import { buildDefaultRolePermissions } from '../domain/permissions.js';
import type { Company, Role, User } from '../domain/types.js';

const TRIAL_DAYS = 7;
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;        // 15 minutos
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 7 dias

export class AuthError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface RegisterCompanyInput {
  companyName: string;
  cnpj: string;
  responsibleName: string;
  email: string;
  password: string;
  confirmPassword: string;
  ip?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
  companyCnpj?: string; // opcional: se o e-mail existir em mais de uma empresa
  ip?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; roleId: string; companyId: string };
  company: { id: string; name: string; cnpj: string; status: Company['status']; trialEndsAt: string };
}

export class AuthService {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditRepository,
    private readonly jwtSecret: string,
    private readonly pool?: unknown,
    private readonly sessions?: SessionRepository
  ) {}

  async registerCompany(input: RegisterCompanyInput): Promise<AuthTokens> {
    if (typeof input.companyName !== 'string' || input.companyName.trim().length < 2) {
      throw new AuthError('Nome da empresa inválido', 'INVALID_COMPANY_NAME');
    }
    if (typeof input.responsibleName !== 'string' || input.responsibleName.trim().length < 2) {
      throw new AuthError('Nome do responsável inválido', 'INVALID_RESPONSIBLE_NAME');
    }
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new AuthError('E-mail inválido', 'INVALID_EMAIL');
    }
    if (typeof input.password !== 'string' || input.password.length < 8) {
      throw new AuthError('Senha deve ter no mínimo 8 caracteres', 'INVALID_PASSWORD');
    }
    if (input.password !== input.confirmPassword) {
      throw new AuthError('As senhas não coincidem', 'PASSWORD_MISMATCH');
    }
    if (!isValidCnpj(input.cnpj)) {
      throw new AuthError('CNPJ inválido', 'INVALID_CNPJ');
    }
    const companyName = input.companyName.trim();
    const responsibleName = input.responsibleName.trim();
    const email = input.email.trim().toLowerCase();
    const cnpj = normalizeCnpj(input.cnpj);

    const existingCompany = await this.companies.findByCnpj(cnpj);
    if (existingCompany) {
      throw new AuthError('Já existe uma empresa cadastrada com este CNPJ', 'CNPJ_ALREADY_EXISTS');
    }

    const existingUsers = await this.users.findByEmailAcrossCompanies(email);
    if (existingUsers.length > 0) {
      throw new AuthError('Este e-mail já está em uso', 'EMAIL_ALREADY_EXISTS');
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000).toISOString();
    const defaultPermissions = buildDefaultRolePermissions();
    const createdRoles: Record<string, Role> = {};

    if (this.pool && typeof this.pool === 'object' && 'connect' in this.pool) {
      const client = await (this.pool as any).connect();
      try {
        await client.query('BEGIN');
        const company = await this.companies.create({ name: companyName, cnpj, status: 'trial', trialEndsAt }, client);
        for (const [roleName, perms] of Object.entries(defaultPermissions)) {
          createdRoles[roleName] = await this.roles.create({ companyId: company.id, name: roleName, isSystem: true, permissions: new Set(perms) }, client);
        }
        const adminUser = await this.users.create({ companyId: company.id, sectorId: null, roleId: createdRoles.admin.id, name: responsibleName, email, passwordHash: hashPassword(input.password), status: 'active' }, client);
        await this.audit.record({ companyId: company.id, userId: adminUser.id, action: 'create', entity: 'companies', entityId: company.id, oldValue: null, newValue: { name: company.name, cnpj: company.cnpj }, origin: 'manual', ip: input.ip ?? null }, client);
        await client.query('COMMIT');
        return this.issueTokens(adminUser, company);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const company = await this.companies.create({ name: companyName, cnpj, status: 'trial', trialEndsAt });
    for (const [roleName, perms] of Object.entries(defaultPermissions)) {
      createdRoles[roleName] = await this.roles.create({ companyId: company.id, name: roleName, isSystem: true, permissions: new Set(perms) });
    }

    const adminUser = await this.users.create({ companyId: company.id, sectorId: null, roleId: createdRoles.admin.id, name: responsibleName, email, passwordHash: hashPassword(input.password), status: 'active' });
    await this.audit.record({ companyId: company.id, userId: adminUser.id, action: 'create', entity: 'companies', entityId: company.id, oldValue: null, newValue: { name: company.name, cnpj: company.cnpj }, origin: 'manual', ip: input.ip ?? null });

    return this.issueTokens(adminUser, company);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    if (typeof input.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new AuthError('E-mail ou senha inválidos', 'INVALID_CREDENTIALS');
    }
    if (typeof input.password !== 'string' || input.password.trim().length === 0) {
      throw new AuthError('E-mail ou senha inválidos', 'INVALID_CREDENTIALS');
    }

    const email = input.email.trim().toLowerCase();
    const candidates = await this.users.findByEmailAcrossCompanies(email);

    let user: User | null = null;
    let company: Company | null = null;

    if (candidates.length === 0) {
      throw new AuthError('E-mail ou senha inválidos', 'INVALID_CREDENTIALS');
    }

    if (candidates.length === 1) {
      user = candidates[0];
      company = await this.companies.findById(user.companyId);
    } else {
      if (!input.companyCnpj) {
        throw new AuthError('E-mail vinculado a múltiplas empresas — informe o CNPJ', 'MULTIPLE_COMPANIES');
      }
      const cnpj = normalizeCnpj(input.companyCnpj);
      for (const candidate of candidates) {
        const c = await this.companies.findById(candidate.companyId);
        if (c?.cnpj === cnpj) {
          user = candidate;
          company = c;
          break;
        }
      }
    }

    if (!user || !company) {
      throw new AuthError('E-mail ou senha inválidos', 'INVALID_CREDENTIALS');
    }

    const passwordOk = verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      await this.audit.record({
        companyId: company.id,
        userId: user.id,
        action: 'login_failed',
        entity: 'users',
        entityId: user.id,
        oldValue: null,
        newValue: null,
        origin: 'manual',
        ip: input.ip ?? null,
      });
      throw new AuthError('E-mail ou senha inválidos', 'INVALID_CREDENTIALS');
    }

    if (user.status !== 'active') {
      throw new AuthError('Usuário inativo — contate o administrador', 'USER_INACTIVE');
    }

    await this.audit.record({
      companyId: company.id,
      userId: user.id,
      action: 'login',
      entity: 'users',
      entityId: user.id,
      oldValue: null,
      newValue: null,
      origin: 'manual',
      ip: input.ip ?? null,
    });

    return this.issueTokens(user, company);
  }

  async refreshToken(refreshToken: string, meta?: { ip?: string | null; userAgent?: string | null }): Promise<AuthTokens> {
    if (!this.sessions) {
      throw new AuthError('Sessão não disponível', 'SESSION_NOT_AVAILABLE');
    }

    const normalizedToken = typeof refreshToken === 'string' ? refreshToken.trim() : '';
    if (!normalizedToken) {
      throw new AuthError('Refresh token inválido', 'INVALID_REFRESH_TOKEN');
    }

    let payload;
    try {
      payload = verifyJwt(normalizedToken, this.jwtSecret, 'refresh');
    } catch {
      throw new AuthError('Refresh token inválido', 'INVALID_REFRESH_TOKEN');
    }

    const activeSessions = await this.sessions.findActiveByUserId(payload.sub);
    let matchedSession = null;
    for (const session of activeSessions) {
      if (verifyRefreshToken(normalizedToken, session.refreshHash)) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) {
      throw new AuthError('Refresh token inválido ou revogado', 'INVALID_REFRESH_TOKEN');
    }

    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new AuthError('Usuário inválido para refresh', 'INVALID_REFRESH_TOKEN');
    }

    const company = await this.companies.findById(payload.companyId);
    if (!company) {
      throw new AuthError('Empresa inválida para refresh', 'INVALID_REFRESH_TOKEN');
    }

    if (user.companyId !== company.id || user.roleId !== payload.roleId) {
      throw new AuthError('Sessão inconsistente', 'INVALID_REFRESH_TOKEN');
    }

    await this.sessions.revokeById(matchedSession.id);
    const rotated = await this.createSession(user, company, meta);
    return rotated;
  }

  async logout(refreshToken: string): Promise<void> {
    if (!this.sessions) return;

    const normalizedToken = typeof refreshToken === 'string' ? refreshToken.trim() : '';
    if (!normalizedToken) return;

    try {
      const payload = verifyJwt(normalizedToken, this.jwtSecret, 'refresh');
      const sessions = await this.sessions.findByUserId(payload.sub);
      for (const session of sessions) {
        if (verifyRefreshToken(normalizedToken, session.refreshHash)) {
          await this.sessions.revokeById(session.id);
          return;
        }
      }
    } catch {
      // ignora tokens inválidos para logout sem vazar detalhes
    }
  }

  private async createSession(user: User, company: Company, meta?: { ip?: string | null; userAgent?: string | null }): Promise<AuthTokens> {
    const accessToken = signJwt(
      { sub: user.id, companyId: company.id, roleId: user.roleId, type: 'access', jti: randomUUID() },
      this.jwtSecret,
      ACCESS_TOKEN_TTL_SECONDS
    );
    const refreshToken = signJwt(
      { sub: user.id, companyId: company.id, roleId: user.roleId, type: 'refresh', jti: randomUUID() },
      this.jwtSecret,
      REFRESH_TOKEN_TTL_SECONDS
    );

    if (this.sessions) {
      const refreshHash = hashRefreshToken(refreshToken);
      await this.sessions.create({
        userId: user.id,
        refreshHash,
        userAgent: meta?.userAgent ?? null,
        ip: meta?.ip ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
        revokedAt: null,
      });
    }

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, roleId: user.roleId, companyId: company.id },
      company: { id: company.id, name: company.name, cnpj: company.cnpj, status: company.status, trialEndsAt: company.trialEndsAt },
    };
  }

  private async issueTokens(user: User, company: Company): Promise<AuthTokens> {
    return this.createSession(user, company);
  }
}
