const express = require('express');
const { supabase, supabaseAdmin  } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sgMail = require('@sendgrid/mail');

class EmailServico {
  constructor() {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY nÃ£o configurada');
    }
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }

  async enviarEmailVerificacao(destinatario, token) {
    try {
      const verificationLink = `${process.env.APP_URL}/api/cadastro/verify-email?token=${token}`;

      const msg = {
        to: destinatario,
        from: process.env.SMTP_FROM,
        subject: 'Verifique seu email - BomNegÃ³cio',
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
                <h1>Bem-vindo ao BomNegÃ³cio!</h1>
              </div>
              <div class="content">
                <h2>Quase lÃ¡!</h2>
                <p>Obrigado por se cadastrar no BomNegÃ³cio. Para completar seu cadastro, precisamos verificar seu endereÃ§o de email.</p>
                
                <p style="text-align: center;">
                  <a href="${verificationLink}" class="button">
                    Verificar Email
                  </a>
                </p>
                
                <p>Se o botÃ£o nÃ£o funcionar, copie e cole este link no seu navegador:</p>
                <p style="word-break: break-all; background: #eee; padding: 10px; border-radius: 5px;">
                  ${verificationLink}
                </p>
                
                <p><strong>Este link expira em 24 horas.</strong></p>
                
                <p>Se vocÃª nÃ£o solicitou este cadastro, ignore este email.</p>
              </div>
              <div class="footer">
                <p>&copy; 2024 BomNegÃ³cio. Todos os direitos reservados.</p>
                <p>Este Ã© um email automÃ¡tico, por favor nÃ£o responda.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `Bem-vindo ao BomNegÃ³cio!\n\nPor favor, verifique seu email acessando este link: ${verificationLink}\n\nEste link expira em 24 horas.\n\nSe vocÃª nÃ£o solicitou este cadastro, ignore este email.`
      };

      await sgMail.send(msg);

    } catch (error) {
      throw new Error('Falha no envio do email de verificaÃ§Ã£o');
    }
  }

  async enviarEmailBoasVindas(destinatario, nome) {
    try {
      const msg = {
        to: destinatario,
        from: process.env.SMTP_FROM,
        subject: 'Bem-vindo ao BomNegÃ³cio!',
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
                <h1>Bem-vindo ao BomNegÃ³cio, ${nome}!</h1>
              </div>
              <div class="content">
                <h2>Sua conta foi ativada com sucesso! ðŸŽ‰</h2>
                <p>Estamos muito felizes em tÃª-lo(a) conosco. Agora vocÃª pode:</p>
                <ul>
                  <li>Publicar seus produtos para venda</li>
                  <li>Explorar produtos perto de vocÃª</li>
                  <li>Conversar com outros usuÃ¡rios</li>
                  <li>Salvar seus produtos favoritos</li>
                </ul>
                <p>Comece agora mesmo explorando as melhores oportunidades perto de vocÃª!</p>
                <p><a href="${process.env.APP_URL}">Acessar BomNegÃ³cio</a></p>
              </div>
              <div class="footer">
                <p>&copy; 2024 BomNegÃ³cio. Todos os direitos reservados.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      await sgMail.send(msg);

    } catch (error) {
    }
  }

  async verificarConexao() {
    try {
      await sgMail.send({
        to: 'test@example.com',
        from: process.env.SMTP_FROM,
        subject: 'Teste de conexÃ£o',
        text: 'Teste'
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

const emailServico = new EmailServico();

const router = express.Router();

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Apenas imagens sÃ£o permitidas (JPEG, JPG, PNG, GIF)'));
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
        error: 'Tamanho mÃ¡ximo de arquivo excedido (5MB)'
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
      errors[field] = `${field.charAt(0).toUpperCase() + field.slice(1)} Ã© obrigatÃ³rio`;
    }
  });

  if (data.email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(data.email.trim())) {
      errors.email = 'Por favor, insira um email vÃ¡lido';
    }
  }

  if (data.senha) {
    if (data.senha.length < 8) {
      errors.senha = 'A senha deve ter pelo menos 8 caracteres';
    } else if (!/[A-Z]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos uma letra maiÃºscula';
    } else if (!/[0-9]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos um nÃºmero';
    } else if (!/[^A-Za-z0-9]/.test(data.senha)) {
      errors.senha = 'A senha deve conter pelo menos um caractere especial';
    }
  }

  if (data.idade) {
    const age = parseInt(data.idade, 10);
    if (isNaN(age)) {
      errors.idade = 'Idade deve ser um nÃºmero vÃ¡lido';
    } else if (age < 13) {
      errors.idade = 'VocÃª deve ter pelo menos 13 anos para se cadastrar';
    } else if (age > 120) {
      errors.idade = 'Por favor, insira uma idade vÃ¡lida';
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

router.post('/', upload.single('foto_perfil'), handleMulterError, async (req, res) => {
  try {
    const userData = req.body;
    const fotoPerfil = req.file;

    const { isValid, errors } = validateInput(userData);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        errors,
        message: 'Dados de cadastro invÃ¡lidos'
      });
    }

    const { data: existingUser, error: emailError } = await supabase
      .from('usuarios')
      .select('id, email_verified')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (emailError) {
      throw new Error('Erro interno ao verificar cadastro');
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Este email jÃ¡ estÃ¡ cadastrado',
        field: 'email',
        isVerified: existingUser.email_verified,
        message: existingUser.email_verified
          ? 'Este email jÃ¡ estÃ¡ em uso. Por favor, faÃ§a login.'
          : 'Este email jÃ¡ estÃ¡ cadastrado mas nÃ£o foi verificado. Verifique seu email ou redefina sua senha.'
      });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(userData.senha, salt);

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
          message: 'NÃ£o foi possÃ­vel salvar sua foto de perfil. Por favor, tente novamente.'
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
      throw new Error('Erro ao criar conta de usuÃ¡rio');
    }

    try {
      const conexaoOk = await emailServico.verificarConexao();
      if (!conexaoOk) {
        throw new Error('ServiÃ§o de email temporariamente indisponÃ­vel');
      }

      await emailServico.enviarEmailVerificacao(newUser.email, newUser.verification_token);

    } catch (emailError) {
      await supabaseAdmin
        .from('usuarios')
        .delete()
        .eq('id', newUser.id);

      return res.status(500).json({
        success: false,
        error: 'Falha no envio do email de verificaÃ§Ã£o',
        message: 'NÃ£o foi possÃ­vel enviar o email de verificaÃ§Ã£o. Por favor, tente novamente mais tarde.'
      });
    }

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
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      message: 'Ocorreu um erro ao processar seu cadastro. Por favor, tente novamente mais tarde.'
    });
  }
});

