const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const { enviarNotificacaoRealtime } = require('./chatRealtime.js');

const router = express.Router();

// Helper para validaÃ§Ã£o de UUID
const isValidUUID = (id) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
};

/**
 * ROTA: Obter mensagens de uma conversa especÃ­fica
 * GET /api/chat-conversa/:produtoId/:contatoId
 */
router.get('/:produtoId/:contatoId', verifyToken, async (req, res) => {
  try {
    const { produtoId, contatoId } = req.params;
    const usuarioId = req.user.id;

    // ValidaÃ§Ãµes
    const produtoIdNum = parseInt(produtoId);
    if (isNaN(produtoIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato invÃ¡lido'
      });
    }

    // Consulta otimizada
    const { data: mensagens, error } = await supabaseAdmin
      .from('mensagens')
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        produto_id,
        remetente_deletado,
        destinatario_deletado,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video,
        oferta
      `)
      .eq('produto_id', produtoIdNum)
      .or(`and(remetente_id.eq.${usuarioId},destinatario_id.eq.${contatoId}),and(remetente_id.eq.${contatoId},destinatario_id.eq.${usuarioId})`)
      .or(`and(remetente_id.eq.${usuarioId},remetente_deletado.is.false),and(destinatario_id.eq.${usuarioId},destinatario_deletado.is.false)`)
      .is('oferta', false)
      .order('data_hora', { ascending: true });

    if (error) {
      throw error;
    }

    if (!mensagens || mensagens.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          total: 0,
          enviadas: 0,
          recebidas: 0,
          nao_lidas: 0,
          com_anexos: 0
        }
      });
    }

    // Buscar informaÃ§Ãµes dos usuÃ¡rios
    const usuarioIds = [...new Set(mensagens.map(msg => [msg.remetente_id, msg.destinatario_id]).flat())];

    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url')
      .in('id', usuarioIds);

    if (usuariosError) {
      throw usuariosError;
    }

    // Criar mapa de usuÃ¡rios para acesso rÃ¡pido
    const usuariosMap = new Map();
    usuarios.forEach(usuario => {
      usuariosMap.set(usuario.id, usuario);
    });

    // Formatar resposta
    const resposta = mensagens.map(msg => {
      const enviadaPorMim = msg.remetente_id === usuarioId;
      const remetente = usuariosMap.get(msg.remetente_id);
      const destinatario = usuariosMap.get(msg.destinatario_id);

      return {
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

        // Campos de anexo
        anexo: msg.anexo_url ? {
          url: msg.anexo_url,
          tipo: msg.tipo_anexo || 'arquivo',
          nome_arquivo: msg.nome_arquivo,
          tamanho: msg.tamanho_arquivo,
          duracao: msg.duracao_video
        } : null
      };
    });

    res.status(200).json({
      success: true,
      data: resposta,
      meta: {
        total: resposta.length,
        enviadas: resposta.filter(m => m.enviada_por_mim).length,
        recebidas: resposta.filter(m => !m.enviada_por_mim).length,
        nao_lidas: resposta.filter(m => m.nao_lida).length,
        com_anexos: resposta.filter(m => m.anexo).length
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao carregar mensagens',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

/**
 * ROTA: Enviar mensagem COM REALTIME
 * POST /api/chat-conversa
 */
router.post('/', verifyToken, async (req, res) => {
  try {
    const { produto_id, destinatario_id, mensagem, anexo } = req.body;
    const remetente_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!destinatario_id || !isValidUUID(destinatario_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_DESTINATARIO_INVALIDO',
        message: 'ID do destinatÃ¡rio invÃ¡lido'
      });
    }

    if (!mensagem && !anexo?.url) {
      return res.status(400).json({
        success: false,
        error: 'MENSAGEM_VAZIA',
        message: 'A mensagem nÃ£o pode estar vazia'
      });
    }

    // Dados para inserÃ§Ã£o
    const mensagemData = {
      remetente_id,
      destinatario_id,
      produto_id: Number(produto_id),
      mensagem: (mensagem || '').trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: false
    };

    // Adicionar dados do anexo
    if (anexo?.url) {
      mensagemData.anexo_url = anexo.url;
      mensagemData.tipo_anexo = anexo.tipo || 'arquivo';
      mensagemData.nome_arquivo = anexo.nome_arquivo;
      mensagemData.tamanho_arquivo = anexo.tamanho;

      if (anexo.tipo === 'video' && anexo.duracao) {
        mensagemData.duracao_video = anexo.duracao;
      }
    }

    // Inserir mensagem no banco
    const { data: novaMensagem, error } = await supabaseAdmin
      .from('mensagens')
      .insert([mensagemData])
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        produto_id,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video
      `)
      .single();

    if (error) {
      throw error;
    }

    // Enviar notificaÃ§Ã£o realtime para o destinatÃ¡rio
    try {
      // Buscar informaÃ§Ãµes do remetente para o payload
      const { data: remetenteInfo } = await supabaseAdmin
        .from('usuarios')
        .select('nome, imagem_url')
        .eq('id', remetente_id)
        .single();

      // Buscar informaÃ§Ãµes do produto
      const { data: produtoInfo } = await supabaseAdmin
        .from('produtos')
        .select('nome, imagens')
        .eq('id', produto_id)
        .single();

      // Preparar payload para realtime
      const payloadRealtime = {
        tipo: 'nova_mensagem',
        mensagem: {
          ...novaMensagem,
          enviada_por_mim: false,
          remetente_nome: remetenteInfo?.nome || 'UsuÃ¡rio',
          remetente_foto: remetenteInfo?.imagem_url
        },
        conversaId: `${produto_id}_${remetente_id}`,
        remetente: {
          id: remetente_id,
          nome: remetenteInfo?.nome || 'UsuÃ¡rio',
          foto: remetenteInfo?.imagem_url
        },
        produto: {
          id: produto_id,
          nome: produtoInfo?.nome || 'Produto',
          imagens: produtoInfo?.imagens || []
        },
        timestamp: new Date().toISOString()
      };

      // Enviar notificaÃ§Ã£o em tempo real
      await enviarNotificacaoRealtime(destinatario_id, payloadRealtime);
    } catch (realtimeError) {
      // Continua mesmo se realtime falhar
    }

    // Buscar informaÃ§Ãµes do remetente para a resposta
    const { data: remetente } = await supabaseAdmin
      .from('usuarios')
      .select('nome, imagem_url')
      .eq('id', remetente_id)
      .single();

    // Resposta atualizada
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
      nao_lida: false,
      status: 'enviada',
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
      message: anexo?.url ? 'Mensagem com anexo enviada' : 'Mensagem enviada',
      realtime: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao enviar mensagem',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

/**
 * ROTA: Marcar mensagens como lidas
 * POST /api/chat-conversa/:produtoId/:contatoId/ler
 */
router.post('/:produtoId/:contatoId/ler', verifyToken, async (req, res) => {
  try {
    const { produtoId, contatoId } = req.params;
    const usuarioId = req.user.id;

    const produtoIdNum = parseInt(produtoId);
    if (isNaN(produtoIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato invÃ¡lido'
      });
    }

    // Atualizar mensagens nÃ£o lidas
    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ lida: true })
      .eq('produto_id', produtoIdNum)
      .eq('remetente_id', contatoId)
      .eq('destinatario_id', usuarioId)
      .eq('lida', false)
      .is('oferta', false);

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao marcar mensagens como lidas'
    });
  }
});

