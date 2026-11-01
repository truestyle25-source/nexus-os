// NEXUS OS - Envio de documentos do RH para o bucket
//
// ============================================================================
//  POR QUE ESTE MÓDULO EXISTE SEPARADO DA TELA
//  -------------------------------------------------
//  A tela do desligamento tinha um botão "Adicionar" que NÃO pedia arquivo:
//  fabricava uma string `documento_<timestamp>.pdf` e jogava na coluna
//  `Desligamento.documentos` (TEXT[]). O nome aparecia na tela, mas o binário
//  nunca existia em lugar nenhum. Este módulo é a parte que realmente lê o
//  arquivo do disco do usuário e fala com o bucket; a tela vira só apresentação.
// ============================================================================

import api, { API_URL, getToken } from './api';

/**
 * Espelha EXATAMENTE `EXTENSOES_PERMITIDAS` de `backend/src/lib/storage.ts`.
 *
 * A lista é repetida aqui de propósito: o servidor é a autoridade e valida de
 * novo, mas rejeitar no cliente evita ler 10 MB do disco para o usuário só
 * descobrir depois, ao enviar, que o formato não era aceito.
 */
export const EXTENSOES_PERMITIDAS = [
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'odt',
];

/** 10 MB — o mesmo limite de `TAMANHO_MAXIMO_BYTES` no backend. */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

/** Registro de `Documento` como a API devolve. */
export interface Documento {
  id: string;
  nomeOriginal: string;
  contentType: string;
  tamanho: number;
  descricao: string | null;
  situacao: string;
  createdAt: string;
}

export interface StatusStorage {
  configurado: boolean;
  mensagem?: string;
}

/** Extensão em minúsculas, ou string vazia se o nome não tiver ponto. */
function extensao(nome: string): string {
  const partes = String(nome || '').split('.');
  return partes.length < 2 ? '' : partes[partes.length - 1].toLowerCase();
}

/**
 * Lê o `File` como base64 puro (sem o prefixo `data:...;base64`).
 *
 * `readAsDataURL` é a opção nativa que não exige nenhuma dependência, e é a
 * mesma que o backend espera: ele faz `Buffer.from(x, 'base64')`, que ignora
 * caracteres fora do alfabeto base64 — o prefixo entraria no arquivo e
 * corromperia o binário. Por isso o `split(',')[1]`.
 */
function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Falha ao ler o arquivo do disco.'));
    leitor.onload = () => {
      const resultado = String(leitor.result || '');
      const virgula = resultado.indexOf(',');
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado);
    };
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Valida o arquivo ANTES de ler.
 *
 * A ordem não é arbitrária: arquivo sem extensão ou de formato proibido é
 * recusado primeiro, porque ler 10 MB do disco para só depois descobrir que o
 * formato não era aceito seria trabalho jogado fora.
 */
export function validarArquivo(arquivo: File): string | null {
  const ext = extensao(arquivo.name);
  if (!ext) return 'Arquivo sem extensão. Envie PDF, imagem ou documento com extensão.';
  if (!EXTENSOES_PERMITIDAS.includes(ext)) {
    return `Formato .${ext} não aceito. Permitidos: ${EXTENSOES_PERMITIDAS.join(', ')}.`;
  }
  if (arquivo.size === 0) return 'Arquivo vazio.';
  if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
    return `Arquivo maior que o limite de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

/**
 * Sobe UM arquivo para o bucket e devolve o registro criado.
 *
 * A ordem das coisas importa: o upload acontece DEPOIS do desligamento existir,
 * porque `entidadeId` é a chave primária daquele registro. Não há como anexar
 * antes — o id ainda não foi gerado.
 */
export async function enviarDocumento(params: {
  entidadeTipo: 'Funcionario' | 'Advertencia' | 'Suspensao' | 'Desligamento';
  entidadeId: string;
  arquivo: File;
  descricao?: string;
}): Promise<Documento> {
  const problema = validarArquivo(params.arquivo);
  if (problema) throw new Error(problema);

  const conteudoBase64 = await lerBase64(params.arquivo);

  const { data } = await api.post<Documento>('/rh/documentos', {
    entidadeTipo: params.entidadeTipo,
    entidadeId: params.entidadeId,
    nomeArquivo: params.arquivo.name,
    conteudoBase64,
    descricao: params.descricao,
  });
  return data;
}

/**
 * Sobe vários arquivos, um a um, e separa o que entrou do que falhou.
 *
 * Deliberadamente NÃO é `Promise.all`: um arquivo ruim não pode derrubar os
 * outros. Cada um tem seu `try`, e o chamador decide o que fazer com a lista de
 * falhas — o que importa é que o erro de um arquivo não apague o trabalho dos
 * outros.
 */
export async function enviarDocumentos(params: {
  entidadeTipo: 'Funcionario' | 'Advertencia' | 'Suspensao' | 'Desligamento';
  entidadeId: string;
  arquivos: File[];
  descricao?: string;
}): Promise<{ ok: Documento[]; falhas: string[] }> {
  const ok: Documento[] = [];
  const falhas: string[] = [];
  for (const arquivo of params.arquivos) {
    try {
      ok.push(await enviarDocumento({ ...params, arquivo }));
    } catch (err: any) {
      falhas.push(`${arquivo.name}: ${err?.message || 'falha no envio'}`);
    }
  }
  return { ok, falhas };
}

/** Lista os anexos de uma entidade. Sempre filtrada por empresa no servidor. */
export async function listarDocumentos(params: {
  entidadeTipo?: 'Funcionario' | 'Advertencia' | 'Suspensao' | 'Desligamento';
  entidadeId?: string;
  funcionarioId?: string;
}): Promise<Documento[]> {
  const { data } = await api.get<Documento[]>('/rh/documentos', { params });
  return Array.isArray(data) ? data : [];
}

/** Remove o objeto do bucket e o registro. Exige permissão de exclusão. */
export async function excluirDocumento(id: string): Promise<void> {
  await api.delete(`/rh/documentos/${id}`);
}

/** Status da configuração do bucket, para desabilitar a UI com mensagem clara. */
export async function statusStorage(): Promise<StatusStorage> {
  const { data } = await api.get<StatusStorage>('/rh/documentos/storage');
  return data;
}

/**
 * Baixa o binário de um documento e devolve o arquivo ao navegador.
 *
 * Não dá para usar um `<a href>`: o bucket é PRIVADO e a rota exige o Bearer
 * token, que um link simples não carregaria (o servidor responderia 401). Por
 * isso a chamada é feita com `fetch` + o token da sessão, e o corpo volta como
 * `Blob` para virar um download com o nome original.
 *
 * `api.download` NÃO serve aqui: ele baixa um documento já existente, e esta
 * rota de download de anexo é GET — dá para usar, mas o `baixarDocumento` do
 * módulo já é a rota de GET do `Documento`. O que não dá é reusar o
 * `api.download` do `page.tsx` sem declarar o verbo, porque lá as duas famílias
 * de documento (folha em GET, termos em POST) dividem o mesmo helper.
 */
export async function baixarDocumento(doc: Documento): Promise<void> {
  const resposta = await fetch(`${API_URL}/rh/documentos/${doc.id}/download`, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });
  if (!resposta.ok) throw new Error('Não foi possível baixar o documento.');

  const blob = await resposta.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.nomeOriginal;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar logo após o clique: o navegador já copiou o blob. Mantido o
  // object URL vivo vazaria memória a cada download da sessão.
  URL.revokeObjectURL(url);
}

