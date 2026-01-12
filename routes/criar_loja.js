const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// ConfiguraÃ§Ã£o do Multer para upload de imagem
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif|webp/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Apenas imagens sÃ£o permitidas (JPEG, JPG, PNG, GIF, WEBP)'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
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

// FunÃ§Ã£o auxiliar para verificar loja existente com tratamento de erro robusto
const verificarLojaExistente = async (userId) => {
  try {
    const { data: lojaExistente, error: lojaError } = await supabaseAdmin
      .from('loja')
      .select('id, nome')
      .eq('usuario_id', userId)
      .single();

    // PGRST116 significa "nenhum resultado encontrado" - Ã© esperado para usuÃ¡rios sem loja
    if (lojaError && lojaError.code === 'PGRST116') {
      return null;
    }

    if (lojaError) {
      throw new Error(`Erro ao verificar loja existente: ${lojaError.message}`);
    }

    return lojaExistente;
  } catch (error) {
    throw error;
  }
};

// Rota para criar loja com upload de imagem
router.post('/', verifyToken, upload.single('imagem_loja'), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const dadosLoja = req.body;
    const imagemLoja = req.file;

    // VALIDAÃ‡ÃƒO CRÃTICA: Verificar se nome da loja existe
    if (!dadosLoja.nome || dadosLoja.nome.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nome da loja Ã© obrigatÃ³rio'
      });
    }

    // Verificar se o usuÃ¡rio jÃ¡ tem uma loja
    let lojaExistente;
    try {
      lojaExistente = await verificarLojaExistente(userId);
    } catch (error) {
      return res.status(503).json({
        success: false,
        error: 'ServiÃ§o temporariamente indisponÃ­vel. Tente novamente em alguns instantes.'
      });
    }

    // Se o usuÃ¡rio jÃ¡ tem uma loja, retorna erro especÃ­fico
    if (lojaExistente) {
      return res.status(400).json({
        success: false,
        error: 'VocÃª jÃ¡ possui uma loja cadastrada. Cada usuÃ¡rio pode ter apenas uma loja.',
        data: {
          loja_id: lojaExistente.id,
          loja_nome: lojaExistente.nome,
          possui_loja: true
        }
      });
    }

    // Validar campos obrigatÃ³rios
    const camposObrigatorios = ['nome', 'telefone', 'cep', 'numero'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosLoja[campo] || dadosLoja[campo].trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    // Upload da imagem se existir
    let urlImagem = null;
    if (imagemLoja) {
      try {
        const fileExt = path.extname(imagemLoja.originalname).toLowerCase();
        const fileName = `loja-${uuidv4()}${fileExt}`;
        const filePath = `lojas/${fileName}`;

        const { error: uploadError } = await supabaseAdmin.storage
          .from('lojas')
          .upload(filePath, imagemLoja.buffer, {
            contentType: imagemLoja.mimetype,
            cacheControl: '3600',
            upsert: false
          });

        if (uploadError) {
          throw new Error(`Falha ao fazer upload da imagem: ${uploadError.message}`);
        }

        const { data: { publicUrl } } = await supabaseAdmin
          .storage
          .from('lojas')
          .getPublicUrl(filePath);

        urlImagem = publicUrl;
      } catch (uploadError) {
        return res.status(500).json({
          success: false,
          error: 'Erro ao processar imagem da loja. Tente novamente com outra imagem.'
        });
      }
    }

    // Preparar dados para inserÃ§Ã£o
    const dadosInserir = {
      id: uuidv4(),
      usuario_id: userId,
      data_criacao: new Date().toISOString(),
      url_imagem: urlImagem,
      nome: dadosLoja.nome.trim(),
      descricao: dadosLoja.descricao ? dadosLoja.descricao.trim() : null,
      telefone: dadosLoja.telefone.trim(),
      email: dadosLoja.email ? dadosLoja.email.trim() : null,
      cep: dadosLoja.cep.trim(),
      estado: dadosLoja.estado || null,
      cidade: dadosLoja.cidade || null,
      bairro: dadosLoja.bairro || null,
      rua: dadosLoja.rua || null,
      numero: dadosLoja.numero.trim(),
      complemento: dadosLoja.complemento ? dadosLoja.complemento.trim() : null,
      horario_funcionamento: dadosLoja.horario_funcionamento ? dadosLoja.horario_funcionamento.trim() : null,
      categoria: dadosLoja.categoria || null,
      website: dadosLoja.website ? dadosLoja.website.trim() : null,
      whatsapp: dadosLoja.whatsapp ? dadosLoja.whatsapp.trim() : null,
      instagram: dadosLoja.instagram ? dadosLoja.instagram.trim() : null,
      facebook: dadosLoja.facebook ? dadosLoja.facebook.trim() : null,
      ativa: dadosLoja.ativa !== undefined ? dadosLoja.ativa : true,
      forma_entrega: dadosLoja.forma_entrega || null,
      forma_pagamento: dadosLoja.forma_pagamento || null
    };

    // Inserir loja no banco de dados
    const { data: lojaCriada, error: insertError } = await supabaseAdmin
      .from('loja')
      .insert([dadosInserir])
      .select()
      .single();

    if (insertError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao criar loja no banco de dados. Tente novamente.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Loja criada com sucesso!',
      data: lojaCriada
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao criar loja. Tente novamente em alguns instantes.'
    });
  }
});

// Rota para verificar se usuÃ¡rio jÃ¡ tem loja
router.get('/verificar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const lojaExistente = await verificarLojaExistente(userId);

    if (lojaExistente) {
      return res.status(200).json({
        success: true,
        possui_loja: true,
        data: lojaExistente,
        message: 'UsuÃ¡rio jÃ¡ possui uma loja cadastrada'
      });
    }

    res.status(200).json({
      success: true,
      possui_loja: false,
      message: 'UsuÃ¡rio nÃ£o possui loja cadastrada'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar loja existente'
    });
  }
});

// Rota para buscar categorias
router.get('/categorias', async (req, res) => {
  try {
    const { data: categorias, error } = await supabaseAdmin
      .from('categorias_loja')
      .select('*')
      .order('nome');

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar categorias'
      });
    }

    res.status(200).json({
      success: true,
      data: categorias
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar categorias'
    });
  }
});

module.exports = router;

