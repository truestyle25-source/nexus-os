const { execSync } = require('child_process');
const path = 'c:\\Users\\samue\\OneDrive\\Documentos\\GitHub\\nexus-os\\frontend';

try {
  console.log('Iniciando build do Next.js...');
  const result = execSync('node_modules\\.bin\\next build', {
    cwd: path,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 300000
  });
  console.log('BUILD RESULTADO:');
  console.log(result);
  console.log('\n✅ BUILD CONCLUÍDO COM SUCESSO!');
} catch(e) {
  console.log('BUILD ERRO (código ' + e.status + '):');
  console.log('--- STDOUT ---');
  if (e.stdout) console.log(e.stdout);
  console.log('--- STDERR ---');
  if (e.stderr) console.log(e.stderr);
}