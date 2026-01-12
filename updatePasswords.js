const { createClient  } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testConnection() {
  const { data, error } = await supabase.from('usuarios').select('*').limit(1);
  if (error) {
    console.error('❌ Erro ao conectar ao Supabase:', error);
  } else {
    console.log('✅ Conexão bem-sucedida:', data);
    atualizarSenhas(); // Chama a função para atualizar as senhas
  }
}

async function atualizarSenhas() {
  console.log('🔄 Atualizando TODAS as senhas para "Marcondes1"...');
  
  // Lista de IDs dos 3 usuários (substitua com os IDs reais se necessário)
  const usuariosAlvo = [
    '6b8ac99c-ca0c-44b3-95da-fa12b132e119', // José
    '9fdac208-57df-47e8-80d5-477b91492652', // Jaine
    'd0e9dc74-9d42-4d1d-b61c-6509e1537e7b'  // Eduardo
  ];

  // Gera o hash da nova senha (único para todos)
  const novaSenhaHash = await bcrypt.hash("Marcondes1", 10);
  console.log(`🔑 Hash da nova senha: ${novaSenhaHash}`);

  for (const userId of usuariosAlvo) {
    const { error } = await supabase
      .from('usuarios')
      .update({ senha: novaSenhaHash })
      .eq('id', userId);

    if (error) {
      console.error(`❌ Erro ao atualizar senha do usuário ${userId}:`, error);
    } else {
      console.log(`✅ Senha do usuário ${userId} atualizada para "Marcondes1"!`);
    }
  }

  console.log('🎉 Todas as senhas foram atualizadas!');
}

testConnection();

module.exports = { bcrypt, dotenv, supabase, usuariosAlvo, novaSenhaHash };