import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  await p.$connect();
  
  const units = await p.unidade.findMany({
    select: { id: true, simbolo: true, fatorCanonico: true, dimensaoId: true }
  });
  
  console.log('Unidades no banco de dados:');
  if (units.length === 0) {
    console.log('  (nenhuma unidade encontrada)');
  } else {
    units.forEach(u => {
      console.log(`  ID: ${u.id}, Simbolo: ${u.simbolo}, FatorCanonico: ${u.fatorCanonico}, DimensaoId: ${u.dimensaoId}`);
    });
  }
  
  const producto = await p.produto.findFirst({
    where: { nome: { contains: 'Cafe' } },
    select: { id: true, nome: true, unidade: true, unidadeBaseId: true }
  });
  
  console.log('\nProduto de exemplo:');
  if (producto) {
    console.log(`  ID: ${producto.id}, Nome: ${producto.nome}, Unidade: ${producto.unidade}, UnidadeBaseId: ${producto.unidadeBaseId}`);
  } else {
    console.log('  (nenhum produto encontrado)');
  }
  
  await p.$disconnect();
}

main();