const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// ConfiguraÃ§Ã£o do Multer
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
    files: 5
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

const verificarPropriedadeItem = async (tabela, itemId, userId) => {
  try {
    const { data: item, error } = await supabaseAdmin
      .from(tabela)
      .select('id, usuario_id')
      .eq('id', itemId)
      .single();

    if (error) {
      throw new Error(`${tabela.replace('_', ' ')} nÃ£o encontrado(a)`);
    }

    if (item.usuario_id !== userId) {
      throw new Error('UsuÃ¡rio nÃ£o tem permissÃ£o para editar este item');
    }

    return item;
  } catch (error) {
    throw error;
  }
};

const processarUploadImagens = async (files, bucketName, prefix) => {
  const urls = [];

  if (!files || files.length === 0) {
    return urls;
  }

  for (const file of files) {
    try {
      const fileExt = path.extname(file.originalname).toLowerCase();
      const fileName = `${prefix}-${uuidv4()}${fileExt}`;
      const filePath = `${bucketName}/${fileName}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('produtos')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw new Error(`Falha ao fazer upload da imagem: ${uploadError.message}`);
      }

      const { data: { publicUrl } } = await supabaseAdmin
        .storage
        .from('produtos')
        .getPublicUrl(filePath);

      urls.push(publicUrl);
    } catch (error) {
      throw error;
    }
  }

  return urls;
};

const deletarImagensAntigas = async (imagensAntigas, bucketName) => {
  if (!imagensAntigas || imagensAntigas.length === 0) return;

  try {
    const filePaths = imagensAntigas
      .filter(url => url)
      .map(url => {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        const filePath = pathSegments.slice(5).join('/');
        return filePath;
      })
      .filter(path => path && !path.endsWith('/'));

    if (filePaths.length > 0) {
      await supabaseAdmin.storage
        .from('produtos')
        .remove(filePaths);
    }
  } catch (error) {
  }
};

const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
};

router.get('/ofertas/conversas', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const { data: mensagens, error: mensagensError } = await supabaseAdmin
      .from('mensagens')
      .select('*')
      .or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`)
      .or(`and(remetente_id.eq.${userId},remetente_deletado.is.false),and(destinatario_id.eq.${userId},destinatario_deletado.is.false)`)
      .eq('oferta', true)
      .order('data_hora', { ascending: false });

    if (mensagensError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar conversas'
      });
    }

    if (!mensagens || mensagens.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 10, hasNext: false }
      });
    }

    const conversasMap = new Map();

    mensagens.forEach(msg => {
      const ofertaId = msg.oferta_id;
      const outroUsuarioId = msg.remetente_id === userId ? msg.destinatario_id : msg.remetente_id;
      const chaveConversa = `${ofertaId}_${outroUsuarioId}`;

      if (!conversasMap.has(chaveConversa) ||
        new Date(msg.data_hora) > new Date(conversasMap.get(chaveConversa).ultima_mensagem_hora)) {

        conversasMap.set(chaveConversa, {
          oferta_id: ofertaId,
          contato_id: outroUsuarioId,
          ultima_mensagem: msg.mensagem,
          ultima_mensagem_hora: msg.data_hora,
          anexo_url: msg.anexo_url,
          tipo_anexo: msg.tipo_anexo,
          eh_remetente: msg.remetente_id === userId
        });
      }
    });

    const totalConversas = conversasMap.size;
    const conversasArray = Array.from(conversasMap.values());
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const conversasPaginadas = conversasArray.slice(startIndex, endIndex);

    const ofertaIds = conversasPaginadas.map(c => c.oferta_id);
    const contatoIds = [...new Set(conversasPaginadas.map(c => c.contato_id))];

    const { data: ofertas, error: ofertasError } = await supabaseAdmin
      .from('ofertas')
      .select('id, nome, valor, desconto, imagens, ativa')
      .in('id', ofertaIds);

    if (ofertasError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar ofertas'
      });
    }

    const { data: contatos, error: contatosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url, cidade')
      .in('id', contatoIds);

    if (contatosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar contatos'
      });
    }

    const conversas = conversasPaginadas.map(conversa => {
      const oferta = ofertas.find(o => o.id === conversa.oferta_id);
      const contato = contatos.find(c => c.id === conversa.contato_id);

      const valorComDesconto = oferta ?
        oferta.valor * (1 - (oferta.desconto || 0) / 100) : 0;

      const mensagensNaoLidas = mensagens.filter(msg =>
        msg.oferta_id === conversa.oferta_id &&
        msg.destinatario_id === userId &&
        msg.remetente_id === conversa.contato_id &&
        !msg.lida &&
        msg.oferta === true
      ).length;

      return {
        id: `${conversa.oferta_id}_${conversa.contato_id}`,
        oferta: {
          id: oferta?.id || conversa.oferta_id,
          nome: oferta?.nome || 'Oferta nÃ£o encontrada',
          valor_original: oferta?.valor || 0,
          desconto: oferta?.desconto || 0,
          valor_com_desconto: valorComDesconto,
          imagens: oferta?.imagens || [],
          ativa: oferta?.ativa || false
        },
        contato: {
          id: contato?.id || conversa.contato_id,
          nome: contato?.nome || 'UsuÃ¡rio nÃ£o encontrado',
          foto: contato?.imagem_url || null,
          cidade: contato?.cidade || 'Cidade nÃ£o informada'
        },
        ultima_mensagem: conversa.ultima_mensagem,
        ultima_mensagem_hora: conversa.ultima_mensagem_hora,
        nao_lidas: mensagensNaoLidas,
        eh_remetente: conversa.eh_remetente,
        tem_anexo: !!conversa.anexo_url,
        tipo_anexo: conversa.tipo_anexo,
        tipo: 'oferta'
      };
    });

    conversas.sort((a, b) => new Date(b.ultima_mensagem_hora) - new Date(a.ultima_mensagem_hora));

    res.json({
      success: true,
      data: conversas,
      meta: {
        total: totalConversas,
        page: parseInt(page),
        limit: parseInt(limit),
        hasNext: totalConversas > page * limit
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar conversas de ofertas'
    });
  }
});

