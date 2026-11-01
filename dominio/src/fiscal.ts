/**
 * Fiscal: estados de um documento fiscal e validação de dados antes da transmissão.
 *
 * ESTE MÓDULO NÃO EMITE NOTA. Ele não gera XML, não assina e não fala com o órgão fiscal.
 * Os estados "transmitida", "autorizada", "rejeitada" e "cancelada" só podem ser
 * informados por um provedor fiscal real, com protocolo. O usuário nunca os define.
 */

import { cnpjValido } from "./documentos.js";

export type EstadoNota = "rascunho" | "pronta" | "transmitida" | "autorizada" | "rejeitada" | "cancelada";

export type Nota = {
  id: string;
  numero: number;
  serie: number;
  emitenteCnpj: string;
  destinatarioDocumento: string;
  valorTotalCentavos: number;
  itens: Array<{ descricao: string; quantidade: number; valorUnitarioCentavos: number }>;
  estado: EstadoNota;
  protocolo?: string;
};

const ESTADOS_DO_PROVEDOR: EstadoNota[] = ["transmitida", "autorizada", "rejeitada", "cancelada"];

const TRANSICOES_DO_USUARIO: Partial<Record<EstadoNota, EstadoNota[]>> = {
  rascunho: ["pronta"],
  pronta: ["rascunho"],
};

export function validarParaTransmissao(n: Nota): string[] {
  const erros: string[] = [];
  if (!cnpjValido(n.emitenteCnpj)) erros.push("CNPJ do emitente inválido (formato ou dígitos verificadores).");
  if (!n.destinatarioDocumento.trim()) erros.push("Destinatário não informado.");
  if (!Number.isInteger(n.numero) || n.numero <= 0) erros.push("Número da nota inválido.");
  if (!Number.isInteger(n.serie) || n.serie < 0) erros.push("Série inválida.");
  if (n.itens.length === 0) erros.push("Nota sem itens.");
  let soma = 0;
  for (const i of n.itens) {
    if (!Number.isInteger(i.quantidade) || i.quantidade <= 0) erros.push(`Quantidade inválida em "${i.descricao}".`);
    if (!Number.isInteger(i.valorUnitarioCentavos) || i.valorUnitarioCentavos < 0) {
      erros.push(`Valor unitário inválido em "${i.descricao}".`);
    }
    soma += i.quantidade * i.valorUnitarioCentavos;
  }
  if (soma !== n.valorTotalCentavos) erros.push(`Total ${n.valorTotalCentavos} difere da soma dos itens ${soma}.`);
  return erros;
}

/**
 * Muda o estado de uma nota. Só o provedor pode aplicar estados de retorno, e a
 * autorização exige protocolo. Qualquer tentativa do usuário fora das transições
 * permitidas é recusada.
 */
export function mudarEstado(
  n: Nota,
  novo: EstadoNota,
  origem: "usuario" | "provedor",
  protocolo?: string,
): Nota {
  if (ESTADOS_DO_PROVEDOR.includes(novo)) {
    if (origem !== "provedor") throw new Error(`Estado "${novo}" só pode ser informado pelo provedor fiscal.`);
    if (novo === "autorizada" && (!protocolo || !protocolo.trim())) {
      throw new Error("Nota só pode ser marcada como autorizada com protocolo do provedor.");
    }
    return { ...n, estado: novo, protocolo: protocolo ?? n.protocolo };
  }
  if (origem !== "usuario") throw new Error("Apenas o usuário pode mover uma nota entre rascunho e pronta.");
  if (!(TRANSICOES_DO_USUARIO[n.estado] ?? []).includes(novo)) {
    throw new Error(`Transição de "${n.estado}" para "${novo}" não é permitida.`);
  }
  if (novo === "pronta") {
    const erros = validarParaTransmissao(n);
    if (erros.length) throw new Error(erros.join(" "));
  }
  return { ...n, estado: novo };
}

export type TransmissorFiscal = {
  transmitir(nota: Nota): Promise<{ protocolo: string; estado: EstadoNota }>;
};

/** Padrão quando nenhum provedor está configurado: recusa, sem fingir emissão. */
export const provedorNaoConfigurado: TransmissorFiscal = {
  async transmitir(): Promise<never> {
    throw new Error("Nenhum provedor fiscal configurado. A nota não foi emitida.");
  },
};

