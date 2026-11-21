// Estado do formulário da ficha do fornecedor (compartilhado entre as abas: trocar de aba não perde nada)
// e conversão para o corpo da API, enviando só o que mudou (edição) ou tudo o que foi preenchido (cadastro).
import { lerNumero } from '@/lib/produto-ficha';
import { soDigitos, type Endereco, type FichaFornecedor } from '@/lib/fornecedor-ficha';

export const CAMPOS_TEXTO = [
  'filialId', 'status', 'tipoPessoa', 'documento', 'nome', 'nomeFantasia', 'inscricaoEstadual', 'inscricaoMunicipal', 'cnae', 'regimeTributario',
  'categoria', 'segmento', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'pais', 'codigoIbge', 'site', 'emailPedidos', 'emailNfe',
  'condicaoPagamento', 'formaPagamento', 'chavePix', 'tipoChavePix', 'banco', 'codigoBanco', 'agencia', 'conta', 'contaDigito', 'tipoConta', 'titular',
  'titularDocumento', 'naturezaFinanceira', 'planoContas', 'centroCusto', 'cfopEntrada', 'observacoesFiscais', 'modalidadeFrete', 'transportadora',
  'compradorId', 'condicoesComerciais', 'observacoesLogisticas', 'homologadoPor', 'observacoes', 'infoComerciais', 'restricoesAtendimento', 'orientacoesCompradores',
] as const;
export const CAMPOS_DATA = ['dataAbertura', 'dataHomologacao', 'validadeCndFederal', 'validadeFgts', 'validadeCndt'] as const;
export const CAMPOS_NUMERO = ['limiteCredito', 'pedidoMinimo'] as const;
export const CAMPOS_INTEIRO = ['prazoEntregaDias'] as const;
export const CAMPOS_BOOLEANO = ['ieIsento', 'retemIrrf', 'retemPis', 'retemCofins', 'retemCsll', 'retemIss', 'retemInss', 'homologado'] as const;
/** Sim/Não/não informado. */
export const CAMPOS_TRISTATE = ['contribuinteIcms', 'optanteSimples'] as const;
export const CAMPOS_CONTATO = ['cpNome', 'cpCargo', 'cpDepartamento', 'cpTelefone', 'cpCelular', 'cpWhatsapp', 'cpEmail'] as const;
const ENDERECO_VAZIO: Required<Endereco> = { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', codigoIbge: '' };

type ChaveTexto = (typeof CAMPOS_TEXTO)[number] | (typeof CAMPOS_DATA)[number] | (typeof CAMPOS_NUMERO)[number] | (typeof CAMPOS_INTEIRO)[number] | (typeof CAMPOS_TRISTATE)[number] | (typeof CAMPOS_CONTATO)[number];
export type FormFornecedor = Record<ChaveTexto, string> & Record<(typeof CAMPOS_BOOLEANO)[number], boolean> & {
  cobrancaDiferente: boolean; cobranca: Required<Endereco>;
  alternativoAtivo: boolean; alternativo: Required<Endereco>;
};

/** Campos que o servidor exige no estado final (não podem ser enviados vazios). */
const OBRIGATORIOS = new Set(['tipoPessoa', 'nome', 'status', 'categoria', 'pais']);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const numTxt = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)).replace('.', ','));
const endereco = (v: unknown): Required<Endereco> => ({ ...ENDERECO_VAZIO, ...((v && typeof v === 'object' ? v : {}) as Endereco) } as Required<Endereco>);

export function formVazio(filialId = ''): FormFornecedor {
  const f = {} as FormFornecedor;
  for (const c of [...CAMPOS_TEXTO, ...CAMPOS_DATA, ...CAMPOS_NUMERO, ...CAMPOS_INTEIRO, ...CAMPOS_TRISTATE, ...CAMPOS_CONTATO]) (f as any)[c] = '';
  for (const c of CAMPOS_BOOLEANO) (f as any)[c] = false;
  f.status = 'Ativo'; f.tipoPessoa = 'JURIDICA'; f.pais = 'Brasil'; f.categoria = 'Outros'; f.filialId = filialId;
  f.cobrancaDiferente = false; f.cobranca = { ...ENDERECO_VAZIO }; f.alternativoAtivo = false; f.alternativo = { ...ENDERECO_VAZIO };
  return f;
}

export function formDaFicha(ficha: FichaFornecedor): FormFornecedor {
  const p = ficha.fornecedor;
  const f = formVazio();
  for (const c of CAMPOS_TEXTO) (f as any)[c] = txt(p[c]);
  f.documento = txt(p.cnpj);
  for (const c of CAMPOS_DATA) (f as any)[c] = p[c] ? String(p[c]).slice(0, 10) : '';
  for (const c of [...CAMPOS_NUMERO, ...CAMPOS_INTEIRO]) (f as any)[c] = numTxt(p[c]);
  for (const c of CAMPOS_BOOLEANO) (f as any)[c] = Boolean(p[c]);
  for (const c of CAMPOS_TRISTATE) (f as any)[c] = p[c] === true ? 'sim' : p[c] === false ? 'nao' : '';
  f.cobrancaDiferente = !!p.enderecoCobranca; f.cobranca = endereco(p.enderecoCobranca);
  f.alternativoAtivo = !!p.enderecoAlternativo; f.alternativo = endereco(p.enderecoAlternativo);
  const cp = ficha.fornecedor.contatos.find((c) => c.principal) ?? ficha.fornecedor.contatos[0];
  if (cp) {
    f.cpNome = txt(cp.nome); f.cpCargo = txt(cp.cargo); f.cpDepartamento = txt(cp.departamento); f.cpTelefone = txt(cp.telefone);
    f.cpCelular = txt(cp.celular); f.cpWhatsapp = txt(cp.whatsapp); f.cpEmail = txt(cp.email);
  }
  if (!f.status) f.status = 'Ativo';
  return f;
}

