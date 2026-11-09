import {prisma} from "./src/lib/prisma.js";
prisma.$connect().then(async () => {
  const unidades = await prisma.unidade.findMany({ select: { id: true, simbolo: true, dimensaoId: true, fatorCanonico: true } });
  console.log('Unidades encontradas:');
  unidades.forEach(u => console.log("-", u.simbolo, "| dimensaoId:", u.dimensaoId, "| fatorCanonico:", u.fatorCanonico));
}).catch(e => console.error("Erro", e)).finally(() => prisma.$disconnect());