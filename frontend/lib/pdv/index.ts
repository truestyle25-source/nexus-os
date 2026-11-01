// FASE 3 PDV PRO — superfície pública da camada de persistência local.
export * from './tipos';
export { db, setDb, PdvDatabase, limparDadosLocaisSeguro } from './db';
export type { MetaLocal } from './db';
export * from './idempotency';
export * from './catalogo';
export * from './syncQueue';
export * from './offline';
export * from './politicaOffline';
export * from './cartSession';
export * from './contextoLocal';
export * from './sincronizarCatalogo';
export * from './enviarOperacao';
export * from './cupom';
