const express = require('express');
// CORRIGIR: supabase, { supabaseAdmin } from '../supabaseClient.js';
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// âœ… VALIDAÃ‡Ã•ES
const isValidUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const isValidNumber = (num) => !isNaN(Number(num)) && Number(num) > 0;

// âœ… SISTEMA DE RESPOSTAS PADRONIZADO
const ResponseHandler = {
  success: (res, data = {}, message = 'Sucesso') => {
    res.json({ success: true, message, ...data });
  },

  error: (res, errorCode, message, details = null) => {
    const statusCodes = {
      'VALIDATION_ERROR': 400,
      'UNAUTHORIZED': 401,
      'FORBIDDEN': 403,
      'NOT_FOUND': 404,
      'SERVER_ERROR': 500,
      'TIMEOUT': 408
    };

    res.status(statusCodes[errorCode] || 500).json({
      success: false,
      error: errorCode,
      message,
      details,
      timestamp: new Date().toISOString()
    });
  },

  validationError: (res, message, details) =>
    ResponseHandler.error(res, 'VALIDATION_ERROR', message, details),

  serverError: (res, message, error = null) => {
    ResponseHandler.error(res, 'SERVER_ERROR', message);
  }
};

// âœ… CACHE DE CLIENTE ADMIN
let supabaseAdminInstance = null;
async function getSupabaseAdmin() {
  if (supabaseAdminInstance) return supabaseAdminInstance;

  const { createClient } = await import('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('ConfiguraÃ§Ã£o do Supabase incompleta');
  }

  supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  return supabaseAdminInstance;
}

// âœ… FUNÃ‡Ã•ES AUXILIARES
function _getDefaultPrestador(prestadorId) {
  return {
    id: prestadorId,
    nome: 'Prestador',
    bairro: 'Bairro nÃ£o informado',
    imagem_url: null,
    telefone: null
  };
}

function _getDefaultUser(userId) {
  return {
    id: userId,
    nome: 'UsuÃ¡rio',
    imagem_url: null
  };
}

function _getResult(result, defaultValue) {
  return result.status === 'fulfilled' ? result.value : defaultValue;
}

// âœ… FUNÃ‡Ã•ES DE BANCO DE DADOS ESPECÃFICAS PARA SERVIÃ‡OS
async function _getPrestadorInfo(prestadorId) {
  if (!isValidUUID(prestadorId)) return _getDefaultPrestador(prestadorId);

  const { data: prestador, error } = await supabaseAdmin
    .from('usuarios')
    .select('id, nome, bairro, imagem_url, telefone')
    .eq('id', prestadorId)
    .single();

  if (error || !prestador) {
    return _getDefaultPrestador(prestadorId);
  }

  return prestador;
}

async function _checkFavoriteStatus(servicoId, usuarioId) {
  if (!isValidNumber(servicoId)) return false;

  const { count, error } = await supabase
    .from('favoritos_servicos')
    .select('*', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .eq('servico_id', servicoId);

  if (error) return false;
  return count > 0;
}

async function _checkLikeStatus(servicoId, usuarioId) {
  if (!servicoId) return false;

  const servicoIdNum = parseInt(servicoId);
  if (!isValidNumber(servicoId)) return false;

  const { data: curtidas, error } = await supabase
    .from('curtidas')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('servico_id', servicoIdNum)
    .eq('tipo_conteudo', 'servico');

  if (error) return false;
  return curtidas && curtidas.length > 0;
}

async function _getLikesCount(servicoId) {
  if (!servicoId) return 0;

  const servicoIdNum = parseInt(servicoId);
  if (!isValidNumber(servicoIdNum)) return 0;

  const { count, error } = await supabase
    .from('curtidas')
    .select('*', { count: 'exact', head: true })
    .eq('servico_id', servicoIdNum)
    .eq('tipo_conteudo', 'servico');

  if (error) return 0;
  return count || 0;
}

async function _getAnuncios(categoria, usuarioId) {
  try {
    let query = supabase
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, categoria, condicao, descricao, nivel, usuario_id, cidade')
      .neq('usuario_id', usuarioId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .eq('nivel', 'basic')
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false });

    if (categoria) query = query.eq('categoria', categoria);

    const { data: anuncios, error } = await query;

    if (error) return [];

    // Adicionar informaÃ§Ãµes do prestador
    const anunciosComPrestador = await Promise.all(
      (anuncios || []).map(async (anuncio) => {
        const prestador = await _getPrestadorInfo(anuncio.usuario_id);
        return {
          ...anuncio,
          prestador: prestador
        };
      })
    );

    return anunciosComPrestador;

  } catch (error) {
    return [];
  }
}