router.post('/ofertas/:conversaId/ler', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { oferta_id, contato_id } = req.body;
    const userId = req.user.id;

    if (!oferta_id || isNaN(parseInt(oferta_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta invÃ¡lido'
      });
    }

    const ofertaIdInt = parseInt(oferta_id);

    if (!contato_id || !isValidUUID(contato_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID do contato invÃ¡lido'
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ lida: true })
      .eq('oferta_id', ofertaIdInt)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .eq('lida', false)
      .eq('oferta', true);

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar mensagens'
      });
    }

    res.json({
      success: true,
      message: 'Mensagens de oferta marcadas como lidas com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao marcar mensagens como lidas'
    });
  }
});

router.delete('/ofertas/:conversaId', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { oferta_id, contato_id } = req.body;
    const userId = req.user.id;

    if (!oferta_id) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta ausente'
      });
    }

    const isNumeric = !isNaN(oferta_id) && !isNaN(parseFloat(oferta_id));
    const isUuid = isValidUUID(oferta_id);

    if (!isNumeric && !isUuid) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta invÃ¡lido. Deve ser numÃ©rico ou UUID.'
      });
    }

    const ofertaIdStr = String(oferta_id);

    if (!contato_id || !isValidUUID(contato_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID do contato invÃ¡lido'
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ remetente_deletado: true })
      .eq('oferta_id', ofertaIdStr)
      .eq('remetente_id', userId)
      .eq('destinatario_id', contato_id)
      .eq('oferta', true)
      .select();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar mensagens'
      });
    }

    const { error: updateError2 } = await supabaseAdmin
      .from('mensagens')
      .update({ destinatario_deletado: true })
      .eq('oferta_id', ofertaIdStr)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .eq('oferta', true)
      .select();

    if (updateError2) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar mensagens'
      });
    }

    res.json({
      success: true,
      message: 'Conversa de oferta excluÃ­da com sucesso',
      data: {
        conversaId
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao excluir conversa de oferta'
    });
  }
});

router.get('/ofertas/:ofertaId/:contatoId', verifyToken, async (req, res) => {
  try {
    const { ofertaId, contatoId } = req.params;
    const usuarioId = req.user.id;

    if (!ofertaId || isNaN(parseInt(ofertaId))) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta invÃ¡lido'
      });
    }

    const ofertaIdInt = parseInt(ofertaId);

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do contato invÃ¡lido'
      });
    }

    const { data: mensagens, error } = await supabaseAdmin
      .from('mensagens')
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        oferta_id,
        remetente_deletado,
        destinatario_deletado,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video,
        oferta
      `)
      .eq('oferta_id', ofertaIdInt)
      .or(`and(remetente_id.eq.${usuarioId},destinatario_id.eq.${contatoId}),and(remetente_id.eq.${contatoId},destinatario_id.eq.${usuarioId})`)
      .or(`and(remetente_id.eq.${usuarioId},remetente_deletado.is.false),and(destinatario_id.eq.${usuarioId},destinatario_deletado.is.false)`)
      .eq('oferta', true)
      .order('data_hora', { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar mensagens'
      });
    }

    const { data: oferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .select('*')
      .eq('id', ofertaIdInt)
      .single();

    if (!mensagens || mensagens.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        oferta: oferta || null,
        meta: {
          total: 0,
          enviadas: 0,
          recebidas: 0,
          nao_lidas: 0,
          com_anexos: 0
        }
      });
    }

    const usuarioIds = [...new Set(mensagens.map(msg => [msg.remetente_id, msg.destinatario_id]).flat())];

    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url')
      .in('id', usuarioIds);

    if (usuariosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar usuÃ¡rios'
      });
    }

    const usuariosMap = new Map();
    usuarios.forEach(usuario => {
      usuariosMap.set(usuario.id, usuario);
    });

    const resposta = mensagens.map(msg => {
      const enviadaPorMim = msg.remetente_id === usuarioId;
      const remetente = usuariosMap.get(msg.remetente_id);
      const destinatario = usuariosMap.get(msg.destinatario_id);

      const mensagemFormatada = {
        id: msg.id,
        mensagem: msg.mensagem,
        data_hora: msg.data_hora,
        lida: msg.lida,
        remetente_id: msg.remetente_id,
        remetente_nome: remetente?.nome || 'UsuÃ¡rio',
        remetente_foto: remetente?.imagem_url,
        destinatario_id: msg.destinatario_id,
        destinatario_nome: destinatario?.nome || 'UsuÃ¡rio',
        destinatario_foto: destinatario?.imagem_url,
        enviada_por_mim: enviadaPorMim,
        nao_lida: !enviadaPorMim && !msg.lida,
        status: 'enviada',

        anexo: msg.anexo_url ? {
          url: msg.anexo_url,
          tipo: msg.tipo_anexo || 'arquivo',
          nome_arquivo: msg.nome_arquivo,
          tamanho: msg.tamanho_arquivo,
          duracao: msg.duracao_video
        } : null
      };

      return mensagemFormatada;
    });

    const estatisticas = {
      total: resposta.length,
      enviadas: resposta.filter(m => m.enviada_por_mim).length,
      recebidas: resposta.filter(m => !m.enviada_por_mim).length,
      nao_lidas: resposta.filter(m => m.nao_lida).length,
      com_anexos: resposta.filter(m => m.anexo).length
    };

    res.status(200).json({
      success: true,
      data: resposta,
      oferta: oferta || null,
      meta: estatisticas
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar mensagens da oferta'
    });
  }
});

router.post('/ofertas', verifyToken, async (req, res) => {
  try {
    const { oferta_id, destinatario_id, mensagem, anexo } = req.body;
    const remetente_id = req.user.id;

    if (!oferta_id || isNaN(parseInt(oferta_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta invÃ¡lido'
      });
    }

    const ofertaIdInt = parseInt(oferta_id);

    if (!destinatario_id || !isValidUUID(destinatario_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID do destinatÃ¡rio invÃ¡lido'
      });
    }

    if (!mensagem && !anexo?.url) {
      return res.status(400).json({
        success: false,
        error: 'A mensagem nÃ£o pode estar vazia'
      });
    }

    const { data: oferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .select('id, nome, ativa')
      .eq('id', ofertaIdInt)
      .single();

    if (ofertaError || !oferta) {
      return res.status(404).json({
        success: false,
        error: 'Oferta nÃ£o encontrada'
      });
    }

    if (!oferta.ativa) {
      return res.status(400).json({
        success: false,
        error: 'Esta oferta nÃ£o estÃ¡ mais ativa'
      });
    }

    const mensagemData = {
      remetente_id,
      destinatario_id,
      oferta_id: ofertaIdInt,
      mensagem: (mensagem || '').trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: true
    };

    if (anexo?.url) {
      mensagemData.anexo_url = anexo.url;
      mensagemData.tipo_anexo = anexo.tipo || 'arquivo';
      mensagemData.nome_arquivo = anexo.nome_arquivo;
      mensagemData.tamanho_arquivo = anexo.tamanho;

      if (anexo.tipo === 'video' && anexo.duracao) {
        mensagemData.duracao_video = anexo.duracao;
      }
    }

    const { data: novaMensagem, error: insertError } = await supabaseAdmin
      .from('mensagens')
      .insert([mensagemData])
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        oferta_id,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video
      `)
      .single();

    if (insertError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao enviar mensagem'
      });
    }

    const { data: remetente } = await supabaseAdmin
      .from('usuarios')
      .select('nome, imagem_url')
      .eq('id', remetente_id)
      .single();

    const resposta = {
      id: novaMensagem.id,
      mensagem: novaMensagem.mensagem,
      data_hora: novaMensagem.data_hora,
      lida: novaMensagem.lida,
      remetente_id: novaMensagem.remetente_id,
      remetente_nome: remetente?.nome || 'UsuÃ¡rio',
      remetente_foto: remetente?.imagem_url,
      destinatario_id: novaMensagem.destinatario_id,
      enviada_por_mim: true,
      anexo: novaMensagem.anexo_url ? {
        url: novaMensagem.anexo_url,
        tipo: novaMensagem.tipo_anexo,
        nome_arquivo: novaMensagem.nome_arquivo,
        tamanho: novaMensagem.tamanho_arquivo,
        duracao: novaMensagem.duracao_video
      } : null
    };

    res.status(200).json({
      success: true,
      data: resposta,
      message: 'Mensagem de oferta enviada com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao enviar mensagem de oferta'
    });
  }
});

