const fs = require('fs');
const path = require('path');

// Read the file
const filePath = path.join('components', 'relatorios', 'FormularioDisc.tsx');
const buf = fs.readFileSync(filePath);
const totalBytes = buf.length;

console.log('=== FormularioDisc.tsx Encoding Analysis ===');
console.log('Total bytes:', totalBytes);

// Find problematic bytes - look for common Windows-1252 chars that are invalid in UTF-8
// 0x97 = § (section sign) in Win1252
// 0xfa = ú in Win1252
// 0xe3, etc. = accented chars

// Try to decode as windows-1252 and re-encode as utf-8
try {
  const text = buf.toString('win1252');
  const fixedBuf = Buffer.from(text, 'utf-8');
  const fixedPath = filePath.replace('.tsx', '.fixed.tsx');
  fs.writeFileSync(fixedPath, fixedBuf);
  console.log('Fixed file written to:', fixedPath);
  console.log('Fixed bytes:', fixedBuf.length);
  
  // Verify the fixed file has valid UTF-8
  let errors = 0;
  for (let i = 0; i < fixedBuf.length; i++) {
    const b = fixedBuf[i];
    if (b < 0x80) { continue; }
    if (b >= 0xC2 && b <= 0xDF) {
      if (i + 1 >= fixedBuf.length) { errors++; continue; }
      const second = fixedBuf[i + 1];
      if (second < 0x80 || second > 0xBF) { errors++; }
      else i += 2; continue;
    }
    if (b >= 0xE0 && b <= 0xEF) {
      if (i + 2 >= fixedBuf.length) { errors++; continue; }
      const second = fixedBuf[i + 1];
      const third = fixedBuf[i + 2];
      if (second < 0x80 || second > 0xBF || third < 0x80 || third > 0xBF) { errors++; }
      else i += 3; continue;
    }
    if (b >= 0xF0 && b <= 0xF4) {
      if (i + 3 >= fixedBuf.length) { errors++; continue; }
      i += 4; continue;
    }
    errors++;
  }
  console.log('UTF-8 validity errors after fix:', errors);
  console.log('Fix successful:', errors === 0);
} catch (e) {
  console.log('Error during fix:', e.message);
}