async function _getComentariosServico(servicoId) {
  const servicoIdNum = parseInt(servicoId);
  if (!isValidNumber(servicoId)) return [];

  try {
    const { data: comentarios, error } = await supabase
      .from('comentarios')
      .select('id, comentario, status, created_at, usuario_id')
      .eq('servico_id', servicoIdNum)
      .eq('tipo_conteudo', 'servico')
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (error) return [];

    if (!comentarios || comentarios.length === 0) {
      return [];
    }

    const usuarioIds = [...new Set(comentarios.map(c => c.usuario_id))];
    const { data: usuarios } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url')
      .in('id', usuarioIds);

    const usuariosMap = new Map();
    if (usuarios) {
      usuarios.forEach(u => usuariosMap.set(u.id, u));
    }

    return comentarios.map(comentario => ({
      ...comentario,
      usuario: usuariosMap.get(comentario.usuario_id) || _getDefaultUser(comentario.usuario_id)
    }));

  } catch (error) {
    return [];
  }
}

async function _getServicosRecomendados(categoria, cidade, usuarioId, servicoAtualId) {
  try {
    let query = supabase
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, categoria, condicao, descricao, usuario_id, cidade, nivel')
      .neq('usuario_id', usuarioId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .eq('nivel', 'standard')
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false })
      .limit(4);

    if (cidade) query = query.ilike('cidade', `%${cidade}%`);

    const { data: servicos, error } = await query;
    if (error) throw error;

    const servicosComPrestador = await Promise.all(
      (servicos || []).map(async (servico) => {
        const prestador = await _getPrestadorInfo(servico.usuario_id);
        return {
          ...servico,
          prestador: prestador
        };
      })
    );

    return servicosComPrestador;

  } catch (error) {
    return [];
  }
}

// âœ… ENDPOINT DE DADOS INICIAIS PARA SERVIÃ‡OS
router.get('/initial-data', verifyToken, async (req, res) => {
  try {
    const { servico_id, categoria, cidade } = req.query;
    const usuario_id = req.user.id;

    if (!servico_id) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o Ã© obrigatÃ³rio');
    }

    if (!isValidNumber(servico_id)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    // Buscar informaÃ§Ãµes bÃ¡sicas do serviÃ§o
    const { data: servico, error: servicoError } = await supabase
      .from('servicos')
      .select('*')
      .eq('id', parseInt(servico_id))
      .single();

    if (servicoError || !servico) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'ServiÃ§o nÃ£o encontrado');
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 10000)
    );

    const dataPromise = Promise.allSettled([
      _getPrestadorInfo(servico.usuario_id),
      _checkFavoriteStatus(servico_id, usuario_id),
      _checkLikeStatus(servico_id, usuario_id),
      _getLikesCount(servico_id),
      _getAnuncios(categoria, usuario_id),
      _getComentariosServico(servico_id),
      _getServicosRecomendados(categoria, cidade, usuario_id, servico_id)
    ]);

    const results = await Promise.race([dataPromise, timeoutPromise]);

    const responseData = {
      servico: servico,
      prestador: _getResult(results[0], _getDefaultPrestador(servico.usuario_id)),
      isFavorito: _getResult(results[1], false),
      isLiked: _getResult(results[2], false),
      curtidasCount: _getResult(results[3], 0),
      anuncios: _getResult(results[4], []),
      comentarios: _getResult(results[5], []),
      servicosRecomendados: _getResult(results[6], [])
    };

    ResponseHandler.success(res, responseData, 'Dados do serviÃ§o carregados com sucesso');

  } catch (error) {
    if (error.message === 'TIMEOUT') {
      ResponseHandler.error(res, 'TIMEOUT', 'Tempo de carregamento esgotado');
    } else {
      ResponseHandler.serverError(res, 'Erro ao carregar dados do serviÃ§o');
    }
  }
});

