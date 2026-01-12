const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// CONSTANTES
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// FUNÇÃO PARA OBTER AS CHAVES JWT
const getJwtSecrets = () => {
  if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
    throw new Error('Variáveis JWT não configuradas');
  }
  return { JWT_SECRET, JWT_REFRESH_SECRET };
};

// Limite de tentativas de login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Muitas tentativas de login. Tente novamente mais tarde.',
  skipSuccessfulRequests: true
});

// Validação robusta de entrada
const validateLoginInput = (email, senha) => {
  const errors = {};
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const passwordMinLength = 8;

  if (!email || typeof email !== 'string') {
    errors.email = 'Email é obrigatório';
  } else if (!emailRegex.test(email)) {
    errors.email = 'Email inválido';
  } else if (email.length > 254) {
    errors.email = 'Email muito longo';
  }

  if (!senha || typeof senha !== 'string') {
    errors.senha = 'Senha é obrigatória';
  } else if (senha.length < passwordMinLength) {
    errors.senha = `Senha deve ter pelo menos ${passwordMinLength} caracteres`;
  } else if (!/[A-Z]/.test(senha)) {
    errors.senha = 'Senha deve conter pelo menos uma letra maiúscula';
  } else if (!/[0-9]/.test(senha)) {
    errors.senha = 'Senha deve conter pelo menos um número';
  } else if (!/[^A-Za-z0-9]/.test(senha)) {
    errors.senha = 'Senha deve conter pelo menos um caractere especial';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
};

// Rota de login com limitação de taxa
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { JWT_SECRET, JWT_REFRESH_SECRET } = getJwtSecrets();

    const { email, senha } = req.body;

    const sanitizedEmail = email?.toString().trim().toLowerCase();
    const sanitizedPassword = senha?.toString();

    const { isValid, errors } = validateLoginInput(sanitizedEmail, sanitizedPassword);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        errors,
        timestamp: new Date().toISOString()
      });
    }

    const { data: exactUser, error: exactError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, email, cidade, senha_hash, email_verified, login_attempts, account_locked_until')
      .eq('email', sanitizedEmail)
      .maybeSingle();

    if (exactError) {
      return res.status(500).json({
        success: false,
        error: 'Erro interno do servidor',
        timestamp: new Date().toISOString()
      });
    }

    if (exactUser && exactUser.account_locked_until && new Date(exactUser.account_locked_until) > new Date()) {
      return res.status(423).json({
        success: false,
        error: 'Conta temporariamente bloqueada devido a muitas tentativas de login',
        locked_until: exactUser.account_locked_until,
        timestamp: new Date().toISOString()
      });
    }

    const dummyHash = await bcrypt.hash('dummy', 10);
    const passwordHash = exactUser?.senha_hash || dummyHash;
    const isPasswordValid = await bcrypt.compare(sanitizedPassword, passwordHash);

    if (exactError || !exactUser || !isPasswordValid) {
      if (exactUser) {
        try {
          const newAttempts = (exactUser.login_attempts || 0) + 1;
          let lockUntil = null;

          if (newAttempts >= 5) {
            lockUntil = new Date(Date.now() + 15 * 60 * 1000);
          }

          await supabaseAdmin
            .from('usuarios')
            .update({
              login_attempts: newAttempts,
              account_locked_until: lockUntil
            })
            .eq('id', exactUser.id);
        } catch (updateError) {
        }
      }

      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas',
        timestamp: new Date().toISOString()
      });
    }

    if (!exactUser.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Email não verificado',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Por favor, verifique seu email antes de fazer login. Verifique sua caixa de entrada e spam.',
        timestamp: new Date().toISOString()
      });
    }

    try {
      await supabaseAdmin
        .from('usuarios')
        .update({
          login_attempts: 0,
          account_locked_until: null,
          last_login_at: new Date().toISOString()
        })
        .eq('id', exactUser.id);
    } catch (updateError) {
    }

    const tokenPayload = {
      id: exactUser.id,
      email: exactUser.email,
      nome: exactUser.nome,
      cidade: exactUser.cidade,
      iss: 'bomnegocio-api',
      aud: 'bomnegocio-app'
    };

    const token = jwt.sign(
      tokenPayload,
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: exactUser.id },
      JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    const userData = {
      id: exactUser.id,
      nome: exactUser.nome,
      email: exactUser.email,
      cidade: exactUser.cidade
    };

    res
      .setHeader('X-Content-Type-Options', 'nosniff')
      .setHeader('X-Frame-Options', 'DENY')
      .setHeader('X-XSS-Protection', '1; mode=block')
      .status(200)
      .json({
        success: true,
        token,
        refreshToken,
        user: userData,
        expiresIn: 900,
        timestamp: new Date().toISOString()
      });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;