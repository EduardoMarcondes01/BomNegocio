const express = require('express');
const { supabase, supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dns = require('dns').promises;

console.log('=== CADASTRO COM VALIDAÇÃO ROBUSTA DE EMAIL ===');

// Configuração do Multer
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Apenas imagens são permitidas'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: 'Erro no upload da imagem'
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  next();
};

const router = express.Router();

// 🔥 LISTA DE DOMÍNIOS BLOQUEADOS (emails temporários/fake)
const DOMINIOS_BLOQUEADOS = [
  // Serviços de email temporário
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'mailinator.com', 'mailinator.net', 'mailinator.org',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'sharklasers.com', 'guerrillamail.biz',
  '10minutemail.com', '10minutemail.net',
  'temp-mail.org', 'temp-mail.ru', 'tempmail.com',
  'tempail.com', 'tempemail.net',
  'throwawaymail.com', 'trashmail.com',
  'fakeinbox.com', 'getairmail.com',
  'mintemail.com', 'jetable.org',
  
  // Domínios comuns de spam
  'example.com', 'test.com', 'teste.com', 'fakemail.com',
  'dummy.com', 'noemail.com', 'no-reply.com',
  
  // Domínios inválidos/não-existentes
  'localhost.com', '127.0.0.1.com', 'invalid.com'
];

// 🔥 LISTA DE PROVEDORES VÁLIDOS (confiáveis)
const PROVEDORES_CONFIAVEIS = [
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.com.br', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'bol.com.br', 'uol.com.br', 'ig.com.br', 'terra.com.br',
  'globo.com', 'oi.com.br', 'r7.com',
  'aol.com', 'zoho.com', 'protonmail.com', 'proton.me',
  'mail.com', 'gmx.com', 'gmx.net'
];

// 🔥 FUNÇÃO: Verificar MX records do domínio (se tem servidor de email)
async function verificarMXRecords(dominio) {
  try {
    const records = await dns.resolveMx(dominio);
    return records.length > 0;
  } catch (error) {
    // Se não encontrar MX records, domínio não existe ou não aceita email
    return false;
  }
}