// âœ… REGISTRAR VISUALIZAÃ‡ÃƒO DE SERVIÃ‡O
router.post('/visualizacoes/registrar', verifyToken, async (req, res) => {
  let adminClient = null;

  try {
    const { servico_id, categoria } = req.body;
    const visualizador_id = req.user.id;

    if (!servico_id) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o Ã© obrigatÃ³rio');
    }

    if (!isValidNumber(servico_id)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    // Buscar informaÃ§Ãµes do serviÃ§o para obter vendedor_id
    const { data: servico, error: servicoError } = await supabase
      .from('servicos')
      .select('usuario_id')
      .eq('id', parseInt(servico_id))
      .single();

    if (servicoError || !servico) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'ServiÃ§o nÃ£o encontrado');
    }

    const vendedor_id = servico.usuario_id;

    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    adminClient = await getSupabaseAdmin();

    // Verificar pelo servico_id E tipo_conteudo = 'servico'
    const { data: visualizacaoExistente } = await adminClient
      .from('visualizacoes_produtos')
      .select('id')
      .eq('visualizador_id', visualizador_id)
      .eq('servico_id', parseInt(servico_id))
      .eq('tipo_conteudo', 'servico')
      .gte('created_at', umaHoraAtras)
      .maybeSingle();

    if (visualizacaoExistente) {
      return ResponseHandler.success(res, { action: 'already_exists' }, 'VisualizaÃ§Ã£o jÃ¡ registrada');
    }

    // Estrutura correta com servico_id E tipo_conteudo
    const visualizacaoData = {
      servico_id: parseInt(servico_id),
      tipo_conteudo: 'servico',
      vendedor_id: vendedor_id,
      visualizador_id: visualizador_id,
      categoria: categoria || 'geral',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: novaVisualizacao, error: insertError } = await adminClient
      .from('visualizacoes_produtos')
      .insert([visualizacaoData])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        visualizacaoData.created_at = new Date(Date.now() + 1).toISOString();
        visualizacaoData.updated_at = new Date(Date.now() + 1).toISOString();

        const { data: retryData, error: retryError } = await adminClient
          .from('visualizacoes_produtos')
          .insert([visualizacaoData])
          .select()
          .single();

        if (retryError) {
          throw retryError;
        }

        return ResponseHandler.success(res,
          { data: retryData, action: 'created' },
          'VisualizaÃ§Ã£o registrada com sucesso'
        );
      }

      throw insertError;
    }

    return ResponseHandler.success(res,
      { data: novaVisualizacao, action: 'created' },
      'VisualizaÃ§Ã£o registrada com sucesso'
    );

  } catch (error) {
    if (error.code === '42501') {
      return ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel registrar visualizaÃ§Ã£o devido Ã s polÃ­ticas de seguranÃ§a');
    } else if (error.code === '23505') {
      return ResponseHandler.validationError(res, 'Duplicata detectada. Contate o administrador.');
    } else if (error.code === '23503') {
      return ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else {
      return ResponseHandler.serverError(res, 'Erro ao registrar visualizaÃ§Ã£o');
    }
  }
});