router.post('/ofertas/:ofertaId/:contatoId/ler', verifyToken, async (req, res) => {
  try {
    const { ofertaId, contatoId } = req.params;
    const usuarioId = req.user.id;

    if (!isValidUUID(ofertaId)) {
      return res.status(400).json({
        success: false,
        error: 'ID da oferta invÃ¡lido'
      });
    }

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do contato invÃ¡lido'
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ lida: true })
      .eq('oferta_id', ofertaId)
      .eq('remetente_id', contatoId)
      .eq('destinatario_id', usuarioId)
      .eq('lida', false)
      .eq('oferta', true);

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar mensagens'
      });
    }

    res.json({
      success: true,
      message: 'Mensagens de oferta marcadas como lidas'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao marcar mensagens de oferta como lidas'
    });
  }
});

router.delete('/ofertas/mensagem/:mensagemId', verifyToken, async (req, res) => {
  try {
    const { mensagemId } = req.params;
    const usuarioId = req.user.id;

    const { data: mensagem, error: fetchError } = await supabaseAdmin
      .from('mensagens')
      .select('*')
      .eq('id', mensagemId)
      .eq('oferta', true)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        error: 'Mensagem de oferta nÃ£o encontrada'
      });
    }

    if (!mensagem) {
      return res.status(404).json({
        success: false,
        error: 'Mensagem de oferta nÃ£o encontrada'
      });
    }

    const isRemetente = mensagem.remetente_id === usuarioId;
    const isDestinatario = mensagem.destinatario_id === usuarioId;

    if (!isRemetente && !isDestinatario) {
      return res.status(403).json({
        success: false,
        error: 'VocÃª nÃ£o tem permissÃ£o para excluir esta mensagem de oferta'
      });
    }

    let updateData = {};
    if (isRemetente) {
      updateData.remetente_deletado = true;
    } else {
      updateData.destinatario_deletado = true;
    }

    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update(updateData)
      .eq('id', mensagemId);

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao excluir mensagem'
      });
    }

    res.json({
      success: true,
      message: 'Mensagem de oferta excluÃ­da com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao excluir mensagem de oferta'
    });
  }
});

router.post('/ofertas/upload', verifyToken, async (req, res) => {
  try {
    const { file_data, file_name, file_type } = req.body;
    const usuarioId = req.user.id;

    if (!file_data || !file_name) {
      return res.status(400).json({
        success: false,
        error: 'Dados do arquivo sÃ£o obrigatÃ³rios'
      });
    }

    let tipoAnexo = 'arquivo';
    if (file_type?.startsWith('image/')) {
      tipoAnexo = 'imagem';
    } else if (file_type?.startsWith('video/')) {
      tipoAnexo = 'video';
    }

    const timestamp = Date.now();
    const extensao = file_name.split('.').pop();
    const nomeArquivo = `oferta_${usuarioId}_${timestamp}.${extensao}`;
    const caminho = `mensagens/ofertas/${nomeArquivo}`;

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('mensagens')
      .upload(caminho, Buffer.from(file_data, 'base64'), {
        contentType: file_type,
        upsert: false
      });

    if (uploadError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao fazer upload do arquivo'
      });
    }

    const { data: urlData } = supabaseAdmin.storage
      .from('mensagens')
      .getPublicUrl(caminho);

    res.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        caminho: uploadData.path,
        nome_arquivo: file_name,
        tipo: tipoAnexo
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao fazer upload do arquivo para oferta'
    });
  }
});

