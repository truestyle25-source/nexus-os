// Lê a saída de `npm audit --json` e falha se houver vulnerabilidade ALTA ou CRÍTICA
// em pacote fora da lista de exceções informada.
// Uso: node scripts/verificar-auditoria.cjs audit.json [exceção ...]
const fs = require('fs');

const [arquivo, ...excecoes] = process.argv.slice(2);
const permitidas = new Set(excecoes);
const auditoria = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const graves = Object.entries(auditoria.vulnerabilities || {}).filter(([, v]) => ['high', 'critical'].includes(v.severity));

for (const [nome, v] of graves) {
  console.log(`${permitidas.has(nome) ? 'exceção conhecida' : 'BLOQUEIA         '}  ${v.severity.padEnd(8)}  ${nome}`);
}
const bloqueiam = graves.filter(([nome]) => !permitidas.has(nome));
if (bloqueiam.length) {
  console.error(`${bloqueiam.length} vulnerabilidade(s) alta/crítica fora das exceções (${[...permitidas].join(', ') || 'nenhuma'}).`);
  process.exit(1);
}
console.log(`ok: ${graves.length} alta/crítica, todas nas exceções conhecidas.`);
