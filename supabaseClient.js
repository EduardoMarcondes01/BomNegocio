const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Verificação das variáveis de ambiente
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente normal (para frontend - com RLS)
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// Cliente admin (para backend - bypass RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Teste de conexão
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .limit(1);
    
    if (error) throw error;
  } catch (error) {
    throw error;
  }
}

// Executar teste ao iniciar (apenas em desenvolvimento)
if (process.env.NODE_ENV === 'development') {
  testConnection();
}

// Exportar ambos os clientes
module.exports = { supabase, supabaseAdmin };
