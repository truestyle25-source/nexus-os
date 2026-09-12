import bcrypt from 'bcryptjs';

export const hashSenha = (senha: string): Promise<string> => bcrypt.hash(senha, 10);
export const verificarSenha = (senha: string, hash: string): Promise<boolean> => bcrypt.compare(senha, hash);
