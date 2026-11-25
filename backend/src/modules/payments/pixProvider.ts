import { ErroDeNegocio } from '../../lib/erros.js';

/** Provider flags stay false until an official adapter with real authorization is installed. */
export const pixProviderConfigurado = false;
export const tefProviderConfigurado = false;

export const mensagemPixProviderIndisponivel =
  'PIX indisponível: nenhum provider oficial com geração e confirmação de pagamento está configurado.';

/**
 * Confere NO PROVEDOR que o PIX `txid` foi pago, com o valor informado.
 *
 * O servidor nunca confia no "PIX pago" que vem da tela: sem esta conferência,
 * qualquer texto em `referencia` virava venda paga. Enquanto não houver um
 * provedor oficial integrado, toda conferência é recusada — e quem instalar o
 * provedor precisa implementar esta função (status "pago" e valor recebido em
 * centavos iguais ao informado) antes de ligar `pixProviderConfigurado`.
 */
export async function verificarPagamentoPix(input: { txid: string; valor: number; empresaId: string }): Promise<void> {
  void input;
  throw new ErroDeNegocio(mensagemPixProviderIndisponivel, 503);
}