/**
 * ROTA: Upload de arquivo
 * POST /api/chat-conversa/upload
 */
router.post('/upload', verifyToken, async (req, res) => {
  try {
    const { file_data, file_name, file_type } = req.body;
    const usuarioId = req.user.id;

    if (!file_data || !file_name) {
      return res.status(400).json({
        success: false,
        error: 'DADOS_ARQUIVO_INVALIDOS',
        message: 'Dados do arquivo sÃ£o obrigatÃ³rios'
      });
    }

    // Determinar tipo de arquivo
    let tipoAnexo = 'arquivo';
    if (file_type?.startsWith('image/')) {
      tipoAnexo = 'imagem';
    } else if (file_type?.startsWith('video/')) {
      tipoAnexo = 'video';
    }

    // Gerar nome Ãºnico
    const timestamp = Date.now();
    const extensao = file_name.split('.').pop();
    const nomeArquivo = `${usuarioId}_${timestamp}.${extensao}`;
    const caminho = `mensagens/${tipoAnexo}s/${nomeArquivo}`;

    // Fazer upload para Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('mensagens')
      .upload(caminho, Buffer.from(file_data, 'base64'), {
        contentType: file_type,
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    // Obter URL pÃºblica
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
      error: 'ERRO_UPLOAD',
      message: 'Erro ao fazer upload do arquivo'
    });
  }
});


