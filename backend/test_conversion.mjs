import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

p.$connect().then(async () => {
  try {
    const u1 = await p.unidade.findFirst({ where: { simbolo: 'g', ativo: true } })
    console.log('Unidade g:', u1)
    
    const u2 = await p.unidade.findFirst({ where: { simbolo: 'kg', ativo: true } })
    console.log('Unidade kg:', u2)
    
    // Test converterUnidade function
    const { converterUnidade } = await import('./src/modules/estoque/conversao.service.js')
    
    const result = await converterUnidade({
      empresaId: '1',
      produtoId: '1',
      quantidade: 350,
      unidadeOrigemSimbolo: 'g',
      unidadeDestinoSimbolo: 'kg',
    })
    console.log('Conversao 350g -> kg:', result)
    
    const result2 = await converterUnidade({
      empresaId: '1',
      produtoId: '1',
      quantidade: 1000,
      unidadeOrigemSimbolo: 'g',
      unidadeDestinoSimbolo: 'kg',
    })
    console.log('Conversao 1000g -> kg:', result2)
    
    // Test 1kg -> g
    const result3 = await converterUnidade({
      empresaId: '1',
      produtoId: '1',
      quantidade: 1,
      unidadeOrigemSimbolo: 'kg',
      unidadeDestinoSimbolo: 'g',
    })
    console.log('Conversao 1kg -> g:', result3)
    
    // Test 0.5kg -> g
    const result4 = await converterUnidade({
      empresaId: '1',
      produtoId: '1',
      quantidade: 0.5,
      unidadeOrigemSimbolo: 'kg',
      unidadeDestinoSimbolo: 'g',
    })
    console.log('Conversao 0.5kg -> g:', result4)
    
    // Test 250g -> kg
    const result5 = await converterUnidade({
      empresaId: '1',
      produtoId: '1',
      quantidade: 250,
      unidadeOrigemSimbolo: 'g',
      unidadeDestinoSimbolo: 'kg',
    })
    console.log('Conversao 250g -> kg:', result5)
    
  } catch (err) {
    console.error('Error:', err)
  } finally {
    p.$disconnect()
  }
}).catch(err => console.error('Connection error:', err))