router.get('/produto/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const produtoId = req.params.id;

    await verificarPropriedadeItem('produtos', produtoId, userId);

    const { data: produto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .select('*')
      .eq('id', produtoId)
      .single();

    if (produtoError) {
      return res.status(404).json({
        success: false,
        error: 'Produto nÃ£o encontrado'
      });
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('cidade, rua, bairro')
      .eq('id', userId)
      .single();

    const responseData = {
      ...produto,
      endereco_usuario: usuario || null
    };

    res.status(200).json({
      success: true,
      data: responseData
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
      error: 'Erro interno ao buscar dados do produto'
    });
  }
});

router.put('/editar_produto/:id', verifyToken, upload.array('imagens', 5), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const produtoId = req.params.id;
    const dadosProduto = req.body;
    const novasImagens = req.files || [];

    if (!dadosProduto.nome || dadosProduto.nome.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Nome do produto Ã© obrigatÃ³rio'
      });
    }

    if (!dadosProduto.valor || isNaN(parseFloat(dadosProduto.valor))) {
      return res.status(400).json({
        success: false,
        error: 'Valor do produto Ã© obrigatÃ³rio e deve ser um nÃºmero vÃ¡lido'
      });
    }

    let nomeCategoria = dadosProduto.categoria;
    let nomeSubcategoria = dadosProduto.subcategoria;

    if (dadosProduto.categoria && !isNaN(dadosProduto.categoria)) {
      const { data: categoriaData } = await supabaseAdmin
        .from('categorias')
        .select('nome')
        .eq('id', dadosProduto.categoria)
        .single();

      if (categoriaData) {
        nomeCategoria = categoriaData.nome;
      }
    }

    await verificarPropriedadeItem('produtos', produtoId, userId);

    const { data: produtoAtual, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .select('imagens')
      .eq('id', produtoId)
      .single();

    if (produtoError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar dados do produto'
      });
    }

    let imagensAtualizadas = produtoAtual.imagens || [];

    if (novasImagens.length > 0) {
      await deletarImagensAntigas(imagensAtualizadas, 'produtos/produtos');

      const novasUrls = await processarUploadImagens(novasImagens, 'produtos/produtos', 'produto');
      imagensAtualizadas = novasUrls;
    }

    const dadosAtualizar = {
      nome: dadosProduto.nome.trim(),
      valor: parseFloat(dadosProduto.valor),
      condicao: dadosProduto.condicao || null,
      categoria: nomeCategoria || null,
      descricao: dadosProduto.descricao ? dadosProduto.descricao.trim() : null,
      cidade: dadosProduto.cidade || null,
      rua: dadosProduto.rua || null,
      bairro: dadosProduto.bairro || null,
      entrega: dadosProduto.entrega === 'true' || dadosProduto.entrega === true,
      imagens: imagensAtualizadas,
      status: dadosProduto.status || 'ativo',
      Servicos: dadosProduto.Servicos || false,
      updated_at: new Date().toISOString()
    };

    const { data: produtoAtualizado, error: updateError } = await supabaseAdmin
      .from('produtos')
      .update(dadosAtualizar)
      .eq('id', produtoId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar produto no banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Produto atualizado com sucesso!',
      data: produtoAtualizado
    });

  } catch (error) {
    if (error.message.includes('permissÃ£o')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('nÃ£o encontrado')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Erro interno ao atualizar produto'
    });
  }
});

router.get('/servico/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const servicoId = req.params.id;

    await verificarPropriedadeItem('servicos', servicoId, userId);

    const { data: servico, error: servicoError } = await supabaseAdmin
      .from('servicos')
      .select('*')
      .eq('id', servicoId)
      .single();

    if (servicoError) {
      return res.status(404).json({
        success: false,
        error: 'ServiÃ§o nÃ£o encontrado'
      });
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('cidade, rua, bairro')
      .eq('id', userId)
      .single();

    const responseData = {
      ...servico,
      endereco_usuario: usuario || null
    };

    res.status(200).json({
      success: true,
      data: responseData
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
      error: 'Erro interno ao buscar dados do serviÃ§o'
    });
  }
});

router.put('/editar_servico/:id', verifyToken, upload.array('imagens', 5), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const servicoId = req.params.id;
    const dadosServico = req.body;
    const novasImagens = req.files || [];

    const camposObrigatorios = ['nome', 'categoria', 'tipo_valor', 'valor', 'telefone', 'horario_trabalho'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosServico[campo] || dadosServico[campo].toString().trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    await verificarPropriedadeItem('servicos', servicoId, userId);

    let nomeCategoria = dadosServico.categoria;
    let nomeSubcategoria = dadosServico.subcategoria;

    if (dadosServico.categoria && !isNaN(dadosServico.categoria)) {
      const { data: categoriaData } = await supabaseAdmin
        .from('categorias')
        .select('nome')
        .eq('id', dadosServico.categoria)
        .single();

      if (categoriaData) {
        nomeCategoria = categoriaData.nome;
      }
    }

    if (dadosServico.subcategoria && !isNaN(dadosServico.subcategoria)) {
      const { data: subcategoriaData } = await supabaseAdmin
        .from('subcategoria')
        .select('nome')
        .eq('id', dadosServico.subcategoria)
        .single();

      if (subcategoriaData) {
        nomeSubcategoria = subcategoriaData.nome;
      }
    }

    const { data: servicoAtual, error: servicoError } = await supabaseAdmin
      .from('servicos')
      .select('imagens')
      .eq('id', servicoId)
      .single();

    if (servicoError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar dados do serviÃ§o'
      });
    }

    let imagensAtualizadas = servicoAtual.imagens || [];

    if (novasImagens.length > 0) {
      await deletarImagensAntigas(imagensAtualizadas, 'produtos/servicos');

      const novasUrls = await processarUploadImagens(novasImagens, 'produtos/servicos', 'servico');
      imagensAtualizadas = novasUrls;
    }

    const dadosAtualizar = {
      nome: dadosServico.nome.trim(),
      categoria: nomeCategoria,
      subcategoria: nomeSubcategoria || null,
      tipo_valor: dadosServico.tipo_valor,
      valor: parseFloat(dadosServico.valor),
      descricao: dadosServico.descricao ? dadosServico.descricao.trim() : null,
      cidade: dadosServico.cidade || null,
      rua: dadosServico.rua || null,
      bairro: dadosServico.bairro || null,
      telefone: dadosServico.telefone,
      horario_trabalho: dadosServico.horario_trabalho,
      imagens: imagensAtualizadas,
      status: dadosServico.status || 'ativo',
      curtidas: parseInt(dadosServico.curtidas) || 0,
      updated_at: new Date().toISOString()
    };

    const { data: servicoAtualizado, error: updateError } = await supabaseAdmin
      .from('servicos')
      .update(dadosAtualizar)
      .eq('id', servicoId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar serviÃ§o no banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: 'ServiÃ§o atualizado com sucesso!',
      data: servicoAtualizado
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
      error: 'Erro interno ao atualizar serviÃ§o'
    });
  }
});

