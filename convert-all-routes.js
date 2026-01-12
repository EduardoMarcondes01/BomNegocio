// convert-all-routes.js
const fs = require('fs');
const path = require('path');

function convertFile(filePath) {
  console.log(`🔧 Convertendo: ${path.basename(filePath)}`);
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    // 1. Converter imports ES6 para require
    content = content.replace(/const express = require('express');/g, "const express = require('express');");
    content = content.replace(/import \{ Router \} from 'express';/g, "const { Router } = require('express');");
    
    // 2. Converter imports de outros arquivos
    content = content.replace(/import \{ (\w+) \} from '([^']+)';/g, "const { $1 } = require('$2');");
    content = content.replace(/import (\w+) from '([^']+)';/g, "const $1 = require('$2');");
    
    // 3. Converter exports
    content = content.replace(/export default (\w+);/g, "module.exports = $1;");
    content = content.replace(/export \{ (\w+(?:, \w+)*) \};/g, "module.exports = { $1 };");
    
    // 4. Converter export const para module.exports
    content = content.replace(/export const (\w+) =/g, "const $1 =");
    
    // Adicionar module.exports no final se tiver export const mas não tiver module.exports
    if (content.match(/const (\w+) =/g) && !content.includes('module.exports')) {
      const constMatches = [...content.matchAll(/const (\w+) =/g)];
      const constNames = constMatches.map(m => m[1]).filter(name => name !== 'require');
      
      if (constNames.length > 0) {
        content += `\n\nmodule.exports = { ${constNames.join(', ')} };`;
      }
    }
    
    // Se houve alteração, salvar
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`   ✅ Convertido`);
    } else {
      console.log(`   ⏩ Já está em CommonJS`);
    }
    
    return true;
  } catch (error) {
    console.log(`   ❌ Erro: ${error.message}`);
    return false;
  }
}

// Converter todos os arquivos .js na pasta routes
const routesDir = path.join(__dirname, 'routes');

if (!fs.existsSync(routesDir)) {
  console.log('❌ Pasta routes não encontrada!');
  process.exit(1);
}

const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
console.log(`\n📁 Encontrados ${files.length} arquivos em routes/`);

let converted = 0;
let errors = 0;

files.forEach(file => {
  const filePath = path.join(routesDir, file);
  const success = convertFile(filePath);
  
  if (success) converted++;
  else errors++;
});

console.log(`\n📊 Resultado:`);
console.log(`✅ Convertidos: ${converted}`);
console.log(`❌ Erros: ${errors}`);
console.log(`\n🎉 Conversão concluída!`);
