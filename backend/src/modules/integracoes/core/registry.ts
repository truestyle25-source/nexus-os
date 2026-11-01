import type { ProviderDefinition, ProviderId } from './types.js';

/** Registro estático: não carrega módulos dinamicamente nem sugere conexão ativa. */
const PROVIDERS: Readonly<Record<ProviderId, ProviderDefinition>> = {
  shopee: {
    id: 'shopee',
    displayName: 'Shopee',
    capabilities: ['request-signing', 'shop-authorization', 'credential-refresh', 'connection-test', 'local-disconnect', 'order-read', 'product-read', 'automatic-order-status-sync'],
  },
};

export function getProvider(id: ProviderId): ProviderDefinition {
  return PROVIDERS[id];
}

export function listProviders(): readonly ProviderDefinition[] {
  return Object.values(PROVIDERS);
}

export function requireProviderCapability(id: ProviderId, capability: ProviderDefinition['capabilities'][number]): void {
  if (!PROVIDERS[id].capabilities.includes(capability)) {
    throw new Error(`A capacidade ${capability} não está implementada para ${id}.`);
  }
}

