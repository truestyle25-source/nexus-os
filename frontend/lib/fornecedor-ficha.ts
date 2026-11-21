// Ficha completa do fornecedor (cadastro por abas): tipos, chamadas à API e utilitários.
// Toda regra (obrigatórios, CNPJ/CPF, permissões, dados bancários) é validada também no servidor.
import api from './api';

export type Id = string;
export type StatusFornecedor = 'Ativo' | 'Inativo' | 'Bloqueado' | 'Crítico';

export interface Contato {
  id?: Id; nome: string; cargo?: string | null; departamento?: string | null; telefone?: string | null;
  celular?: string | null; whatsapp?: string | null; email?: string | null; principal?: boolean;
}

export interface Endereco { cep?: string; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string; codigoIbge?: string | null }

export interface FichaFornecedor {
  fornecedor: Record<string, any> & { id: Id; nome: string; status: StatusFornecedor; codigoExibido: string | null; contatos: Contato[] };
  empresa: { id: Id; nome: string };
  podeVerBancario: boolean;
  podeVerFinanceiro: boolean;
  recebePedidos: boolean;
  resumo: { pedidos: number; pedidosAbertos: number; totalCompradoAno: number; ano: number; titulosAPagar: { valor: number; quantidade: number } | null; notaMedia: number | null; avaliacoes: number };
  auditoria: { criadoPor: string | null; criadoEm: string; atualizadoPor: string | null; atualizadoEm: string };
}

export interface CatalogosFornecedor {
  filiais: Array<{ id: Id; nome: string; status: string }>;
  compradores: Array<{ id: Id; nome: string }>;
  empresa: { id: Id; nome: string } | null;
  categorias: string[];
  tiposDocumento: string[];
  storageConfigurado: boolean;
  podeVerBancario: boolean;
}

export interface ProdutoFornecedor {
  id: Id; produtoId: Id; codigoInterno: string | null; nome: string; produtoAtivo: boolean;
  referencia: string | null; codigoFornecedor: string | null; descricaoComercial: string | null;
  categoria: string | null; categoriaId: Id | null; unidade: string; ncm: string | null; cest: string | null; cfop: string | null;
  cstCsosn: string | null; origem: number | null; aliquotas: { icms: number | null; pis: number | null; cofins: number | null; ipi: number | null } | null;
  preco?: number | null; ultimoPrecoCompra?: number | null; precoAtualizadoEm: string | null; prazoEntregaDias: number | null; pedidoMinimo: number | null;
  status: 'ATIVO' | 'SUSPENSO'; principal: boolean; outrosFornecedores: Array<{ nome: string; principal: boolean }>;
}

const base = '/api/v1/fornecedores';
export const fornecedorApi = {
  catalogos: () => api.get<CatalogosFornecedor>(`${base}/catalogos`).then((r) => r.data),
  ficha: (id: Id) => api.get<FichaFornecedor>(`${base}/${id}/ficha`).then((r) => r.data),
  criar: (dados: Record<string, unknown>) => api.post<FichaFornecedor>(`${base}/ficha`, dados).then((r) => r.data),
  salvar: (id: Id, dados: Record<string, unknown>) => api.put<FichaFornecedor>(`${base}/${id}/ficha`, dados).then((r) => r.data),
  status: (id: Id, status: StatusFornecedor) => api.patch(`/fornecedores/${id}/status`, { status }).then((r) => r.data),
  cep: (cep: string) => api.get<Required<Endereco>>(`/api/v1/cep/${cep.replace(/\D/g, '')}`).then((r) => r.data),
  contatos: {
    criar: (id: Id, c: Contato) => api.post<Contato>(`${base}/${id}/contatos`, c).then((r) => r.data),
    salvar: (id: Id, contatoId: Id, c: Partial<Contato>) => api.put<Contato>(`${base}/${id}/contatos/${contatoId}`, c).then((r) => r.data),
    excluir: (id: Id, contatoId: Id) => api.delete(`${base}/${id}/contatos/${contatoId}`).then((r) => r.data),
  },
  produtos: {
    listar: (id: Id, params: Record<string, unknown>) => api.get<{ itens: ProdutoFornecedor[]; indicadores: { total: number; ativos: number; principal: number; semPreco: number | null }; podeVerCusto: boolean }>(`${base}/${id}/produtos`, { params }).then((r) => r.data),
    candidatos: (id: Id, busca: string) => api.get<Array<{ id: Id; nome: string; sku: string | null; status: string; unidade: string; categoria: { nome: string } | null }>>(`${base}/${id}/produtos/candidatos`, { params: { busca } }).then((r) => r.data),
    vincular: (id: Id, dados: Record<string, unknown>) => api.post(`${base}/${id}/produtos`, dados).then((r) => r.data),
    salvar: (id: Id, vinculoId: Id, dados: Record<string, unknown>) => api.put(`${base}/${id}/produtos/${vinculoId}`, dados).then((r) => r.data),
    remover: (id: Id, vinculoId: Id) => api.delete(`${base}/${id}/produtos/${vinculoId}`).then((r) => r.data),
    precos: (id: Id, produtoId: Id) => api.get<Array<{ id: Id; data: string; campo: string; anterior: number | null; novo: number | null; origem: string; documento: string | null; usuario: string | null }>>(`${base}/${id}/produtos/${produtoId}/precos`).then((r) => r.data),
    exportar: (id: Id) => api.get<{ nome: string; mime: string; base64: string }>(`${base}/${id}/produtos/exportar`).then((r) => r.data),
  },
  avaliacoes: {
    listar: (id: Id) => api.get<any>(`${base}/${id}/avaliacoes`).then((r) => r.data),
    criar: (id: Id, dados: Record<string, unknown>) => api.post(`${base}/${id}/avaliacoes`, dados).then((r) => r.data),
  },
  documentos: {
    listar: (id: Id) => api.get<{ storageConfigurado: boolean; itens: any[] }>(`${base}/${id}/documentos`).then((r) => r.data),
    enviar: (id: Id, dados: Record<string, unknown>) => api.post(`${base}/${id}/documentos`, dados).then((r) => r.data),
    remover: (id: Id, docId: Id) => api.delete(`${base}/${id}/documentos/${docId}`).then((r) => r.data),
    baixar: (id: Id, docId: Id) => api.get<{ nome: string; mime: string; base64: string }>(`${base}/${id}/documentos/${docId}/arquivo`).then((r) => r.data),
  },
  historico: (id: Id, params: Record<string, unknown>) => api.get<any>(`${base}/${id}/historico`, { params }).then((r) => r.data),
};

