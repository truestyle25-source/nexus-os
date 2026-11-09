const fs = require('fs');
const path = require('path');

// Verificar primeiras linhas do page.tsx
const pagePath = 'c:\\Users\\samue\\OneDrive\\Documentos\\GitHub\\nexus-os\\frontend\\app\\(dashboard)\\pdv\\page.tsx';
try {
  const content = fs.readFileSync(pagePath, 'utf8');
  const lines = content.split('\n');
  console.log('=== Primeiras 5 linhas do page.tsx ===');
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    console.log((i+1) + ': ' + lines[i].substring(0, 100));
  }
} catch(e) {
  console.log('Erro ao ler page.tsx:', e.message);
}

// Verificar tsconfig
const tsconfigPaths = [
  'c:\\Users\\samue\\OneDrive\\Documentos\\GitHub\\nexus-os\\frontend\\tsconfig.json',
  'c:\\Users\\samue\\OneDrive\\Documentos\\GitHub\\nexus-os\\tsconfig.json',
];
for (const p of tsconfigPaths) {
  console.log('\ntsconfig existe em ' + p + ': ' + fs.existsSync(p));
  if (fs.existsSync(p)) {
    const tc = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log('JSX config:', tc.compilerOptions?.jsx);
    console.log('Include:', tc.include);
  }
}