router.get('/propaganda/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const propagandaId = req.params.id;

    await verificarPropriedadeItem('produtos_propaganda', propagandaId, userId);

    const { data: propaganda, error: propagandaError } = await supabaseAdmin
      .from('produtos_propaganda')
      .select('*')
      .eq('id', propagandaId)
      .single();

    if (propagandaError) {
      return res.status(404).json({
        success: false,
        error: 'Propaganda nÃ£o encontrada'
      });
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('cidade, rua, bairro')
      .eq('id', userId)
      .single();

    const responseData = {
      ...propaganda,
      endereco_usuario: usuario || null
    };

    res.status(200).json({
      success: true,
      data: responseData
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
      error: 'Erro interno ao buscar dados da propaganda'
    });
  }
});

router.put('/editar_propaganda/:id', verifyToken, upload.array('imagens', 5), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const propagandaId = req.params.id;
    const dadosPropaganda = req.body;
    const novasImagens = req.files || [];

    const camposObrigatorios = ['nome', 'valor', 'condicao', 'categoria', 'nivel'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosPropaganda[campo] || dadosPropaganda[campo].toString().trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    let nomeCategoria = dadosPropaganda.categoria;
    let nomeSubcategoria = dadosPropaganda.subcategoria;

    if (dadosPropaganda.categoria && !isNaN(dadosPropaganda.categoria)) {
      const { data: categoriaData } = await supabaseAdmin
        .from('categorias')
        .select('nome')
        .eq('id', dadosPropaganda.categoria)
        .single();

      if (categoriaData) {
        nomeCategoria = categoriaData.nome;
      }
    }

    if (dadosPropaganda.subcategoria && !isNaN(dadosPropaganda.subcategoria)) {
      const { data: subcategoriaData } = await supabaseAdmin
        .from('subcategoria')
        .select('nome')
        .eq('id', dadosPropaganda.subcategoria)
        .single();

      if (subcategoriaData) {
        nomeSubcategoria = subcategoriaData.nome;
      }
    }

    await verificarPropriedadeItem('produtos_propaganda', propagandaId, userId);

    const { data: propagandaAtual, error: propagandaError } = await supabaseAdmin
      .from('produtos_propaganda')
      .select('imagens')
      .eq('id', propagandaId)
      .single();

    if (propagandaError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar dados da propaganda'
      });
    }

    let imagensAtualizadas = propagandaAtual.imagens || [];

    if (novasImagens.length > 0) {
      await deletarImagensAntigas(imagensAtualizadas, 'produtos/produtos');

      const novasUrls = await processarUploadImagens(novasImagens, 'produtos/produtos', 'produto');
      imagensAtualizadas = novasUrls;
    }

    const dadosAtualizar = {
      nome: dadosPropaganda.nome.trim(),
      valor: parseFloat(dadosPropaganda.valor),
      condicao: dadosPropaganda.condicao,
      categoria: nomeCategoria,
      subcategoria: nomeSubcategoria || null,
      descricao: dadosPropaganda.descricao ? dadosPropaganda.descricao.trim() : null,
      cidade: dadosPropaganda.cidade || null,
      rua: dadosPropaganda.rua || null,
      entrega: dadosPropaganda.entrega === 'true' || dadosPropaganda.entrega === true,
      imagens: imagensAtualizadas,
      nivel: dadosPropaganda.nivel,
      status: dadosPropaganda.status || 'ativo',
      tipo_valor: dadosPropaganda.tipo_valor || null,
      telefone: dadosPropaganda.telefone || null,
      horario_trabalho: dadosPropaganda.horario_trabalho || null,
      visualizacoes_restantes: dadosPropaganda.visualizacoes_restantes || 0,
      updated_at: new Date().toISOString()
    };

    const { data: propagandaAtualizada, error: updateError } = await supabaseAdmin
      .from('produtos_propaganda')
      .update(dadosAtualizar)
      .eq('id', propagandaId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar propaganda no banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Propaganda atualizada com sucesso!',
      data: propagandaAtualizada
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
      error: 'Erro interno ao atualizar propaganda'
    });
  }
});

router.get('/oferta/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const ofertaId = req.params.id;

    await verificarPropriedadeItem('ofertas', ofertaId, userId);

    const { data: oferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .select('*')
      .eq('id', ofertaId)
      .single();

    if (ofertaError) {
      return res.status(404).json({
        success: false,
        error: 'Oferta nÃ£o encontrada'
      });
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('cidade, rua, bairro')
      .eq('id', userId)
      .single();

    const responseData = {
      ...oferta,
      endereco_usuario: usuario || null
    };

    res.status(200).json({
      success: true,
      data: responseData
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
      error: 'Erro interno ao buscar dados da oferta'
    });
  }
});