// 🔥 FUNÇÃO: Validação SUPER ROBUSTA de email
async function validarEmailRobusto(email) {
  console.log(`🔍 Validando email: ${email}`);
  
  const emailLower = email.trim().toLowerCase();
  
  // 1. Verificar formato básico
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(emailLower)) {
    return { 
      valido: false, 
      nivel: 'formato',
      motivo: 'Formato de email inválido',
      detalhes: 'Use formato: usuario@dominio.com'
    };
  }
  
  const [usuario, dominio] = emailLower.split('@');
  
  // 2. Verificar se domínio está na lista de bloqueados
  if (DOMINIOS_BLOQUEADOS.includes(dominio)) {
    return {
      valido: false,
      nivel: 'dominio_bloqueado',
      motivo: 'Domínio de email temporário não permitido',
      detalhes: `O domínio "${dominio}" é de serviço de email temporário`,
      sugestao: 'Use um email permanente (Gmail, Outlook, etc)'
    };
  }
  
  // 3. Verificar comprimento do usuário e domínio
  if (usuario.length < 1 || usuario.length > 64) {
    return {
      valido: false,
      nivel: 'usuario_invalido',
      motivo: 'Nome de usuário muito curto ou muito longo',
      detalhes: `O nome "${usuario}" deve ter entre 1 e 64 caracteres`
    };
  }
  
  if (dominio.length < 3 || dominio.length > 255) {
    return {
      valido: false,
      nivel: 'dominio_invalido',
      motivo: 'Domínio muito curto ou muito longo'
    };
  }
  
  // 4. Verificar caracteres inválidos no usuário
  const usuarioRegex = /^[a-zA-Z0-9._%+-]+$/;
  if (!usuarioRegex.test(usuario)) {
    return {
      valido: false,
      nivel: 'caracteres_invalidos',
      motivo: 'Caracteres inválidos no nome de usuário',
      detalhes: 'Use apenas letras, números, ponto, hífen e sublinhado'
    };
  }
  
  // 5. Verificar se domínio tem extensão válida
  const extensoesValidas = [
    '.com', '.com.br', '.br', '.org', '.net', '.edu', '.gov',
    '.io', '.dev', '.app', '.me', '.info', '.biz', '.co',
    '.us', '.uk', '.ca', '.au', '.de', '.fr', '.es', '.it',
    '.pt', '.ar', '.cl', '.co', '.mx', '.pe'
  ];
  
  const temExtensaoValida = extensoesValidas.some(ext => dominio.endsWith(ext));
  if (!temExtensaoValida) {
    console.log(`⚠️  Domínio com extensão incomum: ${dominio}`);
    // Não bloqueia, apenas registra
  }
  
  // 6. Verificar se é provedor confiável
  const provedorConfiavel = PROVEDORES_CONFIAVEIS.includes(dominio);
  
  // 7. 🔥 VERIFICAR MX RECORDS (se domínio tem servidor de email)
  let mxValido = false;
  try {
    mxValido = await verificarMXRecords(dominio);
    console.log(`📡 MX Records para ${dominio}: ${mxValido ? 'VÁLIDO' : 'INVÁLIDO'}`);
  } catch (error) {
    console.log(`⚠️  Não foi possível verificar MX para ${dominio}: ${error.message}`);
  }
  
  // 8. Verificar padrões comuns de emails fake
  const padroesFake = [
    /^teste?[0-9]*@/i,
    /^exemplo?[0-9]*@/i,
    /^fake?[0-9]*@/i,
    /^admin?[0-9]*@/i,
    /^user?[0-9]*@/i,
    /^demo?[0-9]*@/i,
    /^temp?[0-9]*@/i
  ];
  
  const pareceFake = padroesFake.some(pattern => pattern.test(emailLower));
  
  // 🔥 RESULTADO FINAL DA VALIDAÇÃO
  if (!mxValido && !provedorConfiavel) {
    return {
      valido: false,
      nivel: 'mx_invalido',
      motivo: 'Domínio não possui servidor de email válido',
      detalhes: `O domínio "${dominio}" não aceita emails`,
      sugestao: 'Verifique se digitou corretamente ou use outro email'
    };
  }
  
  if (pareceFake) {
    console.log(`⚠️  Email com padrão suspeito: ${emailLower}`);
    // Não bloqueia, mas registra
  }
  
  // Calcular "score" de confiança
  let score = 0;
  if (provedorConfiavel) score += 30;
  if (mxValido) score += 40;
  if (temExtensaoValida) score += 20;
  if (!pareceFake) score += 10;
  
  const nivelConfianca = score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'baixo';
  
  return {
    valido: true,
    nivel: 'validado',
    motivo: 'Email válido',
    detalhes: {
      dominio: dominio,
      provedor_confiavel: provedorConfiavel,
      mx_records: mxValido,
      extensao_valida: temExtensaoValida,
      padrao_suspeito: pareceFake,
      score_confianca: score,
      nivel_confianca: nivelConfianca
    }
  };
}

