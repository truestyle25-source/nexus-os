// Setup de IndexedDB fake para os testes da FASE 3 (Dexie roda em cima dela).
import 'fake-indexeddb/auto';
import { IDBKeyRange } from 'fake-indexeddb';
import { PdvDatabase, setDb } from '../lib/pdv/db';

// Alguns engines esperam o KeyRange no escopo global.
(globalThis as any).IDBKeyRange = IDBKeyRange;

/** Cria um banco isolado por teste e devolve o handle. */
export async function novoBanco(nome: string): Promise<PdvDatabase> {
  setDb(null);
  const banco = new PdvDatabase(nome);
  await banco.open();
  setDb(banco);
  return banco;
}

/** Fecha e destrói o banco, isolando os testes entre si. */
export async function destruirBanco(banco: PdvDatabase): Promise<void> {
  await banco.delete();
  setDb(null);
}