router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegÃ³cio</title></head>
        <body>
          <h1 style="color: red;">âŒ Token de verificaÃ§Ã£o nÃ£o fornecido</h1>
          <p>Por favor, use o link completo do email.</p>
        </body>
        </html>
      `);
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email, verification_token_expires_at, email_verified')
      .eq('verification_token', token)
      .single();

    if (userError || !user) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegÃ³cio</title></head>
        <body>
          <h1 style="color: red;">âŒ Token de verificaÃ§Ã£o invÃ¡lido</h1>
          <p>Este link de verificaÃ§Ã£o Ã© invÃ¡lido ou jÃ¡ foi usado.</p>
        </body>
        </html>
      `);
    }

    if (user.email_verified) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Email jÃ¡ verificado - BomNegÃ³cio</title></head>
        <body>
          <h1 style="color: green;">âœ… Email jÃ¡ verificado</h1>
          <p>Seu email jÃ¡ foi verificado anteriormente. VocÃª jÃ¡ pode fazer login.</p>
        </body>
        </html>
      `);
    }

    const now = new Date();
    const expiresAt = new Date(user.verification_token_expires_at);

    if (now > expiresAt) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Erro - BomNegÃ³cio</title></head>
        <body>
          <h1 style="color: red;">âŒ Token expirado</h1>
          <p>Este link de verificaÃ§Ã£o expirou. Solicite um novo link.</p>
        </body>
        </html>
      `);
    }

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
      throw updateError;
    }

    try {
      await emailServico.enviarEmailBoasVindas(user.email, user.nome);
    } catch (emailError) {
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verificado - BomNegÃ³cio</title>
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
          <div class="success">âœ…</div>
          <h1>Email verificado com sucesso!</h1>
          <p>Sua conta foi ativada com sucesso. Agora vocÃª pode fazer login no aplicativo e comeÃ§ar a usar o BomNegÃ³cio.</p>
          <a href="bomnegocio://login" class="button">Abrir App e Fazer Login</a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Erro - BomNegÃ³cio</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1 style="color: red;">âŒ Erro ao verificar email</h1>
        <p>Ocorreu um erro ao verificar seu email. Por favor, tente novamente.</p>
        <p><small>Se o problema persistir, entre em contato conosco.</small></p>
      </body>
      </html>
    `);
  }
});

router.post('/reenviar-verificacao', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email Ã© obrigatÃ³rio'
      });
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email_verified, verification_token, verification_token_expires_at')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: 'UsuÃ¡rio nÃ£o encontrado'
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email jÃ¡ verificado'
      });
    }

    const newToken = uuidv4();
    const newExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update({
        verification_token: newToken,
        verification_token_expires_at: newExpiration
      })
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    await emailServico.enviarEmailVerificacao(user.email, newToken);

    res.status(200).json({
      success: true,
      message: 'Email de verificaÃ§Ã£o reenviado com sucesso!'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao reenviar email de verificaÃ§Ã£o'
    });
  }
});

module.exports = router;

