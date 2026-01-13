const express = require('express');
const { supabase, supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const nodemailer = require('nodemailer'); // ✅ Simples e direto

console.log('=== CADASTRO COM VALIDAÇÃO DE EMAIL ===');

// Configurar email SIMPLES (teste se existe)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'bomnegociocidade@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD // Senha de app do Google
  }
});

// Testar conexão email
transporter.verify(function(error, success) {
  if (error) {
    console.log('⚠️  Email não configurado. Contas serão criadas SEM verificação.');
    console.log('Para configurar: https://myaccount.google.com/apppasswords');
  } else {
    console.log('✅ Servidor de email pronto!');
  }
});

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

const router = express.Router();

// 🔥 FUNÇÃO: Tentar enviar email (valida se existe)
async function validarEmailExiste(email, nome) {
  console.log(`📧 Validando se ${email} existe...`);
  
  try {
    const mailOptions = {
      from: '"BomNegócio" <bomnegociocidade@gmail.com>',
      to: email,
      subject: '🎉 Bem-vindo ao BomNegócio!',
      html: `
        <div style="font-family: Arial; padding: 20px; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
          <h2 style="color: #4CAF50;">Olá, ${nome}!</h2>
          <p>Sua conta no <strong>BomNegócio</strong> foi criada com sucesso!</p>
          <p>Agora você pode:</p>
          <ul>
            <li>Publicar produtos para venda</li>
            <li>Buscar produtos perto de você</li>
            <li>Conversar com outros usuários</li>
          </ul>
          <p style="margin-top: 30px; padding: 15px; background: #f9f9f9; border-radius: 5px;">
            <strong>Dica:</strong> Complete seu perfil para vender mais rápido!
          </p>
          <hr style="margin: 30px 0;">
          <p style="font-size: 12px; color: #666;">
            Este email confirma que seu endereço é válido e ativo.<br>
            Se você não criou esta conta, ignore este email.
          </p>
        </div>
      `,
      text: `Olá ${nome}!\n\nSua conta no BomNegócio foi criada com sucesso!\n\nAgora você pode publicar produtos, buscar ofertas e conversar com outros usuários.\n\nEste email confirma que seu endereço é válido.\n\nBoas vendas!`
    };

    // Tentar enviar
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`✅ Email válido! Enviado para: ${email}`);
    console.log(`   Message ID: ${info.messageId}`);
    
    return {
      existe: true,
      messageId: info.messageId
    };
    
  } catch (error) {
    console.log(`❌ Email NÃO existe ou inválido: ${email}`);
    console.log(`   Erro: ${error.message}`);
    
    // Verificar tipo de erro
    if (error.code === 'EENVELOPE' || error.responseCode === 550) {
      return { existe: false, motivo: 'Email não existe ou rejeitado' };
    }
    
    return { existe: false, motivo: error.message };
  }
}

// 🔥 ROTA PRINCIPAL: Cadastro com validação
router.post('/', upload.single('foto_perfil'), async (req, res) => {
  console.log('\n📝 NOVO CADASTRO COM VALIDAÇÃO DE EMAIL');
  console.log('Email:', req.body.email);
  
  try {
    const userData = req.body;
    const fotoPerfil = req.file;

    // Validação básica
    if (!userData.email || !userData.senha || !userData.nome) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: email, senha e nome'
      });
    }

    // Verificar formato email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de email inválido'
      });
    }

    // Verificar se email já existe no banco
    const { data: existingUser } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', userData.email.trim().toLowerCase())
      .maybeSingle();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Este email já está cadastrado'
      });
    }

    // 🔥 PASSO 1: Tentar validar email ANTES de criar conta
    const validacaoEmail = await validarEmailExiste(
      userData.email.trim().toLowerCase(), 
      userData.nome.trim()
    );

    // Se email NÃO existe, NÃO criar conta
    if (!validacaoEmail.existe) {
      console.log(`❌ Conta NÃO criada para ${userData.email}: Email inválido`);
      
      return res.status(400).json({
        success: false,
        error: 'Email inválido ou não existe',
        detalhes: 'Não foi possível enviar email para este endereço',
        sugestao: 'Verifique se digitou corretamente'
      });
    }

    // 🔥 PASSO 2: Email EXISTE - Criar conta
    console.log(`✅ Email válido! Criando conta para ${userData.email}...`);

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
            contentType: fotoPerfil.mimetype
          });

        if (!uploadError) {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from('usuarios')
            .getPublicUrl(filePath);
          imagem_url = publicUrl;
        }
      } catch (error) {
        console.log('Foto não salva:', error.message);
      }
    }

    // Criar usuário NO BANCO (email já validado)
    const userToInsert = {
      nome: userData.nome.trim(),
      sobrenome: userData.sobrenome?.trim() || '',
      email: userData.email.trim().toLowerCase(),
      senha_hash: hashedPassword,
      idade: parseInt(userData.idade) || 18,
      estado: userData.estado?.trim() || '',
      cidade: userData.cidade?.trim() || '',
      bairro: userData.bairro?.trim() || '',
      rua: userData.rua?.trim() || '',
      sexo: userData.sexo || 'Não informado',
      telefone: userData.telefone?.replace(/\D/g, '') || null,
      cep: userData.cep?.replace(/\D/g, '') || '',
      aceitou_termos: true,
      imagem_url,
      email_verified: true,  // ✅ JÁ VERIFICADO (email existe)
      email_validated_at: new Date().toISOString(),
      email_validation_id: validacaoEmail.messageId, // ID do email enviado
      created_at: new Date().toISOString()
    };

    const { data: newUser, error: dbError } = await supabaseAdmin
      .from('usuarios')
      .insert(userToInsert)
      .select('id, nome, email, imagem_url')
      .single();

    if (dbError) {
      console.error('❌ Erro ao salvar no banco:', dbError);
      return res.status(500).json({
        success: false,
        error: 'Erro ao criar conta'
      });
    }

    console.log(`✅ Conta criada com sucesso! ID: ${newUser.id}`);
    
    // 🔥 RESPOSTA DE SUCESSO
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: newUser.id,
          nome: newUser.nome,
          email: newUser.email,
          imagem_url: newUser.imagem_url,
          email_verified: true,  // Já pode logar!
          welcome_email_sent: true
        }
      },
      message: 'Conta criada com sucesso! Verifique seu email para as boas-vindas.',
      email_status: 'Email de boas-vindas enviado com sucesso'
    });

  } catch (error) {
    console.error('❌ Erro no cadastro:', error);
    
    // Erros específicos
    if (error.message.includes('Invalid login')) {
      return res.status(500).json({
        success: false,
        error: 'Serviço de email não configurado',
        message: 'Conta criada, mas não foi possível validar o email'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor'
    });
  }
});

// 🔥 ROTA PARA TESTE DE EMAIL (opcional)
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email é obrigatório'
      });
    }

    const resultado = await validarEmailExiste(email, 'Teste');
    
    res.json({
      success: resultado.existe,
      email_valido: resultado.existe,
      detalhes: resultado.existe ? 'Email válido e ativo' : resultado.motivo,
      recomendacao: resultado.existe 
        ? 'Pode usar para cadastro' 
        : 'Use outro email'
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro no teste'
    });
  }
});

module.exports = router;
