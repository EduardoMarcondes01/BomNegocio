const express = require('express');
const { supabase, supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sgMail = require('@sendgrid/mail');

console.log('=== INICIALIZAÇÃO DO MÓDULO CADASTRO ===');
console.log('Data/Hora:', new Date().toISOString());
console.log('APP_URL configurada?', !!process.env.APP_URL);
console.log('APP_URL valor:', process.env.APP_URL || 'NÃO DEFINIDA');

// Configuração do Multer - MOVER PARA ANTES DA CLASSE
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

class EmailServico {
  constructor() {
    console.log('=== CONSTRUTOR EmailServico ===');
    console.log('SENDGRID_API_KEY disponível?', !!process.env.SENDGRID_API_KEY);
    console.log('SENDGRID_API_KEY (primeiros 10 chars):', process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY.substring(0, 10) + '...' : 'NÃO DEFINIDA');
    console.log('SMTP_FROM:', process.env.SMTP_FROM);
    console.log('APP_URL:', process.env.APP_URL);
    
    // Validar APP_URL - CRÍTICO PARA LINKS DE VERIFICAÇÃO
    if (!process.env.APP_URL) {
      console.error('⚠️  AVISO: APP_URL não definida. Links de verificação podem não funcionar.');
    }
    
    if (!process.env.SENDGRID_API_KEY) {
      console.error('❌ ERRO CRÍTICO: SENDGRID_API_KEY não configurada');
      throw new Error('SENDGRID_API_KEY não configurada');
    }
    
    try {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      console.log('✓ SendGrid API Key configurada com sucesso');
    } catch (error) {
      console.error('❌ Erro ao configurar SendGrid:', error.message);
      throw error;
    }
  }

  async enviarEmailVerificacao(destinatario, token) {
    console.log('\n=== ENVIAR EMAIL VERIFICAÇÃO ===');
    console.log('Destinatário:', destinatario);
    console.log('Token:', token.substring(0, 10) + '...');
    
    try {
      // Verificar se APP_URL está definida
      if (!process.env.APP_URL) {
        throw new Error('APP_URL não configurada no ambiente');
      }
      
      const verificationLink = `${process.env.APP_URL}/api/cadastro/verify-email?token=${token}`;
      console.log('Link de verificação:', verificationLink);

      const msg = {
        to: destinatario,
        from: process.env.SMTP_FROM,
        subject: 'Verifique seu email - BomNegócio',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; }
              .button { 
                display: inline-block; 
                padding: 12px 24px; 
                background: #4CAF50; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 20px 0; 
              }
              .footer { 
                margin-top: 20px; 
                padding: 20px; 
                background: #eee; 
                text-align: center; 
                font-size: 12px; 
                color: #666; 
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Bem-vindo ao BomNegócio!</h1>
              </div>
              <div class="content">
                <h2>Quase lá!</h2>
                <p>Obrigado por se cadastrar no BomNegócio. Para completar seu cadastro, precisamos verificar seu endereço de email.</p>
                
                <p style="text-align: center;">
                  <a href="${verificationLink}" class="button">
                    Verificar Email
                  </a>
                </p>
                
                <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
                <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 5px;">
                  ${verificationLink}
                </p>
                
                <p><strong>Este link expira em 24 horas.</strong></p>
                
                <p>Se você não solicitou este cadastro, ignore este email.</p>
              </div>
              <div class="footer">
                <p>&copy; 2024 BomNegócio. Todos os direitos reservados.</p>
                <p>Este é um email automático, por favor não responda.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Bem-vindo ao BomNegócio!\n\nPor favor, verifique seu email acessando este link: ${verificationLink}\n\nEste link expira em 24 horas.\n\nSe você não solicitou este cadastro, ignore este email.`
      };

      console.log('Enviando email via SendGrid...');
      console.log('From:', msg.from);
      console.log('To:', msg.to);
      
      const response = await sgMail.send(msg);
      console.log('✓ Email enviado com sucesso!');
      console.log('Resposta SendGrid:', {
        statusCode: response[0]?.statusCode,
        headers: response[0]?.headers
      });

    } catch (error) {
      console.error('❌ ERRO NO ENVIO DE EMAIL:', error);
      console.error('Detalhes do erro:', {
        message: error.message,
        code: error.code,
        response: error.response ? {
          statusCode: error.response.statusCode,
          body: error.response.body
        } : 'Sem resposta',
        stack: error.stack
      });
      
      if (error.response) {
        console.error('Headers:', error.response.headers);
        console.error('Body completo:', JSON.stringify(error.response.body, null, 2));
      }
      
      throw new Error(`Falha no envio do email de verificação: ${error.message}`);
    }
  }

  async enviarEmailBoasVindas(destinatario, nome) {
    console.log('\n=== ENVIAR EMAIL BOAS-VINDAS ===');
    console.log('Destinatário:', destinatario);
    console.log('Nome:', nome);
    
    try {
      const msg = {
        to: destinatario,
        from: process.env.SMTP_FROM,
        subject: 'Bem-vindo ao BomNegócio!',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; }
              .footer { 
                margin-top: 20px; 
                padding: 20px; 
                background: #eee; 
                text-align: center; 
                font-size: 12px; 
                color: #666; 
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Bem-vindo ao BomNegócio, ${nome}!</h1>
              </div>
              <div class="content">
                <h2>Sua conta foi ativada com sucesso! 🎉</h2>
                <p>Estamos muito felizes em tê-lo(a) conosco. Agora você pode:</p>
                <ul>
                  <li>Publicar seus produtos para venda</li>
                  <li>Explorar produtos perto de você</li>
                  <li>Conversar com outros usuários</li>
                  <li>Salvar seus produtos favoritos</li>
                </ul>
                <p>Comece agora mesmo explorando as melhores oportunidades perto de você!</p>
                <p><a href="${process.env.APP_URL || 'https://seusite.com'}">Acessar BomNegócio</a></p>
              </div>
              <div class="footer">
                <p>&copy; 2024 BomNegócio. Todos os direitos reservados.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      console.log('Enviando email de boas-vindas...');
      const response = await sgMail.send(msg);
      console.log('✓ Email de boas-vindas enviado!');
      console.log('Status:', response[0]?.statusCode);

    } catch (error) {
      console.error('❌ Erro ao enviar email de boas-vindas:', error.message);
      console.error('Detalhes:', error.response ? error.response.body : 'Sem resposta detalhada');
      // Não lançamos erro aqui para não interromper o fluxo de verificação
    }
  }

  async verificarConexao() {
    console.log('\n=== VERIFICAR CONEXÃO SENDGRID ===');
    
    try {
      console.log('Enviando email de teste...');
      console.log('From:', process.env.SMTP_FROM);
      console.log('To: test@example.com');
      
      await sgMail.send({
        to: 'test@example.com',
        from: process.env.SMTP_FROM,
        subject: 'Teste de conexão',
        text: 'Teste'
      });
      
      console.log('✓ Conexão com SendGrid OK!');
      return true;
    } catch (error) {
      console.error('❌ FALHA NA CONEXÃO COM SENDGRID:');
      console.error('Mensagem:', error.message);
      console.error('Código:', error.code);
      
      if (error.response) {
        console.error('Status Code:', error.response.statusCode);
        console.error('Body:', error.response.body);
        console.error('Headers:', error.response.headers);
      }
      
      return false;
    }
  }
}

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

console.log('Criando instância do EmailServico...');
const emailServico = new EmailServico();
console.log('✓ EmailServico criado com sucesso\n');

const router = express.Router();

console.log('Configurando rotas...');

router.post('/', upload.single('foto_perfil'), handleMulterError, async (req, res) => {
  console.log('\n=== NOVA REQUISIÇÃO DE CADASTRO ===');
  console.log('Data/Hora:', new Date().toISOString());
  console.log('IP:', req.ip);
  console.log('Body recebido:', {
    ...req.body,
    senha: req.body.senha ? '***' : 'não informada'
  });
  
  try {
    const userData = req.body;
    const fotoPerfil = req.file;
    
    if (fotoPerfil) {
      console.log('Arquivo recebido:', {
        nome: fotoPerfil.originalname,
        tamanho: fotoPerfil.size,
        mimetype: fotoPerfil.mimetype
      });
    } else {
      console.log('Nenhum arquivo recebido');
    }

    const { isValid, errors } = validateInput(userData);
    if (!isValid) {
      console.log('❌ Validação falhou:', errors);
      return res.status(400).json({
        success: false,
        errors,
        message: 'Dados de cadastro inválidos'
      });
    }

    console.log('✓ Validação dos dados OK');

    const { data: existingUser, error: emailError } = await supabase
      .from('usuarios')
      .select('id, email_verified')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (emailError) {
      console.error('❌ Erro ao verificar email no Supabase:', emailError);
      throw new Error('Erro interno ao verificar cadastro');
    }

    if (existingUser) {
      console.log('⚠️  Email já cadastrado:', {
        id: existingUser.id,
        email_verified: existingUser.email_verified
      });
      return res.status(409).json({
        success: false,
        error: 'Este email já está cadastrado',
        field: 'email',
        isVerified: existingUser.email_verified,
        message: existingUser.email_verified
          ? 'Este email já está em uso. Por favor, faça login.'
          : 'Este email já está cadastrado mas não foi verificado. Verifique seu email ou redefina sua senha.'
      });
    }

    console.log('✓ Email não cadastrado - prosseguindo');

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(userData.senha, salt);

    let imagem_url = null;
    if (fotoPerfil) {
      try {
        console.log('Processando upload da imagem...');
        const fileExt = path.extname(fotoPerfil.originalname).toLowerCase();
        const fileName = `user-${uuidv4()}${fileExt}`;
        const filePath = `profile-pictures/${fileName}`;

        console.log('Bucket: usuarios');
        console.log('Caminho:', filePath);

        const { error: uploadError } = await supabaseAdmin.storage
          .from('usuarios')
          .upload(filePath, fotoPerfil.buffer, {
            contentType: fotoPerfil.mimetype,
            cacheControl: '3600',
            upsert: false,
            duplex: 'half'
          });

        if (uploadError) {
          console.error('❌ Erro no upload:', uploadError);
          throw new Error('Falha ao processar imagem de perfil');
        }

        console.log('✓ Upload da imagem concluído');

        const { data: { publicUrl } } = await supabaseAdmin
          .storage
          .from('usuarios')
          .getPublicUrl(filePath);

        imagem_url = publicUrl;
        console.log('URL pública gerada:', imagem_url);

      } catch (uploadError) {
        console.error('❌ Erro no processamento da imagem:', uploadError);
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar imagem de perfil',
          message: 'Não foi possível salvar sua foto de perfil. Por favor, tente novamente.'
        });
      }
    }

    const verificationToken = uuidv4();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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
      verification_token: verificationToken,
      verification_token_expires_at: verificationExpires,
      email_verified: false,
      preferred_language: 'pt-BR',
      timezone: 'America/Sao_Paulo'
    };

    console.log('Inserindo usuário no banco...');
    console.log('Dados do usuário (sem senha):', {
      ...userToInsert,
      senha_hash: '***'
    });

    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('usuarios')
      .insert(userToInsert)
      .select(`
        id, 
        nome, 
        email, 
        imagem_url, 
        cidade,
        verification_token
      `)
      .single();

    if (dbError) {
      console.error('❌ Erro ao inserir no banco:', dbError);
      throw new Error('Erro ao criar conta de usuário');
    }

    console.log('✓ Usuário criado no banco:', {
      id: newUser.id,
      nome: newUser.nome,
      email: newUser.email
    });

    try {
      console.log('\n--- INICIANDO ENVIO DE EMAIL ---');
      console.log('Verificando conexão com SendGrid...');
      
      const conexaoOk = await emailServico.verificarConexao();
      if (!conexaoOk) {
        console.error('❌ Conexão com SendGrid falhou');
        throw new Error('Serviço de email temporariamente indisponível');
      }

      console.log('Enviando email de verificação...');
      await emailServico.enviarEmailVerificacao(newUser.email, newUser.verification_token);
      console.log('✓ Email de verificação enviado com sucesso!');

    } catch (emailError) {
      console.error('\n❌❌❌ ERRO CRÍTICO NO ENVIO DE EMAIL ❌❌❌');
      console.error('Mensagem:', emailError.message);
      
      console.log('Tentando reverter cadastro (deletar usuário)...');
      const { error: deleteError } = await supabaseAdmin
        .from('usuarios')
        .delete()
        .eq('id', newUser.id);

      if (deleteError) {
        console.error('⚠️  Não foi possível deletar o usuário:', deleteError);
      } else {
        console.log('✓ Usuário deletado do banco');
      }

      return res.status(500).json({
        success: false,
        error: 'Falha no envio do email de verificação',
        message: 'Não foi possível enviar o email de verificação. Por favor, tente novamente mais tarde.'
      });
    }

    console.log('\n=== CADASTRO CONCLUÍDO COM SUCESSO ===');
    console.log('Usuário ID:', newUser.id);
    console.log('Status: 201 Created\n');

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: newUser.id,
          nome: newUser.nome,
          email: newUser.email,
          imagem_url: newUser.imagem_url
        }
      },
      message: 'Cadastro realizado com sucesso! Verifique seu email para ativar sua conta.'
    });

  } catch (error) {
    console.error('\n❌❌❌ ERRO NÃO TRATADO NO CADASTRO ❌❌❌');
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    console.error('Tipo:', error.constructor.name);
    
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      message: 'Ocorreu um erro ao processar seu cadastro. Por favor, tente novamente mais tarde.'
    });
  }
});

router.get('/verify-email', async (req, res) => {
  console.log('\n=== VERIFICAÇÃO DE EMAIL VIA LINK ===');
  console.log('Token recebido:', req.query.token);
  console.log('Query params:', req.query);
  
  try {
    const { token } = req.query;

    if (!token) {
      console.log('❌ Token não fornecido');
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegócio</title></head>
        <body>
          <h1 style="color: red;">❌ Token de verificação não fornecido</h1>
          <p>Por favor, use o link completo do email.</p>
        </body>
        </html>
      `);
    }

    console.log('Buscando usuário com token...');
    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email, verification_token_expires_at, email_verified')
      .eq('verification_token', token)
      .single();

    if (userError || !user) {
      console.log('❌ Usuário não encontrado ou erro:', userError);
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegócio</title></head>
        <body>
          <h1 style="color: red;">❌ Token de verificação inválido</h1>
          <p>Este link de verificação é inválido ou já foi usado.</p>
        </body>
        </html>
      `);
    }

    console.log('Usuário encontrado:', {
      id: user.id,
      nome: user.nome,
      email_verified: user.email_verified
    });

    if (user.email_verified) {
      console.log('⚠️  Email já verificado anteriormente');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Email já verificado - BomNegócio</title></head>
        <body>
          <h1 style="color: green;">✓ Email já verificado</h1>
          <p>Seu email já foi verificado anteriormente. Você já pode fazer login.</p>
        </body>
        </html>
      `);
    }

    const now = new Date();
    const expiresAt = new Date(user.verification_token_expires_at);

    if (now > expiresAt) {
      console.log('❌ Token expirado:', {
        agora: now.toISOString(),
        expira: expiresAt.toISOString()
      });
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegócio</title></head>
        <body>
          <h1 style="color: red;">❌ Token expirado</h1>
          <p>Este link de verificação expirou. Solicite um novo link.</p>
        </body>
        </html>
      `);
    }

    console.log('Atualizando usuário como verificado...');
    const { error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update({
        email_verified: true,
        email_verified_at: now.toISOString(),
        verification_token: null,
        verification_token_expires_at: null
      })
      .eq('verification_token', token);

    if (updateError) {
      console.error('❌ Erro ao atualizar usuário:', updateError);
      throw updateError;
    }

    console.log('✓ Email verificado com sucesso');
    console.log('Enviando email de boas-vindas...');

    try {
      await emailServico.enviarEmailBoasVindas(user.email, user.nome);
    } catch (emailError) {
      console.error('⚠️  Erro ao enviar email de boas-vindas:', emailError.message);
    }

    console.log('✓ Processo de verificação concluído');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verificado - BomNegócio</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
            max-width: 500px;
          }
          .success { 
            color: #4CAF50; 
            font-size: 32px; 
            margin-bottom: 20px;
          }
          .button {
            display: inline-block;
            padding: 15px 30px;
            background: #4CAF50;
            color: white;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            margin-top: 20px;
            transition: all 0.3s ease;
          }
          .button:hover {
            background: #45a049;
            transform: translateY(-2px);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✓</div>
          <h1>Email verificado com sucesso!</h1>
          <p>Sua conta foi ativada com sucesso. Agora você pode fazer login no aplicativo e começar a usar o BomNegócio.</p>
          <a href="bomnegocio://login" class="button">Abrir App e Fazer Login</a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('❌ Erro na verificação de email:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Erro - BomNegócio</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1 style="color: red;">❌ Erro ao verificar email</h1>
        <p>Ocorreu um erro ao verificar seu email. Por favor, tente novamente.</p>
        <p><small>Se o problema persistir, entre em contato conosco.</small></p>
      </body>
      </html>
    `);
  }
});

