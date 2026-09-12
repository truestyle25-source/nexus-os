/** Remove tudo que não é dígito. Usado para CPF/CNPJ/CEP antes de persistir. */
export const clean = (v?: string): string | undefined => v?.replace(/\D/g, '') || undefined;
