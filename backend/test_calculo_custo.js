import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

async function main() {
  await p.$connect()
  
  // Test: Verify the cost medio ponderado calculation
  // Initial: 10 kg at R$4.00/kg = R$40.00
  // Entrada: 20 kg with total cost R$88.00
  // Expected: 30 kg, total R$128.00, average R$4.266667/kg
  
  // Calculate weighted average (mathematical verification)
  const initialQtd = 10
  const initialCustoUnit = 4.00
  const entradaQtd = 20
  const entradaValorTotal = 88.00
  
  const totalQtd = initialQtd + entradaQtd
  const totalValor = (initialQtd * initialCustoUnit) + entradaValorTotal
  const custoMedio = totalValor / totalQtd
  
  console.log('Weighted Average Calculation (mathematical verification):')
  console.log(`Initial: ${initialQtd} kg × R$${initialCustoUnit}/kg = R$${initialQtd * initialCustoUnit}`)
  console.log(`Entrada: ${entradaQtd} kg, total R$${entradaValorTotal}`)
  console.log(`Total: ${totalQtd} kg, total R$${totalValor}`)
  console.log(`Custo Médio: R$${custoMedio.toFixed(6)}/kg`)
  console.log(`Expected: R$${(4 + 88/30).toFixed(6)}/kg (approx R$4.266667)`)
  console.log(`Match: ${Math.abs(custoMedio - (4 + 88/30)) < 0.0001}`)
  
  // Also verify the expected values
  console.log('\nVerification of expected values:')
  console.log(`30 kg × R$4.266667 = R$${(30 * 4.266667).toFixed(2)} (expected R$128.00)`)
  console.log(`R$128.00 / 30 kg = R$${(128/30).toFixed(6)}/kg`)
  
  await p.$disconnect()
}

main().catch(e => {
  console.error(e)
  p.$disconnect()
  process.exit(1)
})