// âœ… ENVIAR MENSAGEM PARA SERVIÃ‡O
router.post('/mensagens', verifyToken, async (req, res) => {
  try {
    const { servico_id, destinatario_id, mensagem } = req.body;
    const remetente_id = req.user.id;

    if (!servico_id || !isValidNumber(servico_id)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o Ã© obrigatÃ³rio e deve ser vÃ¡lido');
    }

    if (!destinatario_id || !isValidUUID(destinatario_id)) {
      return ResponseHandler.validationError(res, 'ID do destinatÃ¡rio invÃ¡lido');
    }

    if (!mensagem?.trim() || mensagem.trim().length < 2) {
      return ResponseHandler.validationError(res, 'Mensagem deve ter pelo menos 2 caracteres');
    }

    if (mensagem.trim().length > 1000) {
      return ResponseHandler.validationError(res, 'Mensagem muito longa (mÃ¡ximo 1000 caracteres)');
    }

    if (remetente_id === destinatario_id) {
      return ResponseHandler.validationError(res, 'VocÃª nÃ£o pode enviar mensagem para si mesmo');
    }

    const { data: destinatario } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .eq('id', destinatario_id)
      .single();

    if (!destinatario) {
      return ResponseHandler.validationError(res, 'DestinatÃ¡rio nÃ£o encontrado');
    }

    // âœ… BUSCAR INFORMAÃ‡Ã•ES DO SERVIÃ‡O
    const { data: servico } = await supabaseAdmin
      .from('servicos')
      .select('id, usuario_id')
      .eq('id', parseInt(servico_id))
      .single();

    if (!servico) {
      return ResponseHandler.validationError(res, 'ServiÃ§o nÃ£o encontrado');
    }

    const mensagemData = {
      remetente_id,
      destinatario_id,
      servico_id: parseInt(servico_id),
      mensagem: mensagem.trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: false
    };

    const adminClient = await getSupabaseAdmin();
    const { data: novaMensagem, error: insertError } = await adminClient
      .from('mensagens')
      .insert([mensagemData])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23503') {
        return ResponseHandler.validationError(res, 'Erro de referÃªncia - verifique IDs do serviÃ§o e destinatÃ¡rio');
      }
      throw insertError;
    }

    res.status(201).json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      mensagem_id: novaMensagem.id,
      data_hora: novaMensagem.data_hora,
      servico_id: parseInt(servico_id)
    });

  } catch (error) {
    if (error.code === '42501') {
      ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel enviar mensagem devido Ã s polÃ­ticas de seguranÃ§a');
    } else if (error.code === '23503') {
      ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else {
      ResponseHandler.serverError(res, 'Erro ao enviar mensagem');
    }
  }
});

// âœ… GET COMENTÃRIOS DE SERVIÃ‡O
router.get('/comentarios/:servicoId', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.params;

    if (!servicoId) {
      return res.status(400).json({
        success: false,
        error: 'DADOS_INCOMPLETOS',
        message: 'ID do serviÃ§o Ã© obrigatÃ³rio'
      });
    }

    const servicoIdNum = parseInt(servicoId);
    if (isNaN(servicoIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_SERVICO_INVALIDO',
        message: 'ID do serviÃ§o invÃ¡lido'
      });
    }

    // âœ… CORRIGIDO: Buscar comentÃ¡rios usando servico_id e tipo_conteudo = 'servico'
    const { data: comentarios, error } = await supabase
      .from('comentarios')
      .select('id, comentario, status, created_at, usuario_id')
      .eq('servico_id', servicoIdNum)
      .eq('tipo_conteudo', 'servico')
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (comentarios && comentarios.length > 0) {
      const usuarioIds = [...new Set(comentarios.map(c => c.usuario_id))];

      const { data: usuarios } = await supabaseAdmin
        .from('usuarios')
        .select('id, nome, imagem_url')
        .in('id', usuarioIds);

      const usuariosMap = new Map();
      if (usuarios) {
        usuarios.forEach(u => usuariosMap.set(u.id, u));
      }

      const comentariosComUsuario = comentarios.map(comentario => ({
        ...comentario,
        usuario: usuariosMap.get(comentario.usuario_id) || _getDefaultUser(comentario.usuario_id)
      }));

      return res.json({
        success: true,
        comentarios: comentariosComUsuario
      });
    }

    res.json({
      success: true,
      comentarios: []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_CARREGAR_COMENTARIOS',
      message: 'Erro ao carregar comentÃ¡rios'
    });
  }
});