// 🔥 ROTA PRINCIPAL: Cadastro com validação robusta
router.post('/', upload.single('foto_perfil'), handleMulterError, async (req, res) => {
  console.log('\n📝 CADASTRO COM VALIDAÇÃO ROBUSTA');
  console.log('Email:', req.body.email);
  console.log('IP:', req.ip);
  
  try {
    const userData = req.body;
    const fotoPerfil = req.file;

    // Validação básica dos campos
    const camposObrigatorios = ['email', 'senha', 'nome', 'idade', 'cidade'];
    const camposFaltando = camposObrigatorios.filter(campo => !userData[campo]);
    
    if (camposFaltando.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios faltando',
        campos: camposFaltando,
        message: `Preencha: ${camposFaltando.join(', ')}`
      });
    }

    // 🔥 VALIDAÇÃO ROBUSTA DO EMAIL
    const validacaoEmail = await validarEmailRobusto(userData.email);
    
    if (!validacaoEmail.valido) {
      console.log(`❌ Email rejeitado: ${validacaoEmail.motivo}`);
      console.log(`   Detalhes: ${validacaoEmail.detalhes}`);
      
      // Log para monitoramento
      console.log('📊 LOG REJEIÇÃO:', {
        email: userData.email,
        ip: req.ip,
        motivo: validacaoEmail.motivo,
        nivel: validacaoEmail.nivel,
        timestamp: new Date().toISOString()
      });
      
      return res.status(400).json({
        success: false,
        error: validacaoEmail.motivo,
        nivel: validacaoEmail.nivel,
        detalhes: validacaoEmail.detalhes,
        sugestao: validacaoEmail.sugestao || 'Use um email válido de provedor confiável',
        codigo: 'EMAIL_INVALIDO'
      });
    }

    console.log(`✅ Email aceito! Confiança: ${validacaoEmail.detalhes?.nivel_confianca || 'N/A'}`);
    console.log('   Detalhes validação:', validacaoEmail.detalhes);

    // Verificar se email já existe no banco
    const { data: existingUser, error: checkError } = await supabase
      .from('usuarios')
      .select('id, nome, email_verified')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (checkError) {
      console.error('❌ Erro ao verificar email no banco:', checkError);
      throw new Error('Erro interno na verificação');
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Este email já está cadastrado',
        email_ja_verificado: existingUser.email_verified,
        sugestao: existingUser.email_verified 
          ? 'Faça login ou recupere sua senha' 
          : 'Este email já foi cadastrado mas não foi verificado'
      });
    }

    // Validar senha robustamente
    if (userData.senha.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Senha muito curta',
        detalhes: 'A senha deve ter pelo menos 8 caracteres'
      });
    }
    
    // Verificar força da senha
    const temMaiuscula = /[A-Z]/.test(userData.senha);
    const temMinuscula = /[a-z]/.test(userData.senha);
    const temNumero = /[0-9]/.test(userData.senha);
    
    if (!temMaiuscula || !temMinuscula || !temNumero) {
      return res.status(400).json({
        success: false,
        error: 'Senha fraca',
        detalhes: 'Use letras maiúsculas, minúsculas e números',
        requisitos: {
          maiuscula: temMaiuscula,
          minuscula: temMinuscula,
          numero: temNumero
        }
      });
    }

    // Criptografar senha
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(userData.senha, salt);

    // Upload foto (opcional)
    let imagem_url = null;
    if (fotoPerfil) {
      try {
        console.log('📸 Processando foto de perfil...');
        const fileExt = path.extname(fotoPerfil.originalname).toLowerCase();
        const fileName = `user-${uuidv4()}${fileExt}`;
        const filePath = `profile-pictures/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from('usuarios')
          .upload(filePath, fotoPerfil.buffer, {
            contentType: fotoPerfil.mimetype,
            cacheControl: '3600'
          });

        if (uploadError) {
          console.error('❌ Erro no upload da foto:', uploadError);
        } else {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from('usuarios')
            .getPublicUrl(filePath);
          imagem_url = publicUrl;
          console.log('✅ Foto salva:', publicUrl);
        }
      } catch (error) {
        console.error('❌ Erro no processamento da foto:', error.message);
      }
    }

    // Criar usuário NO BANCO
    const userToInsert = {
      nome: userData.nome.trim(),
      sobrenome: userData.sobrenome?.trim() || '',
      email: userData.email.trim().toLowerCase(),
      senha_hash: hashedPassword,
      idade: parseInt(userData.idade) || 18,
      estado: userData.estado?.trim() || '',
      cidade: userData.cidade.trim(),
      bairro: userData.bairro?.trim() || '',
      rua: userData.rua?.trim() || '',
      sexo: userData.sexo || 'Não informado',
      telefone: userData.telefone?.replace(/\D/g, '') || null,
      cep: userData.cep?.replace(/\D/g, '') || '',
      aceitou_termos: true,
      imagem_url,
      email_verified: true,  // ✅ Verificado pela validação robusta
      email_validation_method: validacaoEmail.nivel,
      email_confidence_score: validacaoEmail.detalhes?.score_confianca || 0,
      email_provider: validacaoEmail.detalhes?.dominio || '',
      registration_ip: req.ip,
      user_agent: req.headers['user-agent'] || '',
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString()
    };

    console.log('💾 Salvando usuário no banco...');
    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('usuarios')
      .insert(userToInsert)
      .select(`
        id, 
        nome, 
        email, 
        imagem_url, 
        cidade,
        email_verified,
        email_validation_method
      `)
      .single();

    if (dbError) {
      console.error('❌ Erro ao salvar no banco:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao criar conta',
        codigo: 'DATABASE_ERROR',
        detalhes: dbError.message
      });
    }

    console.log(`✅ Usuário criado com sucesso! ID: ${newUser.id}`);
    
    // 🔥 LOG DE SUCESSO
    console.log('📊 LOG CADASTRO BEM SUCEDIDO:', {
      user_id: newUser.id,
      email: newUser.email,
      nome: newUser.nome,
      cidade: newUser.cidade,
      ip: req.ip,
      validacao: validacaoEmail.nivel,
      score_confianca: validacaoEmail.detalhes?.score_confianca,
      timestamp: new Date().toISOString()
    });
    
    // 🔥 RESPOSTA DE SUCESSO
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: newUser.id,
          nome: newUser.nome,
          email: newUser.email,
          imagem_url: newUser.imagem_url,
          cidade: newUser.cidade,
          email_verified: newUser.email_verified,
          validation_method: newUser.email_validation_method,
          pode_logar: true
        },
        validacao: {
          nivel: validacaoEmail.nivel,
          confianca: validacaoEmail.detalhes?.nivel_confianca,
          score: validacaoEmail.detalhes?.score_confianca,
          provedor: validacaoEmail.detalhes?.dominio
        }
      },
      message: '✅ Conta criada com sucesso!',
      status: 'active',
      next_steps: [
        'Você já pode fazer login',
        'Complete seu perfil para melhores resultados',
        'Adicione produtos para começar a vender'
      ]
    });

  } catch (error) {
    console.error('❌ ERRO NO CADASTRO:', error);
    
    // Log detalhado do erro
    console.error('📊 LOG ERRO:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      email: req.body?.email || 'N/A'
    });
    
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      codigo: 'INTERNAL_ERROR',
      message: 'Tente novamente em alguns instantes'
    });
  }
});

// 🔥 ROTA: Verificar email antes do cadastro (para frontend)
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      });
    }

    // 1. Validar formato básico rápido
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim().toLowerCase())) {
      return res.json({
        success: false,
        valido: false,
        motivo: 'Formato de email inválido',
        pode_tentar: false
      });
    }

    const dominio = email.split('@')[1].toLowerCase();
    
    // 2. Verificar domínios bloqueados
    if (DOMINIOS_BLOQUEADOS.includes(dominio)) {
      return res.json({
        success: false,
        valido: false,
        motivo: 'Email temporário não permitido',
        detalhes: 'Use email permanente (Gmail, Outlook, etc)',
        pode_tentar: false
      });
    }

    // 3. Verificar se já existe no banco
    const { data: existingUser } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (existingUser) {
      return res.json({
        success: false,
        valido: false,
        motivo: 'Email já cadastrado',
        pode_tentar: false
      });
    }

    // 4. Verificar MX records (opcional - pode ser lento)
    let mxValido = false;
    try {
      mxValido = await verificarMXRecords(dominio);
    } catch (error) {
      // Ignora erro na verificação rápida
    }

    res.json({
      success: true,
      valido: true,
      detalhes: {
        dominio: dominio,
        mx_records: mxValido,
        provedor_confiavel: PROVEDORES_CONFIAVEIS.includes(dominio),
        disponivel: true
      },
      message: 'Email válido e disponível'
    });
    
  } catch (error) {
    console.error('Erro na verificação de email:', error);
    res.status(500).json({
      success: false,
      error: 'Erro na verificação'
    });
  }
});

// 🔥 ROTA: Dashboard de validação (para admin)
router.get('/validation-stats', async (req, res) => {
  try {
    // Pegar últimas 24h de cadastros
    const vinteQuatroHorasAtras = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const { data: recentUsers, error } = await supabase
      .from('usuarios')
      .select('email_validation_method, email_provider, created_at')
      .gte('created_at', vinteQuatroHorasAtras.toISOString())
      .limit(100);

    if (error) throw error;

    // Estatísticas
    const stats = {
      total: recentUsers?.length || 0,
      metodos_validacao: {},
      provedores_top: {},
      hora_pico: {}
    };

    recentUsers?.forEach(user => {
      // Método de validação
      const metodo = user.email_validation_method || 'desconhecido';
      stats.metodos_validacao[metodo] = (stats.metodos_validacao[metodo] || 0) + 1;
      
      // Provedor
      const provedor = user.email_provider || 'desconhecido';
      stats.provedores_top[provedor] = (stats.provedores_top[provedor] || 0) + 1;
      
      // Hora
      const hora = new Date(user.created_at).getHours();
      stats.hora_pico[hora] = (stats.hora_pico[hora] || 0) + 1;
    });

    res.json({
      success: true,
      periodo: 'Últimas 24 horas',
      estatisticas: stats,
      configuracoes: {
        dominios_bloqueados: DOMINIOS_BLOQUEADOS.length,
        provedores_confiaveis: PROVEDORES_CONFIAVEIS.length
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao obter estatísticas'
    });
  }
});

module.exports = router;