router.put('/editar_oferta/:id', verifyToken, upload.array('imagens', 5), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const ofertaId = req.params.id;
    const dadosOferta = req.body;
    const novasImagens = req.files || [];

    const camposObrigatorios = ['nome', 'valor', 'condicao', 'categoria', 'desconto', 'data_inicio', 'data_fim'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosOferta[campo] || dadosOferta[campo].toString().trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    const dataInicio = new Date(dadosOferta.data_inicio);
    const dataFim = new Date(dadosOferta.data_fim);

    if (isNaN(dataInicio.getTime()) || isNaN(dataFim.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Datas invÃ¡lidas'
      });
    }

    if (dataFim <= dataInicio) {
      return res.status(400).json({
        success: false,
        error: 'Data de tÃ©rmino deve ser posterior Ã  data de inÃ­cio'
      });
    }

    const desconto = parseFloat(dadosOferta.desconto);
    if (isNaN(desconto) || desconto < 0 || desconto > 100) {
      return res.status(400).json({
        success: false,
        error: 'Desconto deve ser um valor entre 0 e 100'
      });
    }

    let nomeCategoria = dadosOferta.categoria;
    let nomeSubcategoria = dadosOferta.subcategoria;

    if (dadosOferta.categoria && !isNaN(dadosOferta.categoria)) {
      const { data: categoriaData } = await supabaseAdmin
        .from('categorias')
        .select('nome')
        .eq('id', dadosOferta.categoria)
        .single();

      if (categoriaData) {
        nomeCategoria = categoriaData.nome;
      }
    }

    if (dadosOferta.subcategoria && !isNaN(dadosOferta.subcategoria)) {
      const { data: subcategoriaData } = await supabaseAdmin
        .from('subcategoria')
        .select('nome')
        .eq('id', dadosOferta.subcategoria)
        .single();

      if (subcategoriaData) {
        nomeSubcategoria = subcategoriaData.nome;
      }
    }

    await verificarPropriedadeItem('ofertas', ofertaId, userId);

    const { data: ofertaAtual, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .select('imagens')
      .eq('id', ofertaId)
      .single();

    if (ofertaError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar dados da oferta'
      });
    }

    let imagensAtualizadas = ofertaAtual.imagens || [];

    if (novasImagens.length > 0) {
      await deletarImagensAntigas(imagensAtualizadas, 'produtos/ofertas');

      const novasUrls = await processarUploadImagens(novasImagens, 'produtos/ofertas', 'oferta');
      imagensAtualizadas = novasUrls;
    }

    const valorOriginal = parseFloat(dadosOferta.valor);
    const valorDesconto = valorOriginal * (1 - desconto / 100);
    const duracaoDias = Math.ceil((dataFim - dataInicio) / (1000 * 60 * 60 * 24));

    let ativa = false;
    if (dadosOferta.ativa !== undefined && dadosOferta.ativa !== null) {
      if (typeof dadosOferta.ativa === 'boolean') {
        ativa = dadosOferta.ativa;
      } else if (typeof dadosOferta.ativa === 'string') {
        ativa = dadosOferta.ativa.toLowerCase() === 'true' ||
          dadosOferta.ativa === '1' ||
          dadosOferta.ativa === 'yes' ||
          dadosOferta.ativa === 'on';
      } else if (typeof dadosOferta.ativa === 'number') {
        ativa = dadosOferta.ativa === 1;
      }
    }

    const dadosAtualizar = {
      nome: dadosOferta.nome.trim(),
      valor: valorOriginal,
      condicao: dadosOferta.condicao,
      categoria: nomeCategoria,
      descricao: dadosOferta.descricao ? dadosOferta.descricao.trim() : null,
      cidade: dadosOferta.cidade || null,
      rua: dadosOferta.rua || null,
      entrega: dadosOferta.entrega === 'true' || dadosOferta.entrega === true,
      imagens: imagensAtualizadas,
      data_inicio: dataInicio.toISOString(),
      duracao_dias: duracaoDias,
      desconto: desconto,
      ativa: ativa,
      telefone: dadosOferta.telefone || null,
      updated_at: new Date().toISOString()
    };

    const { data: ofertaAtualizada, error: updateError } = await supabaseAdmin
      .from('ofertas')
      .update(dadosAtualizar)
      .eq('id', ofertaId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar oferta no banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Oferta atualizada com sucesso!',
      data: ofertaAtualizada
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
      error: 'Erro interno ao atualizar oferta'
    });
  }
});

router.get('/novidade/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const novidadeId = req.params.id;

    await verificarPropriedadeItem('novidades', novidadeId, userId);

    const { data: novidade, error: novidadeError } = await supabaseAdmin
      .from('novidades')
      .select('*')
      .eq('id', novidadeId)
      .single();

    if (novidadeError) {
      return res.status(404).json({
        success: false,
        error: 'Novidade nÃ£o encontrada'
      });
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('cidade, rua, bairro')
      .eq('id', userId)
      .single();

    const responseData = {
      ...novidade,
      endereco_usuario: usuario || null
    };

    res.status(200).json({
      success: true,
      data: responseData
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
      error: 'Erro interno ao buscar dados da novidade'
    });
  }
});