router.delete('/:mensagemId', verifyToken, async (req, res) => {
  try {
    const { mensagemId } = req.params;
    const usuarioId = req.user.id;

    // Buscar a mensagem para verificar permissÃ£o
    const { data: mensagem, error: fetchError } = await supabaseAdmin
      .from('mensagens')
      .select('*')
      .eq('id', mensagemId)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        error: 'MENSAGEM_NAO_ENCONTRADA',
        message: 'Mensagem nÃ£o encontrada',
        details: fetchError.message
      });
    }

    if (!mensagem) {
      return res.status(404).json({
        success: false,
        error: 'MENSAGEM_NAO_ENCONTRADA',
        message: 'Mensagem nÃ£o encontrada'
      });
    }

    // Verificar se o usuÃ¡rio tem permissÃ£o (remetente ou destinatÃ¡rio)
    const isRemetente = mensagem.remetente_id === usuarioId;
    const isDestinatario = mensagem.destinatario_id === usuarioId;

    if (!isRemetente && !isDestinatario) {
      return res.status(403).json({
        success: false,
        error: 'PERMISSAO_NEGADA',
        message: 'VocÃª nÃ£o tem permissÃ£o para excluir esta mensagem'
      });
    }

    // Marcar como deletada para o usuÃ¡rio
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
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Mensagem excluÃ­da com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao excluir mensagem',
      details: error?.message || 'Erro desconhecido'
    });
  }
});


//==================== ROTA: CONVERSAS PROPAGANDA ====================

/**
 * ROTA: Obter mensagens de uma conversa especÃ­fica
 * GET /api/chat-conversa/:produtoId/:contatoId
 */