// ------------------------------------------------------------------ documento (CNPJ/CPF)
export const soDigitos = (v: string) => v.replace(/\D/g, '');

export function mascararDocumento(v: string, tipo: 'JURIDICA' | 'FISICA'): string {
  const d = soDigitos(v).slice(0, tipo === 'JURIDICA' ? 14 : 11);
  if (tipo === 'FISICA') return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

export function cnpjValido(v: string): boolean {
  const c = soDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (b: string) => {
    const pesos = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = b.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  return c === c.slice(0, 12) + d1 + dv(c.slice(0, 12) + d1);
}

export function cpfValido(v: string): boolean {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (b: string, p: number) => { const r = (b.split('').reduce((s, d, i) => s + Number(d) * (p - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  return c === c.slice(0, 9) + dv(c.slice(0, 9), 10) + dv(c.slice(0, 10), 11);
}

export const documentoValido = (v: string, tipo: 'JURIDICA' | 'FISICA') => (tipo === 'JURIDICA' ? cnpjValido(v) : cpfValido(v));
export const mascararCep = (v: string) => soDigitos(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

export const ROTULO_DOCUMENTO: Record<string, string> = {
  CARTAO_CNPJ: 'Cartão CNPJ', CONTRATO_SOCIAL: 'Contrato social', CERTIDAO: 'Certidão negativa', CONTRATO: 'Contrato comercial', TABELA_PRECOS: 'Tabela de preços', OUTRO: 'Outro',
};
export const ROTULO_SITUACAO: Record<string, { texto: string; tom?: 'ok' | 'alerta' | 'erro' }> = {
  VALIDO: { texto: 'Válido', tom: 'ok' }, A_VENCER: { texto: 'A vencer', tom: 'alerta' }, VENCIDO: { texto: 'Vencido', tom: 'erro' },
  SEM_VALIDADE: { texto: 'Sem validade' }, REMOVIDO: { texto: 'Removido' },
};
export const ROTULO_CAMPO: Record<string, string> = {
  nome: 'Razão social / nome', nomeFantasia: 'Nome fantasia', cnpj: 'CNPJ/CPF', tipoPessoa: 'Tipo de pessoa', status: 'Status', filialId: 'Loja/filial',
  inscricaoEstadual: 'Inscrição estadual', ieIsento: 'IE isento', inscricaoMunicipal: 'Inscrição municipal', cnae: 'CNAE', dataAbertura: 'Data de abertura',
  regimeTributario: 'Regime tributário', categoria: 'Categoria', segmento: 'Segmento', cep: 'CEP', logradouro: 'Logradouro', numero: 'Número',
  complemento: 'Complemento', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF', pais: 'País', codigoIbge: 'Código IBGE', enderecoCobranca: 'Endereço de cobrança',
  enderecoAlternativo: 'Endereço alternativo', site: 'Site', emailPedidos: 'E-mail para pedidos', emailNfe: 'E-mail para NF-e', condicaoPagamento: 'Condição de pagamento',
  formaPagamento: 'Forma de pagamento', chavePix: 'Chave PIX', tipoChavePix: 'Tipo da chave PIX', banco: 'Banco', codigoBanco: 'Código do banco', agencia: 'Agência',
  conta: 'Conta', contaDigito: 'Dígito', tipoConta: 'Tipo de conta', titular: 'Titular', titularDocumento: 'CPF/CNPJ do titular', limiteCredito: 'Limite de crédito',
  naturezaFinanceira: 'Natureza financeira', planoContas: 'Plano de contas', centroCusto: 'Centro de custo', contribuinteIcms: 'Contribuinte de ICMS',
  optanteSimples: 'Optante pelo Simples', retemIrrf: 'Retém IRRF', retemPis: 'Retém PIS', retemCofins: 'Retém COFINS', retemCsll: 'Retém CSLL', retemIss: 'Retém ISS',
  retemInss: 'Retém INSS', cfopEntrada: 'CFOP de entrada', observacoesFiscais: 'Observações fiscais', prazoEntregaDias: 'Prazo de entrega', pedidoMinimo: 'Pedido mínimo',
  modalidadeFrete: 'Frete', transportadora: 'Transportadora', compradorId: 'Comprador', condicoesComerciais: 'Condições comerciais', observacoesLogisticas: 'Observações logísticas',
  homologado: 'Homologado', dataHomologacao: 'Data de homologação', homologadoPor: 'Responsável pela homologação', validadeCndFederal: 'Validade CND federal',
  validadeFgts: 'Validade FGTS', validadeCndt: 'Validade certidão trabalhista', observacoes: 'Observações gerais', infoComerciais: 'Informações comerciais',
  restricoesAtendimento: 'Restrições de atendimento', orientacoesCompradores: 'Orientações para compradores',
};
