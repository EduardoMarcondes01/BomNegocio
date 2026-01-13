const express = require('express');
const { supabase, supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const sgMail = require('@sendgrid/mail');

class EmailServico {
  constructor() {
    console.log('🔧 Inicializando EmailServico...');
    console.log('📧 SENDGRID_API_KEY disponível:', !!process.env.SENDGRID_API_KEY);
    console.log('📧 SMTP_FROM disponível:', !!process.env.SMTP_FROM);
    console.log('🌐 APP_URL disponível:', !!process.env.APP_URL);
    
    if (!process.env.SENDGRID_API_KEY) {
      console.error('❌ ERRO CRÍTICO: SENDGRID_API_KEY não configurada');
      throw new Error('SENDGRID_API_KEY não configurada');
    }
    
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('✅ SendGrid configurado com sucesso');
  }

  async enviarEmailVerificacao(destinatario, token) {
    console.log(`📨 Iniciando envio de email para: ${destinatario}`);
    console.log(`🔑 Token gerado: ${token.substring(0, 10)}...`);
    
    try {
      const verificationLink = `${process.env.APP_URL}/api/cadastro/verify-email?token=${token}`;
      console.log(`🔗 Link de verificação: ${verificationLink}`);

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

      console.log('📤 Enviando email via SendGrid...');
      console.log('📝 Detalhes do email:', {
        to: msg.to,
        from: msg.from,
        subject: msg.subject
      });

      const response = await sgMail.send(msg);
      console.log('✅ Email enviado com sucesso!');
      console.log('📨 Status do SendGrid:', response[0]?.statusCode);
      console.log('📨 Headers:', response[0]?.headers);

    } catch (error) {
      console.error('❌ ERRO no envio do email:', error);
      console.error('❌ Detalhes do erro:', {
        message: error.message,
        code: error.code,
        response: error.response?.body,
        stack: error.stack
      });
      throw new Error('Falha no envio do email de verificação');
    }
  }

  async enviarEmailBoasVindas(destinatario, nome) {
    console.log(`📨 Enviando email de boas-vindas para: ${destinatario}`);
    
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
                <p><a href="${process.env.APP_URL}">Acessar BomNegócio</a></p>
              </div>
              <div class="footer">
                <p>&copy; 2024 BomNegócio. Todos os direitos reservados.</p>
              </div>
            </div>
          </body>
          </html>
        `
      };

      const response = await sgMail.send(msg);
      console.log('✅ Email de boas-vindas enviado!');
      console.log('📨 Status:', response[0]?.statusCode);

    } catch (error) {
      console.error('❌ ERRO ao enviar email de boas-vindas:', error.message);
      // Não lançar erro para não interromper o fluxo
    }
  }

  async verificarConexao() {
    console.log('🔍 Verificando conexão com SendGrid...');
    
    try {
      console.log('📧 Enviando email de teste...');
      console.log('📧 Para: test@example.com');
      console.log('📧 De:', process.env.SMTP_FROM);
      
      await sgMail.send({
        to: 'test@example.com',
        from: process.env.SMTP_FROM,
        subject: 'Teste de conexão - BomNegócio',
        text: 'Teste de conexão com SendGrid'
      });
      
      console.log('✅ Conexão com SendGrid OK!');
      return true;
    } catch (error) {
      console.error('❌ FALHA na conexão com SendGrid:', error.message);
      console.error('❌ Detalhes do erro:', {
        code: error.code,
        response: error.response?.body
      });
      return false;
    }
  }
}

const emailServico = new EmailServico();
const router = express.Router();

// ... (resto do código permanece igual até o endpoint POST)

router.post('/', upload.single('foto_perfil'), handleMulterError, async (req, res) => {
  console.log('🚀 Iniciando cadastro de usuário');
  console.log('📝 Dados recebidos:', {
    nome: req.body.nome,
    email: req.body.email,
    temFoto: !!req.file
  });

  try {
    const userData = req.body;
    const fotoPerfil = req.file;

    console.log('🔍 Validando dados de entrada...');
    const { isValid, errors } = validateInput(userData);
    if (!isValid) {
      console.log('❌ Validação falhou:', errors);
      return res.status(400).json({
        success: false,
        errors,
        message: 'Dados de cadastro inválidos'
      });
    }
    console.log('✅ Validação OK');

    console.log('🔍 Verificando se email já existe...');
    const { data: existingUser, error: emailError } = await supabase
      .from('usuarios')
      .select('id, email_verified')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (emailError) {
      console.error('❌ Erro ao verificar email:', emailError);
      throw new Error('Erro interno ao verificar cadastro');
    }

    if (existingUser) {
      console.log('⚠️ Email já cadastrado:', userData.email);
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
    console.log('✅ Email disponível');

    console.log('🔐 Gerando hash da senha...');
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(userData.senha, salt);

    let imagem_url = null;
    if (fotoPerfil) {
      try {
        console.log('🖼️ Processando foto de perfil...');
        const fileExt = path.extname(fotoPerfil.originalname).toLowerCase();
        const fileName = `user-${uuidv4()}${fileExt}`;
        const filePath = `profile-pictures/${fileName}`;

        console.log('📤 Fazendo upload para o Supabase Storage...');
        const { error: uploadError } = await supabaseAdmin.storage
          .from('usuarios')
          .upload(filePath, fotoPerfil.buffer, {
            contentType: fotoPerfil.mimetype,
            cacheControl: '3600',
            upsert: false,
            duplex: 'half'
          });

        if (uploadError) {
          console.error('❌ Erro no upload da imagem:', uploadError);
          throw new Error('Falha ao processar imagem de perfil');
        }

        const { data: { publicUrl } } = await supabaseAdmin
          .storage
          .from('usuarios')
          .getPublicUrl(filePath);

        imagem_url = publicUrl;
        console.log('✅ Foto de perfil salva:', publicUrl);
      } catch (uploadError) {
        console.error('❌ Erro ao processar imagem:', uploadError);
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar imagem de perfil',
          message: 'Não foi possível salvar sua foto de perfil. Por favor, tente novamente.'
        });
      }
    }

    const verificationToken = uuidv4();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    console.log('🔑 Token de verificação gerado:', verificationToken.substring(0, 10) + '...');

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

    console.log('💾 Salvando usuário no banco de dados...');
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
      console.error('❌ Erro ao salvar usuário:', dbError);
      throw new Error('Erro ao criar conta de usuário');
    }
    
    console.log('✅ Usuário criado com ID:', newUser.id);

    try {
      console.log('📧 Iniciando processo de envio de email...');
      const conexaoOk = await emailServico.verificarConexao();
      
      if (!conexaoOk) {
        console.error('❌ Conexão com SendGrid falhou!');
        throw new Error('Serviço de email temporariamente indisponível');
      }

      console.log('📤 Enviando email de verificação...');
      await emailServico.enviarEmailVerificacao(newUser.email, newUser.verification_token);
      console.log('✅ Processo de email concluído com sucesso!');

    } catch (emailError) {
      console.error('❌ ERRO CRÍTICO no envio do email:', emailError);
      
      console.log('🧹 Revertendo criação do usuário devido a falha no email...');
      await supabaseAdmin
        .from('usuarios')
        .delete()
        .eq('id', newUser.id);
      
      console.log('✅ Usuário removido do banco de dados');

      return res.status(500).json({
        success: false,
        error: 'Falha no envio do email de verificação',
        message: 'Não foi possível enviar o email de verificação. Por favor, tente novamente mais tarde.',
        debug: process.env.NODE_ENV === 'development' ? emailError.message : undefined
      });
    }

    console.log('🎉 Cadastro concluído com sucesso para:', newUser.email);
    
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
    console.error('💥 ERRO GERAL no cadastro:', error);
    console.error('💥 Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      message: 'Ocorreu um erro ao processar seu cadastro. Por favor, tente novamente mais tarde.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Adicione logs no endpoint de verificação de email também
router.get('/verify-email', async (req, res) => {
  console.log('🔍 Recebida requisição para verificar email');
  console.log('🔑 Token recebido:', req.query.token);
  
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

    console.log('🔍 Buscando usuário pelo token...');
    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email, verification_token_expires_at, email_verified')
      .eq('verification_token', token)
      .single();

    if (userError || !user) {
      console.log('❌ Token inválido ou usuário não encontrado:', userError);
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

    console.log('✅ Usuário encontrado:', user.email);
    console.log('📧 Email já verificado?', user.email_verified);

    if (user.email_verified) {
      console.log('ℹ️ Email já estava verificado');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Email já verificado - BomNegócio</title></head>
        <body>
          <h1 style="color: green;">✅ Email já verificado</h1>
          <p>Seu email já foi verificado anteriormente. Você já pode fazer login.</p>
        </body>
        </html>
      `);
    }

    const now = new Date();
    const expiresAt = new Date(user.verification_token_expires_at);
    
    console.log('⏰ Verificando expiração do token:');
    console.log('   Agora:', now);
    console.log('   Expira:', expiresAt);
    console.log('   Token expirado?', now > expiresAt);

    if (now > expiresAt) {
      console.log('❌ Token expirado');
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

    console.log('✅ Token válido, atualizando usuário...');
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

    console.log('✅ Email verificado com sucesso!');
    console.log('📤 Enviando email de boas-vindas...');

    try {
      await emailServico.enviarEmailBoasVindas(user.email, user.nome);
      console.log('✅ Email de boas-vindas enviado!');
    } catch (emailError) {
      console.error('⚠️ Erro ao enviar email de boas-vindas:', emailError);
    }

    console.log('🎉 Processo de verificação concluído!');
    
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
          <div class="success">✅</div>
          <h1>Email verificado com sucesso!</h1>
          <p>Sua conta foi ativada com sucesso. Agora você pode fazer login no aplicativo e começar a usar o BomNegócio.</p>
          <a href="bomnegocio://login" class="button">Abrir App e Fazer Login</a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('💥 ERRO na verificação de email:', error);
    console.error('💥 Stack trace:', error.stack);
    
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

// Adicione logs no endpoint de reenvio
router.post('/reenviar-verificacao', async (req, res) => {
  console.log('🔄 Recebida requisição para reenviar verificação');
  console.log('📧 Email solicitado:', req.body.email);
  
  try {
    const { email } = req.body;

    if (!email) {
      console.log('❌ Email não fornecido');
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      });
    }

    console.log('🔍 Buscando usuário por email...');
    const { data: user, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email_verified, verification_token, verification_token_expires_at')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (userError || !user) {
      console.log('❌ Usuário não encontrado');
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    console.log('✅ Usuário encontrado:', user.id);
    console.log('📧 Email já verificado?', user.email_verified);

    if (user.email_verified) {
      console.log('ℹ️ Email já verificado, não é necessário reenviar');
      return res.status(400).json({
        success: false,
        error: 'Email já verificado'
      });
    }

    const newToken = uuidv4();
    const newExpiration = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    console.log('🔑 Novo token gerado:', newToken.substring(0, 10) + '...');
    console.log('⏰ Nova expiração:', newExpiration);

    console.log('💾 Atualizando token no banco...');
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

    console.log('📤 Enviando novo email de verificação...');
    await emailServico.enviarEmailVerificacao(user.email, newToken);
    console.log('✅ Email reenviado com sucesso!');

    res.status(200).json({
      success: true,
      message: 'Email de verificação reenviado com sucesso!'
    });

  } catch (error) {
    console.error('💥 ERRO no reenvio de verificação:', error);
    console.error('💥 Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Erro ao reenviar email de verificação',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