router.put('/editar_novidade/:id', verifyToken, upload.array('imagens', 5), handleMulterError, async (req, res) => {
  try {
    const userId = req.user.id;
    const novidadeId = req.params.id;
    const dadosNovidade = req.body;
    const novasImagens = req.files || [];

    const camposObrigatorios = ['nome', 'valor', 'condicao', 'categoria'];
    const camposFaltantes = camposObrigatorios.filter(campo => !dadosNovidade[campo] || dadosNovidade[campo].toString().trim() === '');

    if (camposFaltantes.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Campos obrigatÃ³rios faltando: ${camposFaltantes.join(', ')}`
      });
    }

    let nomeCategoria = dadosNovidade.categoria;
    let nomeSubcategoria = dadosNovidade.subcategoria;

    if (dadosNovidade.categoria && !isNaN(dadosNovidade.categoria)) {
      const { data: categoriaData } = await supabaseAdmin
        .from('categorias')
        .select('nome')
        .eq('id', dadosNovidade.categoria)
        .single();

      if (categoriaData) {
        nomeCategoria = categoriaData.nome;
      }
    }

    if (dadosNovidade.subcategoria && !isNaN(dadosNovidade.subcategoria)) {
      const { data: subcategoriaData } = await supabaseAdmin
        .from('subcategoria')
        .select('nome')
        .eq('id', dadosNovidade.subcategoria)
        .single();

      if (subcategoriaData) {
        nomeSubcategoria = subcategoriaData.nome;
      }
    }

    await verificarPropriedadeItem('novidades', novidadeId, userId);

    const { data: novidadeAtual, error: novidadeError } = await supabaseAdmin
      .from('novidades')
      .select('imagens')
      .eq('id', novidadeId)
      .single();

    if (novidadeError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar dados da novidade'
      });
    }

    let imagensAtualizadas = novidadeAtual.imagens || [];

    if (novasImagens.length > 0) {
      await deletarImagensAntigas(imagensAtualizadas, 'produtos/produtos');

      const novasUrls = await processarUploadImagens(novasImagens, 'produtos/produtos', 'novidade');
      imagensAtualizadas = novasUrls;
    }

    const dadosAtualizar = {
      nome: dadosNovidade.nome.trim(),
      valor: parseFloat(dadosNovidade.valor),
      condicao: dadosNovidade.condicao,
      categoria: nomeCategoria,
      descricao: dadosNovidade.descricao ? dadosNovidade.descricao.trim() : null,
      cidade: dadosNovidade.cidade || null,
      rua: dadosNovidade.rua || null,
      entrega: dadosNovidade.entrega === 'true' || dadosNovidade.entrega === true,
      imagens: imagensAtualizadas,
      destaque: dadosNovidade.destaque === 'true' || dadosNovidade.destaque === true,
      updated_at: new Date().toISOString()
    };

    const { data: novidadeAtualizada, error: updateError } = await supabaseAdmin
      .from('novidades')
      .update(dadosAtualizar)
      .eq('id', novidadeId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao atualizar novidade no banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Novidade atualizada com sucesso!',
      data: novidadeAtualizada
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
      error: 'Erro interno ao atualizar novidade'
    });
  }
});

router.delete('/:tipo/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tipo, id } = req.params;

    const tabelas = {
      produto: 'produtos',
      servico: 'servicos',
      propaganda: 'produtos_propaganda',
      oferta: 'ofertas',
      novidade: 'novidades'
    };

    const tabela = tabelas[tipo];
    if (!tabela) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de item invÃ¡lido'
      });
    }

    await verificarPropriedadeItem(tabela, id, userId);

    const { data: item, error: itemError } = await supabaseAdmin
      .from(tabela)
      .select('imagens')
      .eq('id', id)
      .single();

    if (itemError) {
      return res.status(404).json({
        success: false,
        error: 'Erro ao buscar item para exclusÃ£o'
      });
    }

    if (item.imagens && item.imagens.length > 0) {
      const bucketName = `${tipo}s`;
      await deletarImagensAntigas(item.imagens, bucketName);
    }

    const { error: deleteError } = await supabaseAdmin
      .from(tabela)
      .delete()
      .eq('id', id);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao excluir item do banco de dados'
      });
    }

    res.status(200).json({
      success: true,
      message: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} excluÃ­do com sucesso!`
    });

  } catch (error) {
    if (error.message.includes('permissÃ£o')) {
      return res.status(403).json({
        success: false,
        error: error.message
      });
    }

    if (error.message.includes('nÃ£o encontrado')) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Erro interno ao excluir item'
    });
  }
});

router.get('/categorias/:tipo', verifyToken, async (req, res) => {
  try {
    const { tipo } = req.params;

    const tabelasCategorias = {
      produto: 'categorias',
      servico: 'categorias',
      propaganda: 'categorias',
      oferta: 'categorias',
      novidade: 'categorias'
    };

    const tabela = tabelasCategorias[tipo];
    if (!tabela) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de categoria invÃ¡lido'
      });
    }

    let query = supabaseAdmin
      .from(tabela)
      .select('*')
      .order('nome', { ascending: true });

    if (tipo === 'servico') {
      query = query.eq('tipo', 'servicos');
    }

    const { data: categorias, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar categorias'
      });
    }

    let subcategorias = [];
    if (tipo === 'servico') {
      const { data: subs } = await supabaseAdmin
        .from('subcategoria')
        .select('*')
        .order('nome', { ascending: true });

      if (subs) {
        subcategorias = subs;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        categorias: categorias || [],
        subcategorias: subcategorias
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar categorias'
    });
  }
});

router.get('/subcategorias/:categoriaId', verifyToken, async (req, res) => {
  try {
    const { categoriaId } = req.params;

    const { data: subcategorias, error } = await supabaseAdmin
      .from('subcategoria')
      .select('*')
      .eq('categoria_id', categoriaId)
      .order('nome', { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar subcategorias'
      });
    }

    res.status(200).json({
      success: true,
      data: subcategorias || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar subcategorias'
    });
  }
});

router.get('/tipos-valor', verifyToken, async (req, res) => {
  try {
    const tiposValor = [
      { id: 'por_hora', nome: 'Por Hora' },
      { id: 'por_servico', nome: 'Por ServiÃ§o' },
      { id: 'orcamento', nome: 'OrÃ§amento' },
      { id: 'diaria', nome: 'DiÃ¡ria' },
      { id: 'unidade', nome: 'Por Unidade' },
      { id: 'pacote', nome: 'Pacote' }
    ];

    res.status(200).json({
      success: true,
      data: tiposValor
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar tipos de valor'
    });
  }
});

router.get('/niveis-propaganda', verifyToken, async (req, res) => {
  try {
    const niveisPropaganda = [
      { nivel: 'basico', valor: 49.90, descricao: 'Visibilidade bÃ¡sica por 7 dias', icone: 'ðŸŒŸ' },
      { nivel: 'intermediario', valor: 99.90, descricao: 'Destaque mÃ©dio por 15 dias', icone: 'âš¡' },
      { nivel: 'premium', valor: 199.90, descricao: 'Destaque mÃ¡ximo por 30 dias', icone: 'ðŸ”¥' }
    ];

    res.status(200).json({
      success: true,
      data: niveisPropaganda
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao buscar nÃ­veis de propaganda'
    });
  }
});

