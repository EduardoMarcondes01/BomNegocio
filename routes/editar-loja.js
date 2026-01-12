const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// ConfiguraÃ§Ã£o do Multer (mesma do criar)
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

// FunÃ§Ã£o para verificar se loja pertence ao usuÃ¡rio
const verificarPropriedadeLoja = async (lojaId, userId) => {
  try {
    const { data: loja, error } = await supabaseAdmin
      .from('loja')
      .select('id, usuario_id')
      .eq('id', lojaId)
      .single();

    if (error) {
      throw new Error('Loja nÃ£o encontrada');
    }

    if (loja.usuario_id !== userId) {
      throw new Error('UsuÃ¡rio nÃ£o tem permissÃ£o para editar esta loja');
    }

    return loja;
  } catch (error) {
    throw error;
  }
};

// Rota para buscar dados da loja
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const lojaId = req.params.id;

    // Verificar se loja pertence ao usuÃ¡rio
    await verificarPropriedadeLoja(lojaId, userId);

    const { data: loja, error } = await supabaseAdmin
      .from('loja')
      .select('*')
      .eq('id', lojaId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        error: 'Loja nÃ£o encontrada'
      });
    }

    res.status(200).json({
      success: true,
      data: loja
    });

  } catch (error) {
    if (error.message.includes('permissÃ£o')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar dados da loja'
    });
  }
});

// Rota para editar loja
router.put('/:id', verifyToken, upload.single('imagem_loja'), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const lojaId = req.params.id;
    const dadosLoja = req.body;
    const imagemLoja = req.file;

    // VALIDAÃ‡ÃƒO CRÃTICA: Verificar se nome da loja existe
    if (!dadosLoja.nome || dadosLoja.nome.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nome da loja Ã© obrigatÃ³rio'
      });
    }

    // Verificar se loja pertence ao usuÃ¡rio
    await verificarPropriedadeLoja(lojaId, userId);

    // Validar campos obrigatÃ³rios
    const camposObrigatorios = ['nome', 'telefone', 'cep', 'numero'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosLoja[campo] || dadosLoja[campo].trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    // Buscar loja atual para preservar imagem se nÃ£o for alterada
    const { data: lojaAtual, error: lojaError } = await supabaseAdmin
      .from('loja')
      .select('url_imagem')
      .eq('id', lojaId)
      .single();

    if (lojaError) {
      throw new Error('Erro ao buscar dados da loja');
    }

    let urlImagem = lojaAtual.url_imagem;

    // Upload da nova imagem se existir
    if (imagemLoja) {
      try {
        // Deletar imagem antiga se existir
        if (urlImagem) {
          const fileName = urlImagem.split('/').pop();
          const filePath = `lojas/${fileName}`;
          
          const { error: deleteError } = await supabaseAdmin.storage
            .from('lojas')
            .remove([filePath]);

          if (deleteError) {
            // Continua mesmo se nÃ£o conseguir deletar imagem antiga
          }
        }

        // Fazer upload da nova imagem
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

    // Preparar dados para atualizaÃ§Ã£o
    const dadosAtualizar = {
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
      forma_pagamento: dadosLoja.forma_pagamento || null,
      data_atualizacao: new Date().toISOString()
    };

    // Atualizar loja no banco de dados
    const { data: lojaAtualizada, error: updateError } = await supabaseAdmin
      .from('loja')
      .update(dadosAtualizar)
      .eq('id', lojaId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar loja no banco de dados. Tente novamente.'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Loja atualizada com sucesso!',
      data: lojaAtualizada
    });

  } catch (error) {
    if (error.message.includes('permissÃ£o')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('nÃ£o encontrada')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Erro interno ao atualizar loja. Tente novamente em alguns instantes.'
    });
  }
});

module.exports = router;