// âœ… SISTEMA DE COMENTÃRIOS PARA SERVIÃ‡OS
router.post('/comentarios', verifyToken, async (req, res) => {
  try {
    const { servico_id, comentario } = req.body;
    const usuario_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!servico_id || !comentario?.trim()) {
      return ResponseHandler.validationError(res, 'Dados incompletos para comentÃ¡rio');
    }

    if (!isValidNumber(servico_id)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    if (comentario.trim().length < 2) {
      return ResponseHandler.validationError(res, 'ComentÃ¡rio deve ter pelo menos 2 caracteres');
    }

    if (comentario.trim().length > 500) {
      return ResponseHandler.validationError(res, 'ComentÃ¡rio muito longo (mÃ¡ximo 500 caracteres)');
    }

    // âœ… CORRIGIDO: Estrutura correta para serviÃ§os
    const comentarioData = {
      usuario_id,
      tipo_conteudo: 'servico',
      servico_id: Number(servico_id),
      comentario: comentario.trim(),
      status: 'ativo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // âœ… USAR ADMIN CLIENT DESDE O INÃCIO
    const adminClient = await getSupabaseAdmin();
    const { data: novoComentario, error } = await adminClient
      .from('comentarios')
      .insert([comentarioData])
      .select('id, comentario, status, created_at, usuario_id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return ResponseHandler.success(res, { action: 'duplicate_ignored' }, 'ComentÃ¡rio jÃ¡ existe');
      }
      throw error;
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url')
      .eq('id', usuario_id)
      .single();

    const comentarioCompleto = {
      ...novoComentario,
      usuario: usuario || _getDefaultUser(usuario_id)
    };

    ResponseHandler.success(res, {
      comentario: comentarioCompleto
    }, 'ComentÃ¡rio adicionado com sucesso');

  } catch (error) {
    if (error.code === '42501') {
      ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel adicionar comentÃ¡rio devido Ã s polÃ­ticas de seguranÃ§a');
    } else if (error.code === '23503') {
      ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else if (error.code === '23505') {
      ResponseHandler.success(res, { action: 'duplicate_ignored' }, 'ComentÃ¡rio jÃ¡ registrado');
    } else {
      ResponseHandler.serverError(res, 'Erro ao adicionar comentÃ¡rio');
    }
  }
});

// âœ… FAVORITOS PARA SERVIÃ‡OS
router.get('/favoritos/listar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: favoritos, error } = await supabase
      .from('favoritos_servicos')
      .select('servico_id')
      .eq('usuario_id', userId);

    if (error) throw error;

    ResponseHandler.success(res, {
      favoritos: favoritos || []
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao listar favoritos', error);
  }
});

router.get('/favoritos/verificar/:servicoId', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.params;
    const userId = req.user.id;

    if (!servicoId || !isValidNumber(servicoId)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    const { count, error } = await supabase
      .from('favoritos_servicos')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', userId)
      .eq('servico_id', parseInt(servicoId));

    if (error) throw error;

    ResponseHandler.success(res, { isFavorito: count > 0 });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao verificar favorito', error);
  }
});

router.post('/favoritos', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.body;
    const userId = req.user.id;

    if (!servicoId || !isValidNumber(servicoId)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    const servicoIdNum = parseInt(servicoId);

    const { data: favoritoExistente } = await supabase
      .from('favoritos_servicos')
      .select('id')
      .eq('usuario_id', userId)
      .eq('servico_id', servicoIdNum)
      .maybeSingle();

    let operationResult;
    let action = '';

    if (favoritoExistente) {
      const { error: deleteError } = await supabase
        .from('favoritos_servicos')
        .delete()
        .eq('id', favoritoExistente.id);

      if (deleteError) throw deleteError;
      operationResult = false;
      action = 'removed';
    } else {
      const { error: insertError } = await supabase
        .from('favoritos_servicos')
        .insert([{
          usuario_id: userId,
          servico_id: servicoIdNum,
          created_at: new Date().toISOString()
        }]);

      if (insertError) throw insertError;
      operationResult = true;
      action = 'added';
    }

    ResponseHandler.success(res, {
      isFavorito: operationResult,
      action: action
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao atualizar favorito', error);
  }
});

// âœ… CURTIDAS PARA SERVIÃ‡OS
router.post('/curtir', verifyToken, async (req, res) => {
  try {
    const { servico_id } = req.body;
    const usuario_id = req.user.id;

    if (!servico_id) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o Ã© obrigatÃ³rio');
    }

    if (!isValidNumber(servico_id)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    const servicoIdNum = parseInt(servico_id);

    const { data: servico, error: servicoError } = await supabase
      .from('servicos')
      .select('id, usuario_id')
      .eq('id', servicoIdNum)
      .single();

    if (servicoError || !servico) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'ServiÃ§o nÃ£o encontrado');
    }

    const { data: curtidas } = await supabase
      .from('curtidas')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq('servico_id', servicoIdNum)
      .eq('tipo_conteudo', 'servico');

    const jaCurtido = curtidas && curtidas.length > 0;
    const curtidaExistente = jaCurtido ? curtidas[0] : null;

    const adminClient = await getSupabaseAdmin();
    let operationResult;
    let action = '';

    if (jaCurtido && curtidaExistente) {
      const { error: deleteError } = await adminClient
        .from('curtidas')
        .delete()
        .eq('id', curtidaExistente.id);

      if (deleteError) throw deleteError;
      operationResult = false;
      action = 'unliked';
    } else {
      const curtidaData = {
        usuario_id,
        servico_id: servicoIdNum,
        tipo_conteudo: 'servico',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error: insertError } = await adminClient
        .from('curtidas')
        .insert([curtidaData]);

      if (insertError) throw insertError;
      operationResult = true;
      action = 'liked';
    }

    const curtidasCount = await _getLikesCount(servicoIdNum);

    ResponseHandler.success(res, {
      isLiked: operationResult,
      action: action,
      curtidasCount: curtidasCount,
      servico_id: servicoIdNum
    });

  } catch (error) {
    if (error.code === '42501') {
      ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel processar a curtida devido Ã s polÃ­ticas de seguranÃ§a');
    } else if (error.code === '23503') {
      ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else {
      ResponseHandler.serverError(res, 'Erro ao processar curtida', error);
    }
  }
});

router.get('/curtidas/verificar/:servicoId', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.params;
    const usuario_id = req.user.id;

    if (!servicoId) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o Ã© obrigatÃ³rio');
    }

    if (!isValidNumber(servicoId)) {
      return ResponseHandler.validationError(res, 'ID do serviÃ§o invÃ¡lido');
    }

    const servicoIdNum = parseInt(servicoId);

    const { data: curtidas, error } = await supabase
      .from('curtidas')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq('servico_id', servicoIdNum)
      .eq('tipo_conteudo', 'servico');

    if (error) throw error;

    ResponseHandler.success(res, {
      isLiked: curtidas && curtidas.length > 0
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao verificar curtida', error);
  }
});