const verificarLojaExistente = async (userId) => {
  try {
    const { data: lojaExistente, error: lojaError } = await supabaseAdmin
      .from('loja')
      .select('id, nome')
      .eq('usuario_id', userId)
      .eq('ativa', true)
      .single();

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

router.get('/verificar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    let lojaExistente;
    try {
      lojaExistente = await verificarLojaExistente(userId);
    } catch (error) {
      return res.status(503).json({
        success: false,
        error: 'ServiÃ§o temporariamente indisponÃ­vel. Tente novamente em alguns instantes.'
      });
    }

    let mensagensAnunciosNaoLidas = 0;
    try {
      const { count } = await supabaseAdmin
        .from('mensagens_propaganda')
        .select('*', { count: 'exact', head: true })
        .eq('destinatario_id', userId)
        .eq('lida', false)
        .neq('remetente_id', userId);

      mensagensAnunciosNaoLidas = count || 0;
    } catch (error) {
    }

    let mensagensOfertasNaoLidas = 0;
    try {
      const { count } = await supabaseAdmin
        .from('mensagens')
        .select('*', { count: 'exact', head: true })
        .eq('destinatario_id', userId)
        .eq('lida', false)
        .eq('oferta', true)
        .neq('remetente_id', userId);

      mensagensOfertasNaoLidas = count || 0;
    } catch (error) {
    }

    const totalMensagensPendentes = mensagensAnunciosNaoLidas + mensagensOfertasNaoLidas;

    const response = {
      success: true,
      possui_loja: !!lojaExistente,
      notificacoes: {
        total_mensagens_pendentes: totalMensagensPendentes,
        chat_anuncios: {
          pendentes: mensagensAnunciosNaoLidas
        },
        chat_ofertas: {
          pendentes: mensagensOfertasNaoLidas
        }
      }
    };

    if (lojaExistente) {
      response.data = lojaExistente;
      response.message = 'UsuÃ¡rio jÃ¡ possui uma loja cadastrada';
    } else {
      response.message = 'UsuÃ¡rio nÃ£o possui loja cadastrada';
    }

    res.status(200).json(response);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao verificar loja e notificaÃ§Ãµes'
    });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    const { data: mensagens, error: mensagensError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .select('*')
      .or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`)
      .or(`and(remetente_id.eq.${userId},remetente_deletado.is.false),and(destinatario_id.eq.${userId},destinatario_deletado.is.false)`)
      .is('oferta', false)
      .order('data_hora', { ascending: false });

    if (mensagensError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar mensagens'
      });
    }

    if (!mensagens || mensagens.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 10, hasNext: false }
      });
    }

    const conversasMap = new Map();

    mensagens.forEach(msg => {
      const produtoId = msg.produto_id;
      const outroUsuarioId = msg.remetente_id === userId ? msg.destinatario_id : msg.remetente_id;
      const chaveConversa = `${produtoId}_${outroUsuarioId}`;

      if (!conversasMap.has(chaveConversa) ||
        new Date(msg.data_hora) > new Date(conversasMap.get(chaveConversa).ultima_mensagem_hora)) {

        conversasMap.set(chaveConversa, {
          produto_id: produtoId,
          contato_id: outroUsuarioId,
          ultima_mensagem: msg.mensagem,
          ultima_mensagem_hora: msg.data_hora,
          anexo_url: msg.anexo_url,
          tipo_anexo: msg.tipo_anexo,
          eh_remetente: msg.remetente_id === userId
        });
      }
    });

    const totalConversas = conversasMap.size;
    const conversasArray = Array.from(conversasMap.values());
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const conversasPaginadas = conversasArray.slice(startIndex, endIndex);

    const produtoIds = conversasPaginadas.map(c => c.produto_id);
    const contatoIds = [...new Set(conversasPaginadas.map(c => c.contato_id))];

    const { data: produtos, error: produtosError } = await supabaseAdmin
      .from('produtos')
      .select('id, nome, valor, imagens')
      .in('id', produtoIds);

    if (produtosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar produtos'
      });
    }

    const { data: contatos, error: contatosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url, cidade')
      .in('id', contatoIds);

    if (contatosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar contatos'
      });
    }

    const conversas = conversasPaginadas.map(conversa => {
      const produto = produtos.find(p => p.id === conversa.produto_id);
      const contato = contatos.find(c => c.id === conversa.contato_id);

      const mensagensNaoLidas = mensagens.filter(msg =>
        msg.produto_id === conversa.produto_id &&
        msg.destinatario_id === userId &&
        msg.remetente_id === conversa.contato_id &&
        !msg.lida &&
        !msg.oferta
      ).length;

      return {
        id: `${conversa.produto_id}_${conversa.contato_id}`,
        produto: {
          id: produto?.id || conversa.produto_id,
          nome: produto?.nome || 'Produto nÃ£o encontrado',
          valor: produto?.valor || 0,
          imagens: produto?.imagens || []
        },
        contato: {
          id: contato?.id || conversa.contato_id,
          nome: contato?.nome || 'UsuÃ¡rio nÃ£o encontrado',
          foto: contato?.imagem_url || null,
          cidade: contato?.cidade || 'Cidade nÃ£o informada'
        },
        ultima_mensagem: conversa.ultima_mensagem,
        ultima_mensagem_hora: conversa.ultima_mensagem_hora,
        nao_lidas: mensagensNaoLidas,
        eh_remetente: conversa.eh_remetente,
        tem_anexo: !!conversa.anexo_url,
        tipo_anexo: conversa.tipo_anexo
      };
    });

    conversas.sort((a, b) => new Date(b.ultima_mensagem_hora) - new Date(a.ultima_mensagem_hora));

    res.json({
      success: true,
      data: conversas,
      meta: {
        total: totalConversas,
        page: parseInt(page),
        limit: parseInt(limit),
        hasNext: totalConversas > page * limit
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar conversas'
    });
  }
});

module.exports = router;


