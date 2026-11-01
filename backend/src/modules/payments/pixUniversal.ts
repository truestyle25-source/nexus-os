/**
 * PIX universal NEXUS OS — BR Code padrão EMV/BACEN, 100% puro.
 *
 * Funciona para QUALQUER banco e QUALQUER chave porque não usa SDK de
 * banco: gera o payload que o app do cliente escaneia, e o valor cai
 * direto na conta vinculada à chave do lojista, sem gateway e sem taxa
 * de plataforma.
 *
 * Layout (IDs EMV):
 *  00=01 (payload format), 26=merchant account (00=br.gov.bcb.pix + 01=chave),
 *  52=0000 (categoria), 53=986 (moeda BRL), 54=valor, 58=BR,
 *  59=nome (max 25), 60=cidade (max 15), 62=txid (05, max 25), 63=CRC16.
 */

export interface GerarPixPayloadInput {
  chavePix: string;
  nomeRecebedor: string;
  cidadeRecebedor: string;
  valor: number;
  txid: string;
}

export interface PixPayloadGerado {
  payload: string;
  copiaECola: string;
  txid: string;
}

/** Formata um campo EMV: ID (2 dígitos) + tamanho (2 dígitos) + valor. */
export function formataCampo(id: string, valor: string): string {
  if (!/^\d{2}$/.test(id)) throw new Error(`Campo EMV inválido: ${id}`);
  const tamanho = valor.length.toString().padStart(2, '0');
  if (valor.length > 99) throw new Error(`Valor do campo ${id} excede 99 caracteres.`);
  return `${id}${tamanho}${valor}`;
}

/**
 * CRC-16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF).
 * Retorna 4 caracteres hexadecimais em maiúsculas.
 */
export function calculaCRC16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizaNomeCidade(valor: string, max: number, campo: string): string {
  const limpo = semAcento(valor).toUpperCase();
  if (limpo.length === 0) throw new Error(`${campo} é obrigatório.`);
  if (limpo.length > max) throw new Error(`${campo} deve ter no máximo ${max} caracteres.`);
  return limpo;
}

export function normalizaTxid(txid: string): string {
  const limpo = txid.trim();
  if (!/^[A-Za-z0-9]{1,25}$/.test(limpo)) {
    throw new Error('txid deve ter 1 a 25 caracteres alfanuméricos (padrão BACEN).');
  }
  return limpo;
}

export function gerarTxid(prefixo = 'NEXUS'): string {
  const base = `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
  return base.slice(0, 25);
}

export function gerarPixPayloadUniversal(input: GerarPixPayloadInput): PixPayloadGerado {
  const chavePix = input.chavePix.trim();
  if (!chavePix) throw new Error('Chave PIX obrigatória.');
  if (chavePix.length > 77) throw new Error('Chave PIX excede o limite do campo 26.');

  const valorNum = Number(input.valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    throw new Error('Valor do PIX deve ser maior que zero.');
  }
  const valor = valorNum.toFixed(2);

  const nome = normalizaNomeCidade(input.nomeRecebedor, 25, 'Nome do recebedor');
  const cidade = normalizaNomeCidade(input.cidadeRecebedor, 15, 'Cidade');
  const txid = normalizaTxid(input.txid);

  const contaPix =
    formataCampo('00', 'br.gov.bcb.pix') + formataCampo('01', chavePix);

  const semCrc =
    formataCampo('00', '01') +
    formataCampo('26', contaPix) +
    formataCampo('52', '0000') +
    formataCampo('53', '986') +
    formataCampo('54', valor) +
    formataCampo('58', 'BR') +
    formataCampo('59', nome) +
    formataCampo('60', cidade) +
    formataCampo('62', formataCampo('05', txid)) +
    '6304';

  const payload = semCrc + calculaCRC16(semCrc);
  return { payload, copiaECola: payload, txid };
}

