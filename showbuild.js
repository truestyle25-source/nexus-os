const fs = require('fs');
const l = fs.readFileSync('buildout.txt','utf8').split(/\r?\n/);
console.log(l.slice(-40).join('\n'));
