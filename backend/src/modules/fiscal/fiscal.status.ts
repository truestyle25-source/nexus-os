export type CadastroFiscalEmpresa = {
  cnpj: string | null;
  inscricaoEstadual: string | null;
  cep: string | null;
  endereco: string | null;
  cidade: string | null;
  estado: string | null;
};

export type CadastroFiscalFilial = {
  id: string;
  nome: string;
  cnpj: string | null;
  cidade: string | null;
  estado: string | null;
};

const CAMPOS_EMPRESA: Array<keyof CadastroFiscalEmpresa> = [
  'cnpj', 'inscricaoEstadual', 'cep', 'endereco', 'cidade', 'estado',
];
const CAMPOS_FILIAL: Array<keyof Omit<CadastroFiscalFilial, 'id' | 'nome'>> = [
  'cnpj', 'cidade', 'estado',
];

const ROTULOS: Record<string, string> = {
  cnpj: 'CNPJ', inscricaoEstadual: 'inscrição estadual', cep: 'CEP',
  endereco: 'endereço', cidade: 'cidade', estado: 'UF',
};

function ausentes<T extends Record<string, unknown>>(registro: T, campos: Array<keyof T>): string[] {
  return campos.filter((campo) => {
    const valor = registro[campo];
    return typeof valor !== 'string' || valor.trim().length === 0;
  }).map((campo) => ROTULOS[String(campo)] ?? String(campo));
}

/**
 * Produz apenas um diagnóstico do cadastro que já existe. Não valida
 * enquadramento tributário nem declara aptidão legal para emitir documentos.
 */
export function avaliarStatusFiscal(empresa: CadastroFiscalEmpresa, filiais: CadastroFiscalFilial[]) {
  return {
    provedor: null,
    integracaoConfigurada: false,
    emissaoHabilitada: false,
    motivoBloqueio: 'ADAPTADOR_FISCAL_NAO_IMPLEMENTADO',
    aviso: 'A conferência cadastral é informativa e não substitui validação fiscal/contábil.',
    cadastro: {
      empresa: { camposCadastraisAusentes: ausentes(empresa, CAMPOS_EMPRESA) },
      filiais: filiais.map((filial) => ({
        id: filial.id,
        nome: filial.nome,
        camposCadastraisAusentes: ausentes(filial, CAMPOS_FILIAL),
      })),
    },
    requisitosPendentes: [
      'Selecionar e homologar um provedor fiscal compatível com NF-e/NFC-e.',
      'Implementar armazenamento dedicado e rotacionável para credenciais fiscais.',
      'Definir e validar os dados tributários da empresa, estabelecimentos e produtos com a contabilidade.',
    ],
  } as const;
}
