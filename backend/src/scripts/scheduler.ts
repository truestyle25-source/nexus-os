/**
 * Agendador embutido do processo backend (fecha DEBITO-TECNICO item 8).
 *
 * Antes: nada disparava `gerarSnapshotDoDia` sozinho — dependia 100% de um
 * cron externo (systemd timer, GitHub Action, cron do provedor de
 * hospedagem) chamando `npm run estoque:snapshot` ou
 * `POST /estoque/snapshot/gerar`. Se ninguém configurasse esse cron, o giro
 * de estoque ficava preso no fallback aproximado para sempre.
 *
 * Agora, se `SNAPSHOT_AUTO_ENABLED=true` (padrão), o próprio processo do
 * backend agenda a execução diária via `setTimeout`/`setInterval` — sem
 * dependência nova, sem precisar de cron externo. Isso só funciona enquanto
 * o processo do backend estiver rodando continuamente (não serve para
 * ambientes serverless que hibernam entre requisições — nesse caso, use o
 * cron externo do provedor apontando para o script ou o endpoint, e deixe
 * `SNAPSHOT_AUTO_ENABLED=false` para não haver ambiguidade sobre qual
 * mecanismo está de fato rodando).
 */
import { prisma } from '../lib/prisma.js';
import { gerarSnapshotDoDia } from '../modules/estoque/estoque-indicadores.service.js';
import { fecharExpediente } from '../modules/rh/ponto-fechamento.service.js';

/**
 * Fecha o expediente de todas as empresas ativas, marcando as faltas.
 *
 * Roda DEPOIS do snapshot, no mesmo horário: os dois leem o dia anterior e são
 * idempotentes, mas o snapshot de estoque não depende de ponto — se o
 * fechamento falhar, o giro de estoque já foi salvo.
 */
async function fecharExpedientesDeTodasAsEmpresas(): Promise<void> {
  const empresas = await prisma.empresa.findMany({ where: { status: 'ATIVO' }, select: { id: true, nome: true } });
  let total = 0;
  for (const empresa of empresas) {
    try {
      const { faltasMarcadas } = await fecharExpediente(empresa.id);
      total += faltasMarcadas;
    } catch (err) {
      console.error(`[scheduler] fechamento de expediente falhou para ${empresa.nome} (${empresa.id}):`, err);
    }
  }
  if (total > 0) console.log(`[scheduler] expediente fechado: ${total} faltas marcadas em ${empresas.length} empresas.`);
}

async function executarSnapshotDeTodasAsEmpresas(): Promise<void> {
  const empresas = await prisma.empresa.findMany({ where: { status: 'ATIVO' }, select: { id: true, nome: true } });
  let total = 0;
  for (const empresa of empresas) {
    try {
      const { processados } = await gerarSnapshotDoDia(empresa.id);
      total += processados;
    } catch (err) {
      console.error(`[scheduler] snapshot falhou para empresa ${empresa.nome} (${empresa.id}):`, err);
    }
  }
  console.log(`[scheduler] snapshot diário concluído: ${empresas.length} empresas, ${total} linhas no total.`);
}

function msAteProximoHorario(horaUtc: number): number {
  const agora = new Date();
  const proximo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), horaUtc, 0, 0, 0));
  if (proximo.getTime() <= agora.getTime()) {
    proximo.setUTCDate(proximo.getUTCDate() + 1);
  }
  return proximo.getTime() - agora.getTime();
}

/**
 * Agenda a primeira execução para o próximo horário configurado (UTC) e,
 * a partir daí, repete a cada 24h. Chamado uma vez no boot do servidor
 * (server.ts). Não bloqueia o boot — o agendamento é assíncrono.
 */
export function iniciarAgendadorDeSnapshot(): void {
  if (process.env.SNAPSHOT_AUTO_ENABLED === 'false') {
    console.log('[scheduler] SNAPSHOT_AUTO_ENABLED=false — snapshot diário embutido desativado (use cron externo).');
    return;
  }
  const horaUtc = Number(process.env.SNAPSHOT_HOUR_UTC ?? 3);
  const primeiraEsperaMs = msAteProximoHorario(horaUtc);
  console.log(`[scheduler] snapshot diário agendado para daqui a ${Math.round(primeiraEsperaMs / 60000)} min (${horaUtc}h UTC), repetindo a cada 24h.`);

  setTimeout(() => {
    void executarSnapshotDeTodasAsEmpresas();
    void fecharExpedientesDeTodasAsEmpresas();
    setInterval(() => void executarSnapshotDeTodasAsEmpresas(), 24 * 60 * 60 * 1000);
    setInterval(() => void fecharExpedientesDeTodasAsEmpresas(), 24 * 60 * 60 * 1000);
  }, primeiraEsperaMs);
}
