import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  await p.$connect();
  
  // Check if units already exist
  const existingUnits = await p.unidade.count();
  if (existingUnits > 0) {
    console.log(`${existingUnits} unidades já existentes. Pular criação.`);
    await p.$disconnect();
    return;
  }
  
  // Create a test enterprise if it doesn't exist
  let empresa = await p.empresa.findFirst({
    where: { nome: { contains: 'Teste' } }
  });
  
  if (!empresa) {
    empresa = await p.empresa.create({
      data: {
        nome: 'Empresa Teste',
        cnpj: '11222333000100',
      }
    });
    console.log('Criada empresa de teste');
  }
  
  // Define base units with their canonical factors as strings
  // The canonical unit for each dimension has fatorCanonico = "1"
  // For MASSA (mass): kg is canonical, g = "0.001"
  // For VOLUME (volume): L is canonical, mL = "0.001"
  // For CONTAGEM (count): UN is canonical
  
  const unitsData = [
    // Mass dimension
    { simbolo: 'kg', nome: 'Quilograma', fatorCanonico: '1', dimensaoId: 'massa' },
    { simbolo: 'g', nome: 'Gram', fatorCanonico: '0.001', dimensaoId: 'massa' },
    { simbolo: 'hg', nome: 'Hectograma', fatorCanonico: '0.1', dimensaoId: 'massa' },
    { simbolo: 'mg', nome: 'Miligrama', fatorCanonico: '0.000001', dimensaoId: 'massa' },
    // Volume dimension
    { simbolo: 'L', nome: 'Litro', fatorCanonico: '1', dimensaoId: 'volume' },
    { simbolo: 'mL', nome: 'Mililitro', fatorCanonico: '0.001', dimensaoId: 'volume' },
    { simbolo: 'cx', nome: 'Caixa', fatorCanonico: '1', dimensaoId: 'contagem' },
    { simbolo: 'UN', nome: 'Unidade', fatorCanonico: '1', dimensaoId: 'contagem' },
    { simbolo: 'dz', nome: 'Dúzia', fatorCanonico: '12', dimensaoId: 'contagem' },
    { simbolo: 'saco', nome: 'Saco', fatorCanonico: '1', dimensaoId: 'contagem' },
  ];
  
  // Create dimensions first if they don't exist
  const dimensaoMap = {};
  
  for (const unitData of unitsData) {
    // Find or create the dimension
    let dimensao = await p.dimensao.findFirst({
      where: { empresaId: empresa.id, codigo: unitData.dimensaoId }
    });
    
    if (!dimensao) {
      dimensao = await p.dimensao.create({
        data: {
          nome: unitData.dimensaoId,
          codigo: unitData.dimensaoId,
          empresaId: empresa.id,
        }
      });
      console.log(`Criada dimensão: ${unitData.dimensaoId}`);
    }
    
    dimensaoMap[unitData.dimensaoId] = dimensao.id;
    
    // Create the unit with empresaId and dimensaoId
    await p.unidade.create({
      data: {
        simbolo: unitData.simbolo,
        nome: unitData.nome,
        empresaId: empresa.id,
        dimensaoId: dimensao.id,
        fatorCanonico: unitData.fatorCanonico,
        ativo: true,
      }
    });
    
    console.log(`Criada unidade: ${unitData.simbolo} (${unitData.nome})`);
  }
  
  console.log('\nUnidades configuradas com sucesso!');
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error('Erro:', e);
  await p.$disconnect();
  process.exit(1);
});