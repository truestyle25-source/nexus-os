/**
 * Avaliação com o modelo real: o provedor às vezes responde 503 (sobrecarga do serviço do
 * Google). Isso não é falha de qualidade: a investigação fica AGUARDANDO_PROVEDOR e é retomada
 * do ponto em que parou (mesmo mecanismo que o usuário usa). Até 3 retomadas com espera
 * crescente; só depois disso a avaliação falha.
 */
import { iniciarInvestigacao, retomarInvestigacao } from '../src/modules/nexus-ai/motor.js';

type Ctx = Parameters<typeof iniciarInvestigacao>[0];
type Pedido = Parameters<typeof iniciarInvestigacao>[1];

export async function investigarComNovaTentativa(ctx: Ctx, pedido: Pedido, tentativas = 3) {
  let r = await iniciarInvestigacao(ctx, pedido);
  for (let i = 1; i <= tentativas && r.status === 'AGUARDANDO_PROVEDOR'; i++) {
    console.log(`[aval] provedor indisponível; retomando (${i}/${tentativas})`);
    await new Promise((ok) => setTimeout(ok, 15_000 * i));
    r = await retomarInvestigacao(ctx, r.execucaoId);
  }
  return r;
}