const limpaEndereco = (e: Required<Endereco>) => {
  const s = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, (v ?? '').trim()]));
  return Object.values(s).some(Boolean) ? { ...s, cep: soDigitos(s.cep), uf: s.uf.toUpperCase() } : null;
};

/** Corpo da API: só o que mudou em relação a `original` (ou tudo, no cadastro: `original` = null). */
export function payloadFicha(original: FormFornecedor | null, atual: FormFornecedor, podeBancario: boolean): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  const mudou = (c: keyof FormFornecedor) => !original || JSON.stringify(original[c]) !== JSON.stringify(atual[c]);
  const BANCARIOS = new Set(['chavePix', 'tipoChavePix', 'banco', 'codigoBanco', 'agencia', 'conta', 'contaDigito', 'tipoConta', 'titular', 'titularDocumento']);
  for (const c of CAMPOS_TEXTO) {
    if (!mudou(c)) continue;
    if (BANCARIOS.has(c) && !podeBancario) continue;
    let v = atual[c].trim();
    if (c === 'documento' || c === 'cep') v = soDigitos(v);
    if (c === 'uf') v = v.toUpperCase();
    if (!v && OBRIGATORIOS.has(c)) continue;
    if (!v && !original) continue;
    saida[c] = v || null;
  }
  if (atual.documento && (!original || original.tipoPessoa !== atual.tipoPessoa)) saida.documento = soDigitos(atual.documento);
  for (const c of CAMPOS_DATA) if (mudou(c) && (atual[c] || original)) saida[c] = atual[c] || null;
  for (const c of CAMPOS_NUMERO) if (mudou(c) && (atual[c] || original)) saida[c] = lerNumero(atual[c]);
  for (const c of CAMPOS_INTEIRO) if (mudou(c) && (atual[c] || original)) { const n = lerNumero(atual[c]); saida[c] = n === null ? null : Math.round(n); }
  for (const c of CAMPOS_BOOLEANO) if (mudou(c)) saida[c] = atual[c];
  for (const c of CAMPOS_TRISTATE) if (mudou(c) && (atual[c] || original)) saida[c] = atual[c] === 'sim' ? true : atual[c] === 'nao' ? false : null;
  if (mudou('cobrancaDiferente') || mudou('cobranca')) saida.enderecoCobranca = atual.cobrancaDiferente ? limpaEndereco(atual.cobranca) : null;
  if (mudou('alternativoAtivo') || mudou('alternativo')) saida.enderecoAlternativo = atual.alternativoAtivo ? limpaEndereco(atual.alternativo) : null;
  if (!original) {
    if (saida.enderecoCobranca === null) delete saida.enderecoCobranca;
    if (saida.enderecoAlternativo === null) delete saida.enderecoAlternativo;
  }
  return saida;
}

/** Contato principal editado no cartão da aba Dados (null = sem mudança). */
export function contatoPrincipalAlterado(original: FormFornecedor | null, atual: FormFornecedor) {
  if (original && CAMPOS_CONTATO.every((c) => original[c] === atual[c])) return null;
  const v = (s: string) => s.trim() || null;
  return { nome: atual.cpNome.trim(), cargo: v(atual.cpCargo), departamento: v(atual.cpDepartamento), telefone: v(atual.cpTelefone), celular: v(atual.cpCelular), whatsapp: v(atual.cpWhatsapp), email: v(atual.cpEmail) };
}

/** Obrigatórios mínimos (mesma regra do servidor), com a aba onde cada um fica. */
export function faltando(f: FormFornecedor, temContato: boolean): Array<{ campo: string; aba: string }> {
  const lista: Array<{ campo: string; aba: string }> = [];
  if (!soDigitos(f.documento)) lista.push({ campo: f.tipoPessoa === 'FISICA' ? 'CPF' : 'CNPJ', aba: 'cabecalho' });
  if (!f.nome.trim()) lista.push({ campo: f.tipoPessoa === 'FISICA' ? 'Nome' : 'Razão social', aba: 'cabecalho' });
  if (soDigitos(f.cep).length !== 8) lista.push({ campo: 'CEP', aba: 'endereco' });
  if (!f.cidade.trim()) lista.push({ campo: 'Cidade', aba: 'endereco' });
  if (!/^[A-Za-z]{2}$/.test(f.uf.trim())) lista.push({ campo: 'UF', aba: 'endereco' });
  if (!temContato) lista.push({ campo: 'Contato', aba: 'dados' });
  return lista;
}
