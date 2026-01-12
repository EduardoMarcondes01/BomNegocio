const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
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

// ConfiguraÃ§Ã£o do Multer para upload de imagens
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
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

// Middleware para tratamento de erros do Multer
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

// Rota GET para obter dados do perfil
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: usuario, error } = await supabaseAdmin
      .from('usuarios')
      .select(`
        id,
        nome,
        sobrenome,
        idade,
        estado,
        cidade,
        bairro,
        rua,
        sexo,
        telefone,
        cep,
        imagem_url
      `)
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    if (!usuario) {
      return res.status(404).json({
        success: false,
        error: 'UsuÃ¡rio nÃ£o encontrado'
      });
    }

    res.json({
      success: true,
      usuario: usuario
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar perfil'
    });
  }
});

// Rota PUT para atualizar perfil
router.put('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = req.body;

    // Preparar dados para atualizaÃ§Ã£o
    const dadosAtualizacao = {};

    // Campos que podem ser atualizados
    const camposPermitidos = [
      'nome', 'sobrenome', 'sexo', 'telefone', 'cep',
      'estado', 'cidade', 'bairro', 'rua'
    ];

    camposPermitidos.forEach(campo => {
      if (updateData[campo] !== undefined && updateData[campo] !== null) {
        if (campo === 'telefone' || campo === 'cep') {
          dadosAtualizacao[campo] = updateData[campo].replace(/\D/g, '');
        } else {
          dadosAtualizacao[campo] = updateData[campo].toString().trim();
        }
      }
    });

    // Verificar se hÃ¡ dados para atualizar
    if (Object.keys(dadosAtualizacao).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nenhum dado vÃ¡lido para atualizaÃ§Ã£o'
      });
    }

    // Atualizar no banco de dados
    const { data: usuarioAtualizado, error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update(dadosAtualizacao)
      .eq('id', userId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso',
      usuario: usuarioAtualizado
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao atualizar perfil'
    });
  }
});

// Rota para upload de imagem
router.post('/upload', authenticateToken, upload.single('imagem'), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Nenhuma imagem fornecida'
      });
    }

    // Obter usuÃ¡rio atual para verificar imagem anterior
    const { data: usuarioAtual, error: fetchError } = await supabaseAdmin
      .from('usuarios')
      .select('imagem_url')
      .eq('id', userId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Gerar nome Ãºnico para o arquivo
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileName = `user-${uuidv4()}${fileExt}`;
    const filePath = `profile-pictures/${fileName}`;

    // Fazer upload da imagem
    const { error: uploadError } = await supabaseAdmin.storage
      .from('usuarios')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw new Error('Falha ao processar imagem de perfil');
    }

    // Obter URL pÃºblica
    const { data: { publicUrl } } = await supabaseAdmin.storage
      .from('usuarios')
      .getPublicUrl(filePath);

    // Atualizar URL da imagem no perfil do usuÃ¡rio
    const { error: updateError } = await supabaseAdmin
      .from('usuarios')
      .update({
        imagem_url: publicUrl
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    // Deletar imagem anterior se existir
    if (usuarioAtual?.imagem_url) {
      try {
        const oldFileName = usuarioAtual.imagem_url.split('/').pop();
        if (oldFileName && oldFileName !== fileName) {
          await supabaseAdmin.storage
            .from('usuarios')
            .remove([`profile-pictures/${oldFileName}`]);
        }
      } catch (deleteError) {
        // NÃ£o falhar se nÃ£o conseguir deletar a imagem antiga
      }
    }

    res.json({
      success: true,
      message: 'Imagem de perfil atualizada com sucesso',
      imagem_url: publicUrl
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao fazer upload da imagem'
    });
  }
});

module.exports = router;


