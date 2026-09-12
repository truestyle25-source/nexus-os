/**
 * Erro de regra de negócio (Seção 45: "mensagens claras", "não esconder
 * erros"). Use isto quando quiser controlar o status HTTP retornado —
 * ex.: 404 para "não encontrado", 409 para conflito, 422 para regra violada.
 *
 * Rotas que apenas fazem `throw new Error('mensagem')` continuam
 * funcionando: o error handler global (server.ts) trata qualquer Error
 * simples lançado deliberadamente no código da aplicação como HTTP 400,
 * usando a própria mensagem. ErroDeNegocio existe para os casos em que
 * 400 não é o status correto.
 */
export class ErroDeNegocio extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ErroDeNegocio';
    this.status = status;
  }
}

export const NaoEncontrado = (mensagem: string): ErroDeNegocio => new ErroDeNegocio(mensagem, 404);
export const Conflito = (mensagem: string): ErroDeNegocio => new ErroDeNegocio(mensagem, 409);
export const NaoAutorizado = (mensagem: string): ErroDeNegocio => new ErroDeNegocio(mensagem, 403);
