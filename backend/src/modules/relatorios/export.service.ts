import ExcelJS from 'exceljs';
import type { KpiRelatorio, LinhaTabela } from './relatorios.service.js';

export interface ArgsMontarPlanilha {
  formato: 'csv' | 'excel';
  titulo: string;
  kpis: KpiRelatorio[];
  tabela: LinhaTabela[];
}

/** Slug simples e estável para o nome do arquivo baixado. */
function slugArquivo(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'relatorio'
  );
}

/**
 * Monta a planilha do relatório (Seção 33) e devolve base64 + nome.
 * - excel → .xlsx real via exceljs (título, bloco de KPIs e a tabela
 *   completa com cabeçalho estilizado);
 * - csv   → o mesmo workbook convertido em CSV pelo próprio exceljs.
 * O frontend recebe o base64, faz atob → blob e dispara o download.
 */
export async function montarPlanilha(
  args: ArgsMontarPlanilha,
): Promise<{ base64: string; nome: string }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Relatorio');

  const tituloRow = ws.addRow([args.titulo]);
  tituloRow.font = { bold: true, size: 14 };
  ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')} — NEXUS OS`]);
  ws.addRow([]);

  if (args.kpis.length > 0) {
    const kpiHeader = ws.addRow(['Indicador', 'Valor', 'Variacao']);
    kpiHeader.font = { bold: true };
    for (const k of args.kpis) ws.addRow([k.label, k.valor, k.delta]);
    ws.addRow([]);
  }

  if (args.tabela.length > 0) {
    const colunas = Object.keys(args.tabela[0]);
    const header = ws.addRow(colunas);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    });
    for (const linha of args.tabela) {
      ws.addRow(colunas.map((c) => linha[c] ?? ''));
    }
    colunas.forEach((c, i) => {
      ws.getColumn(i + 1).width = Math.min(40, Math.max(12, c.length + 10));
    });
  } else {
    ws.addRow(['Sem linhas no periodo selecionado.']);
  }

  const buffer =
    args.formato === 'csv'
      ? Buffer.from((await wb.csv.writeBuffer()) as unknown as Uint8Array)
      : Buffer.from((await wb.xlsx.writeBuffer()) as unknown as Uint8Array);
  const extensao = args.formato === 'csv' ? 'csv' : 'xlsx';
  return {
    base64: buffer.toString('base64'),
    nome: `${slugArquivo(args.titulo)}.${extensao}`,
  };
}