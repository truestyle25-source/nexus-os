/**
 * Foto do produto (NEXUS CLUB, fase F-Foto) — regras puras e leitura por link assinado.
 *
 * - Só JPG, PNG e WEBP, até 5 MB. O tipo é decidido pelo CONTEÚDO (assinatura do
 *   arquivo + decodificação pelo sharp), nunca pelo nome ou pelo tipo declarado:
 *   um SVG/HTML renomeado para .jpg é recusado.
 * - A foto é decodificada e regravada do zero em WEBP (160/400/1000 px, quadrada,
 *   fundo branco). Isso descarta EXIF/GPS e qualquer outro metadado escondido.
 * - O bucket é privado: leitura só por link temporário assinado, gerado a partir
 *   da chave guardada no produto da própria empresa.
 */
import sharp from 'sharp';
import { ErroDeNegocio } from '../../lib/erros.js';
import { urlsAssinadas } from '../../lib/storage.js';

export const FOTO_TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;
export const FOTO_TAMANHOS = { miniatura: 160, lista: 400, detalhe: 1000 } as const;
export type TamanhoFoto = keyof typeof FOTO_TAMANHOS;
/** Validade do link mostrado na ficha (a tela recarrega a ficha a cada abertura). */
export const VALIDADE_LINK_FICHA_S = 60 * 60;
/**
 * Catálogo do PDV fica guardado no aparelho (modo offline): link de 7 dias, e a
 * sincronização incremental reenvia os produtos com foto a cada janela de 3 dias
 * (ver `inicioJanelaFotos`), então um PDV que sincroniza nunca fica com link vencido.
 */
export const VALIDADE_LINK_PDV_S = 7 * 24 * 60 * 60;
export const JANELA_RENOVACAO_PDV_MS = 3 * 24 * 60 * 60 * 1000;
/** Proteção contra "bomba de descompressão" (imagem pequena em bytes e gigante em pixels). */
const PIXELS_MAXIMOS = 50_000_000;

type Formato = 'jpeg' | 'png' | 'webp';

/** Tipo real pela assinatura (magic bytes) do arquivo. */
export function formatoPeloConteudo(b: Buffer): Formato | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

const EXTENSOES = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Confere nome, tamanho e conteúdo. Lança ErroDeNegocio com mensagem clara
 * (400 para tipo, 413 para tamanho).
 */
export function validarArquivoFoto(nome: string, corpo: Buffer): Formato {
  const ext = (String(nome).split('.').pop() ?? '').toLowerCase();
  if (!EXTENSOES.includes(ext)) throw new ErroDeNegocio('Envie uma foto em JPG, PNG ou WEBP.', 400);
  if (corpo.length === 0) throw new ErroDeNegocio('Arquivo vazio.', 400);
  if (corpo.length > FOTO_TAMANHO_MAXIMO_BYTES) throw new ErroDeNegocio('A foto passa de 5 MB. Envie uma foto menor.', 413);
  const formato = formatoPeloConteudo(corpo);
  if (!formato) throw new ErroDeNegocio('O conteúdo do arquivo não é uma foto JPG, PNG ou WEBP.', 400);
  return formato;
}

/** Decodifica, confirma o formato e gera os 3 tamanhos em WEBP, sem metadados. */
export async function processarFoto(corpo: Buffer, formato: Formato): Promise<Record<TamanhoFoto, Buffer>> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(corpo, { limitInputPixels: PIXELS_MAXIMOS, failOn: 'error' }).metadata();
  } catch {
    throw new ErroDeNegocio('Não foi possível ler esta foto. Envie um JPG, PNG ou WEBP válido.', 400);
  }
  if (meta.format !== formato) throw new ErroDeNegocio('O conteúdo do arquivo não é uma foto JPG, PNG ou WEBP.', 400);
  const saida = {} as Record<TamanhoFoto, Buffer>;
  try {
    for (const [nome, px] of Object.entries(FOTO_TAMANHOS) as Array<[TamanhoFoto, number]>) {
      // rotate() aplica a orientação da câmera antes de descartar os metadados;
      // sem withMetadata(), o sharp não copia EXIF/GPS/XMP/ICC para a saída.
      saida[nome] = await sharp(corpo, { limitInputPixels: PIXELS_MAXIMOS, failOn: 'error' })
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(px, px, { fit: 'contain', background: '#ffffff' })
        .webp({ quality: 82 })
        .toBuffer();
    }
  } catch {
    throw new ErroDeNegocio('Não foi possível processar esta foto. Envie um JPG, PNG ou WEBP válido.', 400);
  }
  return saida;
}

/** Chaves dos 3 tamanhos a partir da chave-base guardada em `Produto.imagemChave`. */
export function chavesDaFoto(base: string): Record<TamanhoFoto, string> {
  const raiz = base.replace(/\.webp$/i, '');
  return { miniatura: `${raiz}-160.webp`, lista: `${raiz}-400.webp`, detalhe: `${raiz}-1000.webp` };
}

/** A chave só é assinada se for da empresa que pede (defesa além do filtro por empresaId). */
function chaveDaEmpresa(empresaId: string, base: string | null | undefined): base is string {
  return !!base && base.startsWith(`${empresaId}/`);
}

export type LinksFoto = Record<TamanhoFoto, string>;

/**
 * Links assinados das fotos de vários produtos da mesma empresa, numa chamada só.
 * Falha do armazenamento não derruba a tela: devolve mapa vazio e o chamador cai
 * para o link antigo (`imagem`), se houver.
 */
export async function linksDasFotos(empresaId: string, bases: Array<string | null | undefined>, segundos: number): Promise<Map<string, LinksFoto>> {
  const validas = [...new Set(bases.filter((b): b is string => chaveDaEmpresa(empresaId, b)))];
  const resultado = new Map<string, LinksFoto>();
  if (!validas.length) return resultado;
  let assinadas: Map<string, string>;
  try {
    assinadas = await urlsAssinadas(validas.flatMap((b) => Object.values(chavesDaFoto(b))), segundos);
  } catch {
    return resultado;
  }
  for (const b of validas) {
    const c = chavesDaFoto(b);
    const links = { miniatura: assinadas.get(c.miniatura), lista: assinadas.get(c.lista), detalhe: assinadas.get(c.detalhe) };
    if (links.miniatura && links.lista && links.detalhe) resultado.set(b, links as LinksFoto);
  }
  return resultado;
}

/** Início da janela atual de renovação dos links no catálogo do PDV. */
export function inicioJanelaFotos(agoraMs = Date.now()): Date {
  return new Date(Math.floor(agoraMs / JANELA_RENOVACAO_PDV_MS) * JANELA_RENOVACAO_PDV_MS);
}