router.post('/reenviar-verificacao', async (req, res) => {
  console.log('\n=== REENVIO DE VERIFICAÇÃO ===');
  console.log('Email solicitado:', req.body.email);
  
  try {
    const { email } = req.body;

    if (!email) {
      console.log('❌ Email não fornecido');
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      });
    }

    console.log('Buscando usuário com email:', email);
    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email_verified, verification_token, verification_token_expires_at')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !user) {
      console.log('❌ Usuário não encontrado:', userError);
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    console.log('Usuário encontrado:', {
      id: user.id,
      email_verified: user.email_verified
    });

    if (user.email_verified) {
      console.log('⚠️  Email já verificado');
      return res.status(400).json({
        success: false,
        error: 'Email já verificado'
      });
    }

    const newToken = uuidv4();
    const newExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    console.log('Gerando novo token:', newToken.substring(0, 10) + '...');
    console.log('Nova expiração:', newExpiration);

    const { error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update({
        verification_token: newToken,
        verification_token_expires_at: newExpiration
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Erro ao atualizar token:', updateError);
      throw updateError;
    }

    console.log('Enviando novo email de verificação...');
    await emailServico.enviarEmailVerificacao(user.email, newToken);

    console.log('✓ Email reenviado com sucesso');
    res.status(200).json({
      success: true,
      message: 'Email de verificação reenviado com sucesso!'
    });

  } catch (error) {
    console.error('❌ Erro no reenvio:', error);
    res.status(500).json({
      success: false,
      error: 'Erro ao reenviar email de verificação'
    });
  }
});

console.log('✓ Rotas configuradas');
console.log('=== MÓDULO CADASTRO PRONTO ===\n');

module.exports = router;