router.get('/propaganda/:produtoId/:contatoId', verifyToken, async (req, res) => {
  try {
    const { produtoId, contatoId } = req.params;
    const usuarioId = req.user.id;

    // ValidaÃ§Ãµes
    const produtoIdNum = parseInt(produtoId);
    if (isNaN(produtoIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato invÃ¡lido'
      });
    }

    // Consulta otimizada
    const { data: mensagens, error } = await supabaseAdmin
      .from('mensagens_propaganda')
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        produto_id,
        remetente_deletado,
        destinatario_deletado,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video,
        oferta
      `)
      .eq('produto_id', produtoIdNum)
      .or(`and(remetente_id.eq.${usuarioId},destinatario_id.eq.${contatoId}),and(remetente_id.eq.${contatoId},destinatario_id.eq.${usuarioId})`)
      .or(`and(remetente_id.eq.${usuarioId},remetente_deletado.is.false),and(destinatario_id.eq.${usuarioId},destinatario_deletado.is.false)`)
      .is('oferta', false)
      .order('data_hora', { ascending: true });

    if (error) {
      throw error;
    }

    if (!mensagens || mensagens.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        meta: {
          total: 0,
          enviadas: 0,
          recebidas: 0,
          nao_lidas: 0,
          com_anexos: 0
        }
      });
    }

    // Buscar informaÃ§Ãµes dos usuÃ¡rios
    const usuarioIds = [...new Set(mensagens.map(msg => [msg.remetente_id, msg.destinatario_id]).flat())];

    const { data: usuarios, error: usuariosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url')
      .in('id', usuarioIds);

    if (usuariosError) {
      throw usuariosError;
    }

    // Criar mapa de usuÃ¡rios para acesso rÃ¡pido
    const usuariosMap = new Map();
    usuarios.forEach(usuario => {
      usuariosMap.set(usuario.id, usuario);
    });

    // Formatar resposta
    const resposta = mensagens.map(msg => {
      const enviadaPorMim = msg.remetente_id === usuarioId;
      const remetente = usuariosMap.get(msg.remetente_id);
      const destinatario = usuariosMap.get(msg.destinatario_id);

      return {
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

        // Campos de anexo
        anexo: msg.anexo_url ? {
          url: msg.anexo_url,
          tipo: msg.tipo_anexo || 'arquivo',
          nome_arquivo: msg.nome_arquivo,
          tamanho: msg.tamanho_arquivo,
          duracao: msg.duracao_video
        } : null
      };
    });

    res.status(200).json({
      success: true,
      data: resposta,
      meta: {
        total: resposta.length,
        enviadas: resposta.filter(m => m.enviada_por_mim).length,
        recebidas: resposta.filter(m => !m.enviada_por_mim).length,
        nao_lidas: resposta.filter(m => m.nao_lida).length,
        com_anexos: resposta.filter(m => m.anexo).length
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao carregar mensagens',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

/**
 * ROTA: Marcar mensagens como lidas
 * POST /api/chat-conversa/:produtoId/:contatoId/ler
 */
router.post('/propaganda/:produtoId/:contatoId/ler', verifyToken, async (req, res) => {
  try {
    const { produtoId, contatoId } = req.params;
    const usuarioId = req.user.id;

    const produtoIdNum = parseInt(produtoId);
    if (isNaN(produtoIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!isValidUUID(contatoId)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato invÃ¡lido'
      });
    }

    // Atualizar mensagens nÃ£o lidas
    const { error: updateError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .update({ lida: true })
      .eq('produto_id', produtoIdNum)
      .eq('remetente_id', contatoId)
      .eq('destinatario_id', usuarioId)
      .eq('lida', false)
      .is('oferta', false);

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao marcar mensagens como lidas'
    });
  }
});

/**
 * ROTA: Enviar mensagem COM REALTIME
 * POST /api/chat-conversa
 */
router.post('/propaganda', verifyToken, async (req, res) => {
  try {
    const { produto_id, destinatario_id, mensagem, anexo } = req.body;
    const remetente_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto invÃ¡lido'
      });
    }

    if (!destinatario_id || !isValidUUID(destinatario_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_DESTINATARIO_INVALIDO',
        message: 'ID do destinatÃ¡rio invÃ¡lido'
      });
    }

    if (!mensagem && !anexo?.url) {
      return res.status(400).json({
        success: false,
        error: 'MENSAGEM_VAZIA',
        message: 'A mensagem nÃ£o pode estar vazia'
      });
    }

    // Dados para inserÃ§Ã£o
    const mensagemData = {
      remetente_id,
      destinatario_id,
      produto_id: Number(produto_id),
      mensagem: (mensagem || '').trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: false
    };

    // Adicionar dados do anexo
    if (anexo?.url) {
      mensagemData.anexo_url = anexo.url;
      mensagemData.tipo_anexo = anexo.tipo || 'arquivo';
      mensagemData.nome_arquivo = anexo.nome_arquivo;
      mensagemData.tamanho_arquivo = anexo.tamanho;

      if (anexo.tipo === 'video' && anexo.duracao) {
        mensagemData.duracao_video = anexo.duracao;
      }
    }

    // Inserir mensagem no banco
    const { data: novaMensagem, error } = await supabaseAdmin
      .from('mensagens_propaganda')
      .insert([mensagemData])
      .select(`
        id,
        mensagem,
        data_hora,
        lida,
        remetente_id,
        destinatario_id,
        produto_id,
        anexo_url,
        tipo_anexo,
        nome_arquivo,
        tamanho_arquivo,
        duracao_video
      `)
      .single();

    if (error) {
      throw error;
    }

    // Enviar notificaÃ§Ã£o realtime para o destinatÃ¡rio
    try {
      // Buscar informaÃ§Ãµes do remetente para o payload
      const { data: remetenteInfo } = await supabaseAdmin
        .from('usuarios')
        .select('nome, imagem_url')
        .eq('id', remetente_id)
        .single();

      // Buscar informaÃ§Ãµes do produto
      const { data: produtoInfo } = await supabaseAdmin
        .from('produtos_propaganda')
        .select('nome, imagens')
        .eq('id', produto_id)
        .single();

      // Preparar payload para realtime
      const payloadRealtime = {
        tipo: 'nova_mensagem',
        mensagem: {
          ...novaMensagem,
          enviada_por_mim: false,
          remetente_nome: remetenteInfo?.nome || 'UsuÃ¡rio',
          remetente_foto: remetenteInfo?.imagem_url
        },
        conversaId: `${produto_id}_${remetente_id}`,
        remetente: {
          id: remetente_id,
          nome: remetenteInfo?.nome || 'UsuÃ¡rio',
          foto: remetenteInfo?.imagem_url
        },
        produto: {
          id: produto_id,
          nome: produtoInfo?.nome || 'Produto',
          imagens: produtoInfo?.imagens || []
        },
        timestamp: new Date().toISOString()
      };

      // Enviar notificaÃ§Ã£o em tempo real
      await enviarNotificacaoRealtime(destinatario_id, payloadRealtime);
    } catch (realtimeError) {
      // Continua mesmo se realtime falhar
    }

    // Buscar informaÃ§Ãµes do remetente para a resposta
    const { data: remetente } = await supabaseAdmin
      .from('usuarios')
      .select('nome, imagem_url')
      .eq('id', remetente_id)
      .single();

    // Resposta atualizada
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
      nao_lida: false,
      status: 'enviada',
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
      message: anexo?.url ? 'Mensagem com anexo enviada' : 'Mensagem enviada',
      realtime: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao enviar mensagem',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

/**
 * ROTA: Upload de arquivo COM VALIDAÃ‡ÃƒO DE TAMANHO
 * POST /api/chat-conversa/propaganda/upload
 */
router.post('/propaganda/upload', verifyToken, async (req, res) => {
  try {
    const { file_data, file_name, file_type } = req.body;
    const usuarioId = req.user.id;

    if (!file_data || !file_name) {
      return res.status(400).json({
        success: false,
        error: 'DADOS_ARQUIVO_INVALIDOS',
        message: 'Dados do arquivo sÃ£o obrigatÃ³rios'
      });
    }

    // VALIDAÃ‡ÃƒO DE TAMANHO (previne "request entity too large")
    const tamanhoBase64 = file_data.length;
    const tamanhoEstimadoBytes = (tamanhoBase64 * 3) / 4;

    // Definir limites
    const LIMITE_GERAL = 25 * 1024 * 1024;
    const LIMITE_IMAGEM = 10 * 1024 * 1024;
    const LIMITE_VIDEO = 50 * 1024 * 1024;

    // Determinar tipo de arquivo e validar tamanho
    let tipoAnexo = 'arquivo';
    let limiteAplicavel = LIMITE_GERAL;

    if (file_type?.startsWith('image/')) {
      tipoAnexo = 'imagem';
      limiteAplicavel = LIMITE_IMAGEM;
    } else if (file_type?.startsWith('video/')) {
      tipoAnexo = 'video';
      limiteAplicavel = LIMITE_VIDEO;
    }

    // Verificar se excede o limite
    if (tamanhoEstimadoBytes > limiteAplicavel) {
      const tamanhoMB = (limiteAplicavel / (1024 * 1024)).toFixed(1);
      return res.status(413).json({
        success: false,
        error: 'ARQUIVO_MUITO_GRANDE',
        message: `Arquivo muito grande. Limite para ${tipoAnexo}s: ${tamanhoMB}MB`,
        maxSize: limiteAplicavel
      });
    }

    // Gerar nome Ãºnico
    const timestamp = Date.now();
    const extensao = file_name.split('.').pop();
    const nomeArquivo = `${usuarioId}_${timestamp}.${extensao}`;
    const caminho = `mensagens/${tipoAnexo}s/${nomeArquivo}`;

    // Fazer upload para Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('mensagens')
      .upload(caminho, Buffer.from(file_data, 'base64'), {
        contentType: file_type,
        upsert: false,
        cacheControl: '3600'
      });

    if (uploadError) {
      throw uploadError;
    }

    // Obter URL pÃºblica
    const { data: urlData } = supabaseAdmin.storage
      .from('mensagens')
      .getPublicUrl(caminho);

    // Calcular tamanho real
    const tamanhoRealBytes = Buffer.from(file_data, 'base64').length;

    res.json({
      success: true,
      data: {
        url: urlData.publicUrl,
        caminho: uploadData.path,
        nome_arquivo: file_name,
        tipo: tipoAnexo,
        tamanho: tamanhoRealBytes,
        content_type: file_type
      }
    });

  } catch (error) {
    // Verificar se Ã© erro de tamanho
    if (error.message && error.message.includes('too large')) {
      return res.status(413).json({
        success: false,
        error: 'LIMITE_EXCEDIDO',
        message: 'Arquivo muito grande para o servidor'
      });
    }

    res.status(500).json({
      success: false,
      error: 'ERRO_UPLOAD',
      message: 'Erro ao fazer upload do arquivo',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

/**
 * ROTA: Excluir mensagem (soft delete)
 * DELETE /api/chat-conversa/propaganda/:mensagemId
 */
router.delete('/propaganda/mensagem/:mensagemId', verifyToken, async (req, res) => {
  try {
    const { mensagemId } = req.params;
    const usuarioId = req.user.id;

    // Buscar a mensagem para verificar permissÃ£o
    const { data: mensagem, error: fetchError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .select('*')
      .eq('id', mensagemId)
      .single();

    if (fetchError) {
      return res.status(404).json({
        success: false,
        error: 'MENSAGEM_NAO_ENCONTRADA',
        message: 'Mensagem nÃ£o encontrada',
        details: process.env.NODE_ENV === 'development' ? fetchError.message : null
      });
    }

    if (!mensagem) {
      return res.status(404).json({
        success: false,
        error: 'MENSAGEM_NAO_ENCONTRADA',
        message: 'Mensagem nÃ£o encontrada'
      });
    }

    // Verificar se o usuÃ¡rio tem permissÃ£o (remetente ou destinatÃ¡rio)
    const isRemetente = mensagem.remetente_id === usuarioId;
    const isDestinatario = mensagem.destinatario_id === usuarioId;

    if (!isRemetente && !isDestinatario) {
      return res.status(403).json({
        success: false,
        error: 'PERMISSAO_NEGADA',
        message: 'VocÃª nÃ£o tem permissÃ£o para excluir esta mensagem'
      });
    }

    // Marcar como deletada para o usuÃ¡rio
    let updateData = {};
    if (isRemetente) {
      updateData.remetente_deletado = true;
    } else {
      updateData.destinatario_deletado = true;
    }

    const { error: updateError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .update(updateData)
      .eq('id', mensagemId);

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Mensagem excluÃ­da com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao excluir mensagem',
      details: process.env.NODE_ENV === 'development' ? error?.message : null
    });
  }
});

module.exports = router;
