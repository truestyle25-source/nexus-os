import { FastifyInstance } from "fastify"
import { prisma } from "../../lib/prisma.js"
import { permissaoMiddleware } from "../../middlewares/auth.js"
import { temPermissao } from "../../lib/permissoes.js"

// ───────────────────────────────────────────────────────────────────────────
// Helpers de período — sempre em horário local do servidor, nunca por
// toISOString, para não deslocar o dia em UTC-3.
// ───────────────────────────────────────────────────────────────────────────

/** Aceita "YYYY-MM-DD" ou ISO completo; null quando ausente/inválido. */
function parseData(valor?: string): Date | null {
  if (!valor || typeof valor !== "string") return null
  const somenteData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (somenteData) {
    const d = new Date(Number(somenteData[1]), Number(somenteData[2]) - 1, Number(somenteData[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Resolve o período da consulta. Sem parâmetros, usa o mês corrente — o
 * mesmo critério já usado pelo indicador "Faturamento do mês".
 * O fim é estendido até 23:59:59.999 do dia informado.
 */
function resolverPeriodo(periodoInicio?: string, periodoFim?: string) {
  const agora = new Date()
  const inicioBruto = parseData(periodoInicio)
  const fimBruto = parseData(periodoFim)

  const inicio = inicioBruto ?? new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0)
  const fim = fimBruto ?? agora
  fim.setHours(23, 59, 59, 999)

  return {
    inicio,
    fim,
    informado: Boolean(inicioBruto || fimBruto),
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0")
/** Chave local YYYY-MM-DD (nunca UTC). */
const chaveDia = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
/** Chave local YYYY-MM. */
const chaveMes = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
const arredondar = (n: number) => Math.round(n * 100) / 100
/** Data local → "YYYY-MM-DD" para devolver na resposta sem fuso. */
const dataLocal = (d: Date) => chaveDia(d)



export async function dashboardRealRoutes(app: FastifyInstance) {
  app.get(
    "/stats",
    {
      // Exige `dashboard:visualizar`, como `/serie` já exigia.
      //
      // A rota tinha APENAS `authenticate`: qualquer usuário logado — inclusive
      // um sem nenhuma permissão de módulo — recebia o faturamento do mês, as
      // vendas de hoje e as contagens de produtos e usuários da empresa. A
      // própria tela é rigorosa em esconder custo sem `custos:visualizar`, e
      // exibia faturamento para quem não pode ver nenhum número do caixa.
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware("dashboard", "visualizar"),
      ],
    },
    async (req: any, res) => {
      try {
        const empresaId = req.user?.empresaId

        if (!empresaId) {
          return res.status(401).send({
            message: "Empresa não identificada."
          })
        }

        const agora = new Date()

        const inicioMes = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          1,
          0,
          0,
          0,
          0
        )

        const inicioHoje = new Date(
          agora.getFullYear(),
          agora.getMonth(),
          agora.getDate(),
          0,
          0,
          0,
          0
        )

        const inicioAmanha = new Date(inicioHoje)
        inicioAmanha.setDate(inicioAmanha.getDate() + 1)

        const faturamentoMes = await prisma.venda.aggregate({
          _sum: {
            total: true
          },
          where: {
            empresaId,
            status: "FINALIZADA",
            createdAt: {
              gte: inicioMes
            }
          }
        })

        const vendasHoje = await prisma.venda.count({
          where: {
            empresaId,
            status: "FINALIZADA",
            createdAt: {
              gte: inicioHoje,
              lt: inicioAmanha
            }
          }
        })

        const produtosAtivos = await prisma.produto.count({
          where: {
            empresaId,
            status: "ATIVO"
          }
        })

        const usuariosAtivos = await prisma.usuario.count({
          where: {
            empresaId,
            status: "ATIVO"
          }
        })

        return {
          faturamentoMes: Number(faturamentoMes._sum.total ?? 0),
          vendasHoje,
          produtosAtivos,
          usuariosAtivos
        }
      } catch (error) {
        console.error("Erro ao carregar estatísticas do dashboard:", error)

        return res.status(500).send({
          message: "Erro ao carregar estatísticas do dashboard."
        })
      }
    }
  )
  /**
   * Série REAL para os gráficos do Dashboard (faturamento × CMV × lucro × margem).
   * Nada aqui é estimado: são vendas com status FINALIZADA da empresa no período,
   * agrupadas por dia ou por mês em horário local.
   *
   * Campos de custo (CMV/lucro/margem) só são calculados quando o usuário tem
   * `custos.visualizar` — sem isso a resposta traz null nesses campos, mesmo
   * padrão já usado em produtos.routes.ts e vendas.routes.ts.
   */
  app.get(
    "/serie",
    {
      preHandler: [
        (app as any).authenticate,
        await permissaoMiddleware("dashboard", "visualizar"),
      ],
    },
    async (req: any, res) => {
      try {
        const empresaId = req.user?.empresaId

        if (!empresaId) {
          return res.status(401).send({ message: "Empresa não identificada." })
        }

        const { periodoInicio, periodoFim, granularidade } = req.query as {
          periodoInicio?: string
          periodoFim?: string
          granularidade?: string
        }

        const { inicio, fim, informado } = resolverPeriodo(periodoInicio, periodoFim)
        const porDia = granularidade !== "mes"
        const podeVerCusto = await temPermissao(req.user.id, "custos", "visualizar")

        const vendas = await prisma.venda.findMany({
          where: {
            empresaId,
            status: "FINALIZADA",
            createdAt: { gte: inicio, lte: fim }
          },
          select: {
            clienteId: true,
            total: true,
            createdAt: true,
            itens: { select: { quantidade: true, custoUnitario: true } }
          },
          orderBy: { createdAt: "asc" }
        })

        // Buckets contínuos: dia (ou mês) sem venda aparece zerado em vez de
        // desaparecer do gráfico — o eixo não pode mentir.
        const chaveDe = porDia ? chaveDia : chaveMes
        const buckets = new Map<
          string,
          { periodo: string; faturamento: number; cmv: number; lucro: number; qtdVendas: number }
        >()

        if (porDia) {
          let dia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())
          const ultimo = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate())
          let guarda = 0
          while (dia <= ultimo && guarda < 400) {
            buckets.set(chaveDia(dia), {
              periodo: chaveDia(dia),
              faturamento: 0,
              cmv: 0,
              lucro: 0,
              qtdVendas: 0
            })
            dia = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate() + 1)
            guarda += 1
          }
        } else {
          let mes = new Date(inicio.getFullYear(), inicio.getMonth(), 1)
          const ultimo = new Date(fim.getFullYear(), fim.getMonth(), 1)
          let guarda = 0
          while (mes <= ultimo && guarda < 400) {
            buckets.set(chaveMes(mes), {
              periodo: chaveMes(mes),
              faturamento: 0,
              cmv: 0,
              lucro: 0,
              qtdVendas: 0
            })
            mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1)
            guarda += 1
          }
        }

        let faturamentoTotal = 0
        let cmvTotal = 0
        let qtdVendas = 0
        const clientesDistintos = new Set<string>()

        for (const venda of vendas) {
          const total = Number(venda.total ?? 0)
          const cmv = venda.itens.reduce(
            (soma, item) => soma + Number(item.custoUnitario ?? 0) * Number(item.quantidade ?? 0),
            0
          )
          const lucro = total - cmv

          faturamentoTotal += total
          cmvTotal += cmv
          qtdVendas += 1
          if (venda.clienteId) clientesDistintos.add(venda.clienteId)

          const bucket = buckets.get(chaveDe(venda.createdAt))
          if (bucket) {
            bucket.faturamento += total
            bucket.cmv += cmv
            bucket.lucro += lucro
            bucket.qtdVendas += 1
          }
        }

        const pontos = Array.from(buckets.values()).map((b) => ({
          periodo: b.periodo,
          faturamento: arredondar(b.faturamento),
          cmv: podeVerCusto ? arredondar(b.cmv) : null,
          lucro: podeVerCusto ? arredondar(b.lucro) : null,
          margem:
            podeVerCusto && b.faturamento > 0
              ? arredondar((b.lucro / b.faturamento) * 100)
              : null,
          qtdVendas: b.qtdVendas
        }))

        const lucroBrutoTotal = faturamentoTotal - cmvTotal
        const margemTotal = faturamentoTotal > 0 ? (lucroBrutoTotal / faturamentoTotal) * 100 : null
        const ticketMedio = qtdVendas > 0 ? faturamentoTotal / qtdVendas : null
        const diasNoPeriodo = Math.max(
          1,
          Math.round((fim.getTime() - inicio.getTime()) / 86400000)
        )

        // LTV realizado: faturamento FINALIZADO histórico ÷ clientes distintos
        // que já compraram. Não é projeção nem estimativa.
        const [historico, clientesComHistorico] = await Promise.all([
          prisma.venda.aggregate({
            where: { empresaId, status: "FINALIZADA" },
            _sum: { total: true }
          }),
          prisma.venda.findMany({
            where: { empresaId, status: "FINALIZADA", clienteId: { not: null } },
            select: { clienteId: true },
            distinct: ["clienteId"]
          })
        ])

        const faturamentoHistorico = Number(historico._sum.total ?? 0)
        const ltvRealizado =
          clientesComHistorico.length > 0 ? faturamentoHistorico / clientesComHistorico.length : null

        return {
          granularidade: porDia ? "dia" : "mes",
          periodoInicio: dataLocal(inicio),
          periodoFim: dataLocal(fim),
          periodoInformado: informado,
          permissaoCusto: podeVerCusto,
          pontos,
          totais: {
            faturamento: arredondar(faturamentoTotal),
            cmv: podeVerCusto ? arredondar(cmvTotal) : null,
            lucroBruto: podeVerCusto ? arredondar(lucroBrutoTotal) : null,
            margemBruta: podeVerCusto && margemTotal !== null ? arredondar(margemTotal) : null,
            qtdVendas,
            ticketMedio: ticketMedio === null ? null : arredondar(ticketMedio),
            vendasPorDia: arredondar(qtdVendas / diasNoPeriodo),
            clientesDistintos: clientesDistintos.size
          },
          ltv: {
            ltvRealizado: ltvRealizado === null ? null : arredondar(ltvRealizado),
            // CAC não é devolvido como número porque não existe: não há registro
            // de investimento em aquisição/campanha em nenhum módulo do sistema.
            cac: null,
            clientesComHistorico: clientesComHistorico.length,
            faturamentoHistorico: arredondar(faturamentoHistorico),
            observacao:
              "LTV realizado = faturamento FINALIZADO histórico ÷ clientes distintos que já compraram. CAC não é calculado: o sistema não registra investimento em aquisição/marketing."
          }
        }
      } catch (error) {
        console.error("Erro ao carregar série do dashboard:", error)

        return res.status(500).send({
          message: "Erro ao carregar série do dashboard."
        })
      }
    }
  )

}