// âœ… ENDPOINTS ADICIONAIS PARA SERVIÃ‡OS
router.get('/prestador/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !isValidUUID(id)) {
      return ResponseHandler.validationError(res, 'ID do prestador invÃ¡lido');
    }

    const { data: prestador, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, bairro, imagem_url, telefone')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return ResponseHandler.success(res, { prestador: _getDefaultPrestador(id) });
      }
      throw error;
    }

    ResponseHandler.success(res, { prestador: prestador || _getDefaultPrestador(id) });

  } catch (error) {
    ResponseHandler.success(res, { prestador: _getDefaultPrestador(req.params.id) });
  }
});

router.get('/anuncios', verifyToken, async (req, res) => {
  try {
    const { categoria } = req.query;
    const userId = req.user.id;

    const anuncios = await _getAnuncios(categoria, userId);

    ResponseHandler.success(res, {
      anuncios: anuncios
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar anÃºncios', error);
  }
});

// âœ… ENDPOINT PARA BUSCAR SERVIÃ‡OS POR CIDADE E CATEGORIA
router.get('/:cidade', async (req, res) => {
  try {
    const { cidade } = req.params;
    const { categoria } = req.query;

    if (!cidade) {
      return ResponseHandler.validationError(res, 'Cidade Ã© obrigatÃ³ria');
    }

    let query = supabase
      .from('servicos')
      .select('*')
      .ilike('cidade', `%${cidade}%`)
      .eq('status', 'Ativo')
      .limit(20);

    if (categoria) query = query.eq('categoria', categoria);

    query = query.order('created_at', { ascending: false });

    const { data: servicos, error } = await query;

    if (error) throw error;

    ResponseHandler.success(res, {
      servicos: servicos || [],
      total: servicos?.length || 0
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao buscar serviÃ§os', error);
  }
});

module.exports = router;

