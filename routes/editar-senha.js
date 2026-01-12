const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Middleware de autenticaÃ§Ã£o
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Token de acesso necessÃ¡rio'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      error: 'Token invÃ¡lido ou expirado'
    });
  }
};

// ValidaÃ§Ã£o de entrada
const validatePasswordInput = (senhaAtual, novaSenha) => {
  const errors = {};

  if (!senhaAtual || typeof senhaAtual !== 'string') {
    errors.senhaAtual = 'Senha atual Ã© obrigatÃ³ria';
  } else if (senhaAtual.length < 8) {
    errors.senhaAtual = 'Senha atual deve ter pelo menos 8 caracteres';
  }

  if (!novaSenha || typeof novaSenha !== 'string') {
    errors.novaSenha = 'Nova senha Ã© obrigatÃ³ria';
  } else if (novaSenha.length < 8) {
    errors.novaSenha = 'Nova senha deve ter pelo menos 8 caracteres';
  } else if (!/[A-Z]/.test(novaSenha)) {
    errors.novaSenha = 'Nova senha deve conter pelo menos uma letra maiÃºscula';
  } else if (!/[0-9]/.test(novaSenha)) {
    errors.novaSenha = 'Nova senha deve conter pelo menos um nÃºmero';
  } else if (!/[^A-Za-z0-9]/.test(novaSenha)) {
    errors.novaSenha = 'Nova senha deve conter pelo menos um caractere especial';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Rota principal para alteraÃ§Ã£o de senha
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { senhaAtual, novaSenha } = req.body;

    // ValidaÃ§Ã£o de entrada
    const { isValid, errors } = validatePasswordInput(senhaAtual, novaSenha);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        errors,
        message: 'Dados de entrada invÃ¡lidos'
      });
    }

    // Buscar usuÃ¡rio e senha atual
    const { data: usuario, error: userError } = await supabaseAdmin
      .from('usuarios')
      .select('id, senha_hash, email_verified, login_attempts')
      .eq('id', userId)
      .single();

    if (userError || !usuario) {
      return res.status(404).json({
        success: false,
        error: 'UsuÃ¡rio nÃ£o encontrado'
      });
    }

    // Verificar se email estÃ¡ verificado
    if (!usuario.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Email nÃ£o verificado. Verifique seu email antes de alterar a senha.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    // Verificar senha atual
    const isSenhaAtualValida = await bcrypt.compare(senhaAtual, usuario.senha_hash);
    if (!isSenhaAtualValida) {
      // Incrementar tentativas de login falhas
      const newAttempts = (usuario.login_attempts || 0) + 1;
      let lockUntil = null;

      // Bloquear conta apÃ³s 5 tentativas falhas
      if (newAttempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await supabaseAdmin
        .from('usuarios')
        .update({
          login_attempts: newAttempts,
          account_locked_until: lockUntil
        })
        .eq('id', userId);

      return res.status(401).json({
        success: false,
        error: 'Senha atual incorreta',
        attempts: newAttempts,
        locked: newAttempts >= 5
      });
    }

    // Verificar se a nova senha Ã© igual Ã  atual
    const isNovaSenhaIgual = await bcrypt.compare(novaSenha, usuario.senha_hash);
    if (isNovaSenhaIgual) {
      return res.status(400).json({
        success: false,
        error: 'A nova senha nÃ£o pode ser igual Ã  senha atual'
      });
    }

    // Hash da nova senha
    const salt = await bcrypt.genSalt(12);
    const novaSenhaHash = await bcrypt.hash(novaSenha, salt);

    // Atualizar senha
    const { error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update({
        senha_hash: novaSenhaHash,
        login_attempts: 0,
        account_locked_until: null,
        last_login_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    // Buscar dados atualizados do usuÃ¡rio para gerar novo token
    const { data: usuarioAtualizado, error: fetchError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email, cidade')
      .eq('id', userId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Gerar novo token JWT
    const tokenPayload = {
      id: usuarioAtualizado.id,
      email: usuarioAtualizado.email,
      nome: usuarioAtualizado.nome,
      cidade: usuarioAtualizado.cidade,
      iss: 'bomnegocio-api',
      aud: 'bomnegocio-app'
    };

    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: usuarioAtualizado.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Senha alterada com sucesso!',
      token: token,
      refreshToken: refreshToken,
      user: usuarioAtualizado
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao alterar senha'
    });
  }
});

// Rota para verificar forÃ§a da senha
router.post('/verificar-forca', (req, res) => {
  try {
    const { senha } = req.body;

    if (!senha || typeof senha !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Senha Ã© obrigatÃ³ria'
      });
    }

    const criterios = {
      comprimento: senha.length >= 8,
      maiuscula: /[A-Z]/.test(senha),
      numero: /[0-9]/.test(senha),
      especial: /[^A-Za-z0-9]/.test(senha)
    };

    const pontosFortes = Object.values(criterios).filter(Boolean).length;
    const forca = pontosFortes / Object.keys(criterios).length;

    let nivel;
    if (forca === 1) {
      nivel = 'muito_forte';
    } else if (forca >= 0.75) {
      nivel = 'forte';
    } else if (forca >= 0.5) {
      nivel = 'media';
    } else {
      nivel = 'fraca';
    }

    res.json({
      success: true,
      forca: nivel,
      criterios: criterios,
      pontos: pontosFortes,
      totalCriterios: Object.keys(criterios).length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao verificar forÃ§a da senha'
    });
  }
});

module.exports = router;
