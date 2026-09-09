import type { Pool, PoolClient } from 'pg';
import type { AuditEntry, Company, InventoryMovement, ModuleName, PermissionAction, Product, Role, Session, User } from '../../domain/types.js';
import type { AuditRepository, CompanyRepository, ProductRepository, RoleRepository, SessionRepository, UserRepository } from '../interfaces.js';
import { verifyRefreshToken } from '../../auth/hash.js';

// NOTA: este arquivo depende do pacote 'pg' (node-postgres).
// Não foi executado no ambiente de desenvolvimento desta conversa
// porque esse ambiente não tem acesso à internet para `npm install`.
// A lógica de negócio (hash, JWT, permissões) já foi validada de
// forma isolada nos testes — aqui é só a camada de persistência,
// que segue exatamente o schema em /database/schema.sql.

export class PostgresCompanyRepository implements CompanyRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: Omit<Company, 'id' | 'createdAt'>, client?: PoolClient | Pool): Promise<Company> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO companies (name, cnpj, status, trial_ends_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, cnpj, status, trial_ends_at AS "trialEndsAt", created_at AS "createdAt"`,
      [data.name, data.cnpj, data.status, data.trialEndsAt]
    );
    return rows[0];
  }

  async findByCnpj(cnpj: string, client?: PoolClient | Pool): Promise<Company | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, name, cnpj, status, trial_ends_at AS "trialEndsAt", created_at AS "createdAt"
       FROM companies WHERE cnpj = $1`,
      [cnpj]
    );
    return rows[0] ?? null;
  }

  async findById(id: string, client?: PoolClient | Pool): Promise<Company | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, name, cnpj, status, trial_ends_at AS "trialEndsAt", created_at AS "createdAt"
       FROM companies WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }
}

export class PostgresRoleRepository implements RoleRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: Omit<Role, 'id'>, client?: PoolClient | Pool): Promise<Role> {
    const db = client ?? this.pool;
    if (!client) {
      const txClient = await this.pool.connect();
      try {
        await txClient.query('BEGIN');
        const { rows } = await txClient.query(
          `INSERT INTO roles (company_id, name, is_system) VALUES ($1, $2, $3) RETURNING id`,
          [data.companyId, data.name, data.isSystem]
        );
        const roleId = rows[0].id;

        for (const perm of data.permissions) {
          const [moduleName, action] = perm.split(':');
          await txClient.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT $1, id FROM permissions WHERE module = $2 AND action = $3
             ON CONFLICT DO NOTHING`,
            [roleId, moduleName, action]
          );
        }
        await txClient.query('COMMIT');
        return { ...data, id: roleId };
      } catch (err) {
        await txClient.query('ROLLBACK');
        throw err;
      } finally {
        txClient.release();
      }
    }

    const { rows } = await db.query(
      `INSERT INTO roles (company_id, name, is_system) VALUES ($1, $2, $3) RETURNING id`,
      [data.companyId, data.name, data.isSystem]
    );
    const roleId = rows[0].id;
    for (const perm of data.permissions) {
      const [moduleName, action] = perm.split(':');
      await db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, id FROM permissions WHERE module = $2 AND action = $3
         ON CONFLICT DO NOTHING`,
        [roleId, moduleName, action]
      );
    }
    return { ...data, id: roleId };
  }

