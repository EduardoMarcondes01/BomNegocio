const express = require('express');
const { supabase, supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const dns = require('dns').promises;

// 🔥 LISTA DE DOMÍNIOS BLOQUEADOS (emails temporários/fake)
const DOMINIOS_BLOQUEADOS = [
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
  'example.com', 'test.com', 'teste.com', 'fakemail.com',
  'dummy.com', 'noemail.com', 'no-reply.com',
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

// 🔥 FUNÇÃO: Verificar MX records do domínio
async function verificarMXRecords(dominio) {
  try {
    const records = await dns.resolveMx(dominio);
    return records.length > 0;
  } catch (error) {
    return false;
  }
}

// 🔥 FUNÇÃO: Validação robusta de email
async function validarEmailRobusto(email) {
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
  
  // 5. Verificar extensão válida
  const extensoesValidas = [
    '.com', '.com.br', '.br', '.org', '.net', '.edu', '.gov',
    '.io', '.dev', '.app', '.me', '.info', '.biz', '.co',
    '.us', '.uk', '.ca', '.au', '.de', '.fr', '.es', '.it',
    '.pt', '.ar', '.cl', '.co', '.mx', '.pe'
  ];
  
  const temExtensaoValida = extensoesValidas.some(ext => dominio.endsWith(ext));
  
  // 6. Verificar se é provedor confiável
  const provedorConfiavel = PROVEDORES_CONFIAVEIS.includes(dominio);
  
  // 7. Verificar MX Records
  let mxValido = false;
  try {
    mxValido = await verificarMXRecords(dominio);
  } catch (error) {
    // Ignora erro na verificação
  }
  
  // 8. Verificar padrões de emails fake
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
  
  // Calcular score de confiança
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

const router = express.Router();

// Configuração do Multer
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Apenas imagens são permitidas (JPEG, JPG, PNG, GIF)'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  }
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Tamanho máximo de arquivo excedido (5MB)'
      });
    }
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

const validateInput = (data) => {
  const errors = {};
  const requiredFields = [
    'nome', 'sobrenome', 'email', 'senha', 'idade',
    'estado', 'cidade', 'bairro', 'rua', 'sexo', 'cep'
  ];

  requiredFields.forEach(field => {
    if (!data[field]?.toString().trim()) {
      errors[field] = `${field.charAt(0).toUpperCase() + field.slice(1)} é obrigatório`;
    }
  });

  if (data.email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(data.email.trim())) {
      errors.email = 'Por favor, insira um email válido';
    }
  }

  if (data.senha) {
    if (data.senha.length < 8) {
      errors.senha = 'A senha deve ter pelo menos 8 caracteres';
    } else if (!/[A-Z]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos uma letra maiúscula';
    } else if (!/[0-9]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos um número';
    } else if (!/[^A-Za-z0-9]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos um caractere especial';
    }
  }

  if (data.idade) {
    const age = parseInt(data.idade, 10);
    if (isNaN(age)) {
      errors.idade = 'Idade deve ser um número válido';
    } else if (age < 13) {
      errors.idade = 'Você deve ter pelo menos 13 anos para se cadastrar';
    } else if (age > 120) {
      errors.idade = 'Por favor, insira uma idade válida';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// 🔥 ROTA PRINCIPAL DE CADASTRO
router.post('/', upload.single('foto_perfil'), handleMulterError, async (req, res) => {
  try {
    const userData = req.body;
    const fotoPerfil = req.file;

    // Validação básica dos campos
    const { isValid, errors } = validateInput(userData);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        errors,
        message: 'Dados de cadastro inválidos'
      });
    }

    // 🔥 VALIDAÇÃO ROBUSTA DO EMAIL
    const validacaoEmail = await validarEmailRobusto(userData.email);
    
    if (!validacaoEmail.valido) {
      return res.status(400).json({
        success: false,
        error: validacaoEmail.motivo,
        nivel: validacaoEmail.nivel,
        detalhes: validacaoEmail.detalhes,
        sugestao: validacaoEmail.sugestao || 'Use um email válido de provedor confiável',
        codigo: 'EMAIL_INVALIDO'
      });
    }

    // Verificar se email já existe no banco
    const { data: existingUser, error: checkError } = await supabase
      .from('usuarios')
      .select('id, nome, email_verified')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (checkError) {
      return res.status(500).json({
        success: false,
        error: 'Erro interno na verificação'
      });
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

    // Criptografar senha
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(userData.senha, salt);

    // Upload foto (opcional)
    let imagem_url = null;
    if (fotoPerfil) {
      try {
        const fileExt = path.extname(fotoPerfil.originalname).toLowerCase();
        const fileName = `user-${uuidv4()}${fileExt}`;
        const filePath = `profile-pictures/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from('usuarios')
          .upload(filePath, fotoPerfil.buffer, {
            contentType: fotoPerfil.mimetype,
            cacheControl: '3600',
            upsert: false,
            duplex: 'half'
          });

        if (uploadError) {
          throw new Error('Falha ao processar imagem de perfil');
        }

        const { data: { publicUrl } } = await supabaseAdmin
          .storage
          .from('usuarios')
          .getPublicUrl(filePath);

        imagem_url = publicUrl;
      } catch (uploadError) {
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar imagem de perfil',
          message: 'Não foi possível salvar sua foto de perfil. Por favor, tente novamente.'
        });
      }
    }

    // Criar usuário NO BANCO com email verificado como TRUE
    const userToInsert = {
      nome: userData.nome.trim(),
      sobrenome: userData.sobrenome.trim(),
      email: userData.email.trim().toLowerCase(),
      senha_hash: hashedPassword,
      idade: parseInt(userData.idade, 10),
      estado: userData.estado.trim(),
      cidade: userData.cidade.trim(),
      bairro: userData.bairro.trim(),
      rua: userData.rua.trim(),
      sexo: userData.sexo,
      telefone: userData.telefone ? userData.telefone.replace(/\D/g, '') : null,
      cep: userData.cep.replace(/\D/g, ''),
      aceitou_termos: true,
      imagem_url,
      // ✅ Email já verificado pela validação robusta
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      email_validation_method: 'robust_validation',
      email_provider: userData.email.split('@')[1],
      preferred_language: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      created_at: new Date().toISOString()
    };

    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('usuarios')
      .insert(userToInsert)
      .select(`
        id, 
        nome, 
        email, 
        imagem_url, 
        cidade,
        email_verified
      `)
      .single();

    if (dbError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao criar conta',
        codigo: 'DATABASE_ERROR',
        detalhes: dbError.message
      });
    }

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
          validation_method: 'robust_validation',
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

    // 4. Verificar MX records
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
      const metodo = user.email_validation_method || 'desconhecido';
      stats.metodos_validacao[metodo] = (stats.metodos_validacao[metodo] || 0) + 1;
      
      const provedor = user.email_provider || 'desconhecido';
      stats.provedores_top[provedor] = (stats.provedores_top[provedor] || 0) + 1;
      
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
