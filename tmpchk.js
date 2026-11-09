const fs=require('fs');  
const b=fs.readFileSync('frontend/app/(dashboard)/pdv/page.tsx');  
console.log(b.slice(0,80).toString('utf8'));  
console.log('bytes',b.length);  