  async findById(id: string, client?: PoolClient | Pool): Promise<Role | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT r.id, r.company_id AS "companyId", r.name, r.is_system AS "isSystem",
              p.module, p.action
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE r.id = $1`,
      [id]
    );
    if (rows.length === 0) return null;
    const permissions = new Set(
      rows.filter((r) => r.module && r.action).map((r) => `${r.module}:${r.action}` as `${ModuleName}:${PermissionAction}`)
    );
    return { id: rows[0].id, companyId: rows[0].companyId, name: rows[0].name, isSystem: rows[0].isSystem, permissions } as Role;
  }

  async findByCompanyAndName(companyId: string, name: string, client?: PoolClient | Pool): Promise<Role | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(`SELECT id FROM roles WHERE company_id = $1 AND name = $2`, [companyId, name]);
    if (rows.length === 0) return null;
    return this.findById(rows[0].id, db);
  }

  async listByCompany(companyId: string, client?: PoolClient | Pool): Promise<Role[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(`SELECT id FROM roles WHERE company_id = $1 ORDER BY name`, [companyId]);
    const roles = await Promise.all(rows.map((row) => this.findById(row.id, db)));
    return roles.filter((role): role is Role => role !== null);
  }
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: Omit<User, 'id' | 'createdAt'>, client?: PoolClient | Pool): Promise<User> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO users (company_id, sector_id, role_id, name, email, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, company_id AS "companyId", sector_id AS "sectorId", role_id AS "roleId",
                 name, email, password_hash AS "passwordHash", status, created_at AS "createdAt"`,
      [data.companyId, data.sectorId, data.roleId, data.name, data.email.toLowerCase(), data.passwordHash, data.status]
    );
    return rows[0];
  }

  async findByEmail(companyId: string, email: string, client?: PoolClient | Pool): Promise<User | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", sector_id AS "sectorId", role_id AS "roleId",
              name, email, password_hash AS "passwordHash", status, created_at AS "createdAt"
       FROM users WHERE company_id = $1 AND email = $2`,
      [companyId, email.toLowerCase()]
    );
    return rows[0] ?? null;
  }

  async findByEmailAcrossCompanies(email: string, client?: PoolClient | Pool): Promise<User[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", sector_id AS "sectorId", role_id AS "roleId",
              name, email, password_hash AS "passwordHash", status, created_at AS "createdAt"
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    return rows;
  }

  async findById(id: string, client?: PoolClient | Pool): Promise<User | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", sector_id AS "sectorId", role_id AS "roleId",
              name, email, password_hash AS "passwordHash", status, created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listByCompany(companyId: string, client?: PoolClient | Pool): Promise<User[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", sector_id AS "sectorId", role_id AS "roleId",
              name, email, password_hash AS "passwordHash", status, created_at AS "createdAt"
       FROM users WHERE company_id = $1 ORDER BY name`,
      [companyId]
    );
    return rows;
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: Omit<Session, 'id' | 'createdAt'>, client?: PoolClient | Pool): Promise<Session> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO sessions (user_id, refresh_hash, user_agent, ip, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id AS "userId", refresh_hash AS "refreshHash", user_agent AS "userAgent", ip, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"`,
      [data.userId, data.refreshHash, data.userAgent, data.ip, data.expiresAt, data.revokedAt]
    );
    return rows[0];
  }

  async findById(id: string, client?: PoolClient | Pool): Promise<Session | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, user_id AS "userId", refresh_hash AS "refreshHash", user_agent AS "userAgent", ip, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM sessions WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  }

  async findByUserId(userId: string, client?: PoolClient | Pool): Promise<Session[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, user_id AS "userId", refresh_hash AS "refreshHash", user_agent AS "userAgent", ip, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM sessions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async findActiveByUserId(userId: string, client?: PoolClient | Pool): Promise<Session[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, user_id AS "userId", refresh_hash AS "refreshHash", user_agent AS "userAgent", ip, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async findByUserAndRefreshToken(userId: string, refreshToken: string, client?: PoolClient | Pool): Promise<Session | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, user_id AS "userId", refresh_hash AS "refreshHash", user_agent AS "userAgent", ip, expires_at AS "expiresAt", revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`,
      [userId]
    );
    for (const session of rows) {
      if (verifyRefreshToken(refreshToken, session.refreshHash)) {
        return session;
      }
    }
    return null;
  }

  async revokeById(id: string, client?: PoolClient | Pool): Promise<void> {
    const db = client ?? this.pool;
    await db.query(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  }

  async revokeAllForUser(userId: string, client?: PoolClient | Pool): Promise<void> {
    const db = client ?? this.pool;
    await db.query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(entry: Omit<AuditEntry, 'id' | 'createdAt'>, client?: PoolClient | Pool): Promise<void> {
    const db = client ?? this.pool;
    await db.query(
      `INSERT INTO audit_log (company_id, user_id, action, entity, entity_id, old_value, new_value, origin, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [entry.companyId, entry.userId, entry.action, entry.entity, entry.entityId, entry.oldValue, entry.newValue, entry.origin, entry.ip]
    );
  }

  async listByCompany(companyId: string, limit = 50): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT id, company_id AS "companyId", user_id AS "userId", action, entity, entity_id AS "entityId",
              old_value AS "oldValue", new_value AS "newValue", origin, ip, created_at AS "createdAt"
       FROM audit_log WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [companyId, limit]
    );
    return rows;
  }
}

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly pool: Pool) {}

  async create(data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>, client?: PoolClient | Pool): Promise<Product> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `INSERT INTO products (company_id, name, sku, barcode, cost, sale_price, unit, current_stock, minimum_stock, maximum_stock, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, company_id AS "companyId", name, sku, barcode,
       cost::float8 AS cost, sale_price::float8 AS "salePrice", unit, current_stock::float8 AS "currentStock",
       minimum_stock::float8 AS "minimumStock", maximum_stock::float8 AS "maximumStock", status,
       created_at AS "createdAt", updated_at AS "updatedAt"`,
      [data.companyId, data.name, data.sku, data.barcode, data.cost, data.salePrice, data.unit, data.currentStock, data.minimumStock, data.maximumStock, data.status]
    );
    return rows[0];
  }

  async findById(companyId: string, id: string, client?: PoolClient | Pool): Promise<Product | null> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", name, sku, barcode, cost::float8 AS cost, sale_price::float8 AS "salePrice",
       unit, current_stock::float8 AS "currentStock", minimum_stock::float8 AS "minimumStock", maximum_stock::float8 AS "maximumStock",
       status, created_at AS "createdAt", updated_at AS "updatedAt" FROM products WHERE company_id = $1 AND id = $2`,
      [companyId, id]
    );
    return rows[0] ?? null;
  }

  async listByCompany(companyId: string, client?: PoolClient | Pool): Promise<Product[]> {
    const db = client ?? this.pool;
    const { rows } = await db.query(
      `SELECT id, company_id AS "companyId", name, sku, barcode, cost::float8 AS cost, sale_price::float8 AS "salePrice",
       unit, current_stock::float8 AS "currentStock", minimum_stock::float8 AS "minimumStock", maximum_stock::float8 AS "maximumStock",
       status, created_at AS "createdAt", updated_at AS "updatedAt" FROM products WHERE company_id = $1 ORDER BY name`,
      [companyId]
    );
    return rows;
  }

  async recordMovement(data: Omit<InventoryMovement, 'id' | 'createdAt'>, client?: PoolClient | Pool): Promise<InventoryMovement> {
    const db = client ?? this.pool;
    const ownsTransaction = !client;
    const txClient = ownsTransaction ? await this.pool.connect() : db as PoolClient;
    try {
      if (ownsTransaction) await txClient.query('BEGIN');
      const updated = await txClient.query(
        `UPDATE products SET current_stock = current_stock + $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3 AND current_stock + $1 >= 0 RETURNING id`,
        [data.quantity, data.productId, data.companyId]
      );
      if (updated.rowCount !== 1) throw new Error('Produto não encontrado ou estoque insuficiente');
      const { rows } = await txClient.query(
        `INSERT INTO inventory_movements (company_id, product_id, user_id, quantity, type, reason, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, company_id AS "companyId", product_id AS "productId", user_id AS "userId", quantity::float8 AS quantity, type, reason, origin, created_at AS "createdAt"`,
        [data.companyId, data.productId, data.userId, data.quantity, data.type, data.reason, data.origin]
      );
      if (ownsTransaction) await txClient.query('COMMIT');
      return rows[0];
    } catch (error) {
      if (ownsTransaction) await txClient.query('ROLLBACK');
      throw error;
    } finally {
      if (ownsTransaction) txClient.release();
    }
  }
}
