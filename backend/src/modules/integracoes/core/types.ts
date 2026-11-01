/** Contratos pequenos do Integration Core. Cada capacidade é opcional. */
export type ProviderId = 'shopee';
export type ProviderCapability = 'request-signing' | 'shop-authorization' | 'credential-refresh' | 'connection-test' | 'local-disconnect' | 'order-read' | 'product-read' | 'automatic-order-status-sync';

export type IntegrationStatus =
  | 'NAO_CONFIGURADO'
  | 'AGUARDANDO_AUTORIZACAO'
  | 'CONECTADO'
  | 'EXPIRADO'
  | 'REAUTORIZAR'
  | 'REVOGADO'
  | 'DESCONECTADO'
  | 'ERRO';

export type IntegrationErrorCode =
  | 'CONFIGURACAO_AUSENTE'
  | 'CREDENCIAL_INVALIDA'
  | 'AUTORIZACAO_EXPIRADA'
  | 'LIMITE_API'
  | 'FALHA_TRANSITORIA'
  | 'TIMEOUT'
  | 'OPERACAO_NAO_SUPORTADA'
  | 'VALIDACAO'
  | 'PERSISTENCIA'
  | 'ERRO_EXTERNO';

export interface IntegrationError {
  code: IntegrationErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

export interface IntegrationContext {
  empresaId: string;
  connectionId?: string;
  externalShopId?: string;
  usuarioId?: string;
  filialId?: string;
}

export interface ConnectionSnapshot {
  provider: ProviderId;
  status: IntegrationStatus;
  displayName: string | null;
  connectedAt: Date | null;
  lastSyncAt: Date | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  checkedAt: Date;
  error?: IntegrationError;
}

export interface ProviderDefinition {
  id: ProviderId;
  displayName: string;
  /** Somente capacidades realmente fornecidas pelo adaptador registrado. */
  capabilities: readonly ProviderCapability[];
}

export interface ShopAuthorizationCapability {
  beginAuthorization(context: IntegrationContext): Promise<{ authorizationUrl: string; expiresAt: Date }>;
}

export interface ConnectionTestCapability {
  testConnection(context: IntegrationContext): Promise<ConnectionTestResult>;
}

export interface LocalDisconnectCapability {
  disconnectLocally(context: IntegrationContext): Promise<{ status: 'DESCONECTADO' }>;
}

export interface OrderImportCapability {
  listOrders(context: IntegrationContext, window: { from: number; to: number; cursor?: string }): Promise<{ orders: readonly unknown[]; nextCursor: string | null }>;
  importOrder(context: IntegrationContext, externalOrderId: string): Promise<{ imported: boolean; externalOrderId: string }>;
}

export interface ProductCatalogCapability {
  listProducts(context: IntegrationContext, page: { cursor?: string }): Promise<{ products: readonly unknown[]; nextCursor: string | null }>;
}

export interface StockUpdateCapability {
  updateMappedStock(context: IntegrationContext, mappingId: string, quantity: number): Promise<{ accepted: boolean }>;
}

