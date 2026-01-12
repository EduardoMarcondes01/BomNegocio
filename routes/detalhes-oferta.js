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

  validationError: (res, message, details) => {
    ResponseHandler.error(res, 'VALIDATION_ERROR', message, details);
  },

  serverError: (res, message, error = null) => {
    ResponseHandler.error(res, 'SERVER_ERROR', message);
  }
};

// âœ… CACHE DE CLIENTE ADMIN
let supabaseAdminInstance = null;
async function getSupabaseAdmin() {
  if (supabaseAdminInstance) {
    return supabaseAdminInstance;
  }

  try {
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
  } catch (error) {
    throw error;
  }
}

// âœ… FUNÃ‡Ã•ES AUXILIARES
function _getDefaultUser(userId) {
  return {
    id: userId,
    nome: 'UsuÃ¡rio',
    imagem_url: null,
    telefone: null
  };
}

function _getResult(result, defaultValue) {
  if (result.status === 'fulfilled') {
    return result.value;
  } else {
    return defaultValue;
  }
}

// âœ… BUSCA DE USUÃRIOS EM BATCH
async function _getUsersBatch(userIds, fields = 'id, nome, imagem_url, telefone, bairro, cidade') {
  if (!userIds || userIds.length === 0) {
    return new Map();
  }

  try {
    const { data: usuarios, error } = await supabaseAdmin
      .from('usuarios')
      .select(fields)
      .in('id', userIds);

    if (error) {
      return new Map();
    }

    const usuariosMap = new Map();
    (usuarios || []).forEach(u => {
      usuariosMap.set(u.id, u);
    });

    return usuariosMap;
  } catch (error) {
    return new Map();
  }
}

// âœ… FUNÃ‡ÃƒO DE FALLBACK MELHORADA PARA VENDEDOR
function _getDefaultSeller(vendedorId, usuarioRequisicaoId) {
  if (vendedorId === usuarioRequisicaoId) {
    return {
      id: vendedorId,
      nome: 'VocÃª',
      bairro: 'Seu bairro',
      cidade: 'Sua cidade',
      imagem_url: null,
      telefone: null,
      isOwnProfile: true
    };
  }
  
  return {
    id: vendedorId || 'unknown',
    nome: 'Vendedor',
    bairro: 'Bairro nÃ£o informado',
    cidade: 'Cidade nÃ£o informada',
    imagem_url: null,
    telefone: null,
    isOwnProfile: false
  };
}

// âœ… BUSCA DE VENDEDOR MELHORADA
async function _getSellerInfo(vendedorId, usuarioRequisicaoId) {
  if (!vendedorId || !isValidUUID(vendedorId)) {
    return _getDefaultSeller(vendedorId, usuarioRequisicaoId);
  }
  
  try {
    const { data: vendedor, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, bairro, cidade, imagem_url, telefone')
      .eq('id', vendedorId)
      .single();
    
    if (error || !vendedor) {
      return _getDefaultSeller(vendedorId, usuarioRequisicaoId);
    }
    
    return vendedor;
  } catch (error) {
    return _getDefaultSeller(vendedorId, usuarioRequisicaoId);
  }
}

// âœ… VERIFICAÃ‡ÃƒO DE LIKE
async function _checkLikeStatus(itemId, tipoConteudo, usuarioId) {
  if (!itemId || !tipoConteudo) {
    return false;
  }

  const itemIdNum = parseInt(itemId);
  if (!isValidNumber(itemId)) {
    return false;
  }

  const columnMap = {
    'oferta': 'oferta_id',
    'servico': 'servico_id',
    'novidade': 'novidade_id'
  };

  const columnName = columnMap[tipoConteudo];
  if (!columnName) {
    return false;
  }

  try {
    const { data: curtidas, error } = await supabase
      .from('curtidas')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq(columnName, itemIdNum)
      .eq('tipo_conteudo', tipoConteudo);

    if (error) {
      return false;
    }
    
    return curtidas && curtidas.length > 0;
  } catch (error) {
    return false;
  }
}

// âœ… CONTAGEM DE LIKES
async function _getLikesCount(itemId, tipoConteudo) {
  if (!itemId || !tipoConteudo) {
    return 0;
  }

  const itemIdNum = parseInt(itemId);
  if (!isValidNumber(itemId)) {
    return 0;
  }

  const columnMap = {
    'oferta': 'oferta_id',
    'servico': 'servico_id',
    'novidade': 'novidade_id'
  };

  const columnName = columnMap[tipoConteudo];
  if (!columnName) {
    return 0;
  }

  try {
    const { count, error } = await supabase
      .from('curtidas')
      .select('*', { count: 'exact', head: true })
      .eq(columnName, itemIdNum)
      .eq('tipo_conteudo', tipoConteudo);

    if (error) {
      return 0;
    }
    
    return count || 0;
  } catch (error) {
    return 0;
  }
}

// âœ… FUNÃ‡ÃƒO PARA MISTURAR ARRAY ALEATORIAMENTE
function _shuffleArray(array) {
  if (!array || !Array.isArray(array)) {
    return [];
  }

  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// âœ… BUSCA DE ANÃšNCIOS COM MISTURA DE RECENTES E ALEATÃ“RIOS
async function _getAnuncios(categoria, usuarioId, cidade = null) {
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

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    if (cidade) {
      query = query.eq('cidade', cidade);
    }

    query = query.limit(8);

    const { data: ofertas, error } = await query;

    if (error) {
      return [];
    }

    if (!ofertas || ofertas.length === 0) {
      return [];
    }

    const maisRecentes = ofertas.slice(0, 2);
    const restantes = ofertas.slice(2);
    const aleatorios = _shuffleArray(restantes).slice(0, 2);
    const anunciosSelecionados = [...maisRecentes, ...aleatorios];
    const anunciosFinal = anunciosSelecionados.slice(0, 4);

    if (anunciosFinal.length > 0) {
      const vendedorIds = anunciosFinal.map(a => a.usuario_id).filter(id => id);
      const vendedoresMap = await _getUsersBatch(vendedorIds, 'id, nome, bairro, cidade, imagem_url, telefone');

      const anunciosComVendedor = anunciosFinal.map(anuncio => ({
        ...anuncio,
        vendedor: vendedoresMap.get(anuncio.usuario_id) || {
          id: anuncio.usuario_id,
          nome: 'Vendedor',
          bairro: 'Bairro nÃ£o informado',
          cidade: 'Cidade nÃ£o informada',
          imagem_url: null,
          telefone: null
        }
      }));

      return anunciosComVendedor;
    }

    return [];
  } catch (error) {
    return [];
  }
}

// âœ… BUSCA DE COMENTÃRIOS
async function _getComentarios(itemId, tipoConteudo) {
  const itemIdNum = parseInt(itemId);
  if (!isValidNumber(itemId)) {
    return [];
  }

  try {
    const { data: comentarios, error } = await supabase
      .from('comentarios')
      .select('id, comentario, status, created_at, usuario_id')
      .eq(`${tipoConteudo}_id`, itemIdNum)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (error || !comentarios) {
      return [];
    }

    const usuarioIds = [...new Set(comentarios.map(c => c.usuario_id))];
    const usuariosMap = await _getUsersBatch(usuarioIds, 'id, nome, imagem_url, telefone');

    const comentariosComUsuario = comentarios.map(comentario => ({
      ...comentario,
      usuario: usuariosMap.get(comentario.usuario_id) || _getDefaultUser(comentario.usuario_id)
    }));

    return comentariosComUsuario;
  } catch (error) {
    return [];
  }
}

// âœ… BUSCA DE OFERTAS RECOMENDADAS
async function _getRecommendedOfertas(categoria, usuarioId, cidade = null) {
  try {
    let query = supabase
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, categoria, condicao, descricao, usuario_id, cidade, nivel')
      .neq('usuario_id', usuarioId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .eq('nivel', 'standard')
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false });

    if (cidade) {
      query = query.eq('cidade', cidade);
    }

    query = query.limit(8);

    const { data: ofertas, error } = await query;

    if (error) {
      throw error;
    }

    if (!ofertas || ofertas.length === 0) {
      return [];
    }

    const maisRecentes = ofertas.slice(0, 2);
    const restantes = ofertas.slice(2);
    const aleatorios = _shuffleArray(restantes).slice(0, 2);
    const ofertasSelecionadas = [...maisRecentes, ...aleatorios];
    const ofertasFinal = ofertasSelecionadas.slice(0, 4);

    const vendedorIds = ofertasFinal.map(p => p.usuario_id).filter(id => id);
    const vendedoresMap = await _getUsersBatch(vendedorIds, 'id, nome, bairro, cidade, imagem_url, telefone');

    const ofertasComVendedor = ofertasFinal.map(oferta => ({
      ...oferta,
      vendedor: vendedoresMap.get(oferta.usuario_id) || {
        id: oferta.usuario_id,
        nome: 'Vendedor',
        bairro: 'Bairro nÃ£o informado',
        cidade: 'Cidade nÃ£o informada',
        imagem_url: null,
        telefone: null
      }
    }));

    return ofertasComVendedor;
  } catch (error) {
    return [];
  }
}

// âœ… ENDPOINT DE DADOS INICIAIS
router.get('/initial-data', verifyToken, async (req, res) => {
  try {
    const { oferta_id, tipo_conteudo, categoria, vendedor_id, cidade } = req.query;
    const usuarioRequisicaoId = req.user.id;

    if (!oferta_id || !tipo_conteudo || !vendedor_id) {
      return ResponseHandler.validationError(res,
        'Dados obrigatÃ³rios nÃ£o fornecidos: oferta_id, tipo_conteudo, vendedor_id'
      );
    }

    if (!isValidUUID(vendedor_id) || !isValidNumber(oferta_id)) {
      return ResponseHandler.validationError(res, 'IDs invÃ¡lidos');
    }

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 10000)
    );

    const dataPromise = Promise.allSettled([
      _getSellerInfo(vendedor_id, usuarioRequisicaoId),
      _checkLikeStatus(oferta_id, tipo_conteudo, usuarioRequisicaoId),
      _getLikesCount(oferta_id, tipo_conteudo),
      _getAnuncios(categoria, usuarioRequisicaoId, cidade),
      _getComentarios(oferta_id, tipo_conteudo),
      _getRecommendedOfertas(categoria, usuarioRequisicaoId, cidade)
    ]);

    const results = await Promise.race([dataPromise, timeoutPromise]);

    const responseData = {
      vendedor: _getResult(results[0], _getDefaultSeller(vendedor_id, usuarioRequisicaoId)),
      isLiked: _getResult(results[1], false),
      curtidasCount: _getResult(results[2], 0),
      anuncios: _getResult(results[3], []),
      comentarios: _getResult(results[4], []),
      ofertasRecomendadas: _getResult(results[5], [])
    };

    ResponseHandler.success(res, responseData, 'Dados carregados com sucesso');
  } catch (error) {
    if (error.message === 'TIMEOUT') {
      ResponseHandler.error(res, 'TIMEOUT', 'Tempo de carregamento esgotado');
    } else {
      ResponseHandler.serverError(res, 'Erro ao carregar dados iniciais', error);
    }
  }
});

// âœ… REGISTRAR VISUALIZAÃ‡ÃƒO
router.post('/visualizacoes/registrar', verifyToken, async (req, res) => {
  let adminClient = null;

  try {
    const { item_id, tipo_conteudo, vendedor_id, categoria } = req.body;
    const visualizador_id = req.user.id;

    if (!item_id) {
      return ResponseHandler.validationError(res, 'ID do item Ã© obrigatÃ³rio');
    }

    if (!tipo_conteudo || !['oferta', 'novidade', 'servico', 'propaganda'].includes(tipo_conteudo)) {
      return ResponseHandler.validationError(res, 'Tipo de conteÃºdo invÃ¡lido');
    }

    if (!vendedor_id || !isValidUUID(vendedor_id)) {
      return ResponseHandler.validationError(res, 'ID do vendedor invÃ¡lido');
    }

    adminClient = await getSupabaseAdmin();

    const visualizacaoData = {
      oferta_id: Number(item_id),
      tipo_conteudo,
      vendedor_id,
      visualizador_id,
      categoria: categoria || 'geral',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: novaVisualizacao, error: insertError } = await adminClient
      .from('visualizacoes')
      .insert([visualizacaoData])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        visualizacaoData.created_at = new Date(Date.now() + 1).toISOString();
        visualizacaoData.updated_at = new Date(Date.now() + 1).toISOString();

        const { data: retryData, error: retryError } = await adminClient
          .from('visualizacoes')
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
      return ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel registrar visualizaÃ§Ã£o');
    } else if (error.code === '23505') {
      return ResponseHandler.validationError(res, 'Duplicata detectada. Contate o administrador.');
    } else if (error.code === '23503') {
      return ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else {
      return ResponseHandler.serverError(res, 'Erro ao registrar visualizaÃ§Ã£o', error);
    }
  }
});

// âœ… ENVIAR MENSAGEM
router.post('/mensagens', verifyToken, async (req, res) => {
  try {
    const { oferta_id, destinatario_id, mensagem } = req.body;
    const remetente_id = req.user.id;

    if (!oferta_id || !isValidNumber(oferta_id)) {
      return ResponseHandler.validationError(res, 'ID da oferta Ã© obrigatÃ³rio e deve ser vÃ¡lido');
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

    const { data: destinatario, error: errorDestinatario } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, telefone')
      .eq('id', destinatario_id)
      .single();

    if (errorDestinatario || !destinatario) {
      return ResponseHandler.validationError(res, 'DestinatÃ¡rio nÃ£o encontrado');
    }

    const { data: oferta, error: errorOferta } = await supabaseAdmin
      .from('oferta')
      .select('id, usuario_id')
      .eq('id', oferta_id)
      .single();

    if (errorOferta || !oferta) {
      return ResponseHandler.validationError(res, 'Oferta nÃ£o encontrada');
    }

    const mensagemData = {
      remetente_id,
      destinatario_id,
      oferta_id: Number(oferta_id),
      mensagem: mensagem.trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: true
    };

    const adminClient = await getSupabaseAdmin();
    const { data: novaMensagem, error: insertError } = await adminClient
      .from('mensagens')
      .insert([mensagemData])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23503') {
        return ResponseHandler.validationError(res, 'Erro de referÃªncia - verifique IDs da oferta e destinatÃ¡rio');
      }
      throw insertError;
    }

    res.status(201).json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      mensagem_id: novaMensagem.id,
      data_hora: novaMensagem.data_hora,
      destinatario_telefone: destinatario.telefone
    });
  } catch (error) {
    if (error.code === '42501') {
      ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel enviar mensagem devido Ã s polÃ­ticas de seguranÃ§a');
    } else if (error.code === '23503') {
      ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else {
      ResponseHandler.serverError(res, 'Erro ao enviar mensagem', error);
    }
  }
});

// âœ… GET COMENTÃRIOS
router.get('/comentarios/:itemId', verifyToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { tipo } = req.query;

    if (!itemId || !tipo) {
      return res.status(400).json({
        success: false,
        error: 'DADOS_INCOMPLETOS',
        message: 'ID do item e tipo sÃ£o obrigatÃ³rios'
      });
    }

    const itemIdNum = parseInt(itemId);
    if (isNaN(itemIdNum)) {
      return res.status(400).json({
        success: false,
        error: 'ID_ITEM_INVALIDO',
        message: 'ID do item invÃ¡lido'
      });
    }

    const { data: comentarios, error } = await supabase
      .from('comentarios')
      .select('id, comentario, status, created_at, usuario_id')
      .eq(`${tipo}_id`, itemIdNum)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    if (comentarios && comentarios.length > 0) {
      const usuarioIds = [...new Set(comentarios.map(c => c.usuario_id))];
      const usuariosMap = await _getUsersBatch(usuarioIds, 'id, nome, imagem_url, telefone');

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

// âœ… SISTEMA DE COMENTÃRIOS
router.post('/comentarios', verifyToken, async (req, res) => {
  try {
    const { item_id, tipo_conteudo, comentario } = req.body;
    const usuario_id = req.user.id;

    if (!item_id || !tipo_conteudo || !comentario?.trim()) {
      return ResponseHandler.validationError(res, 'Dados incompletos para comentÃ¡rio');
    }

    if (!isValidNumber(item_id)) {
      return ResponseHandler.validationError(res, 'ID do item invÃ¡lido');
    }

    if (comentario.trim().length < 2) {
      return ResponseHandler.validationError(res, 'ComentÃ¡rio deve ter pelo menos 2 caracteres');
    }

    if (comentario.trim().length > 500) {
      return ResponseHandler.validationError(res, 'ComentÃ¡rio muito longo (mÃ¡ximo 500 caracteres)');
    }

    const comentarioData = {
      usuario_id,
      tipo_conteudo,
      [`${tipo_conteudo}_id`]: Number(item_id),
      comentario: comentario.trim(),
      status: 'ativo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    let novoComentario;
    let { data, error } = await supabase
      .from('comentarios')
      .insert([comentarioData])
      .select('id, comentario, status, created_at, usuario_id')
      .single();

    if (error && (error.code === '23503' || error.code === '42501')) {
      const adminClient = await getSupabaseAdmin();
      const { data: adminData, error: adminError } = await adminClient
        .from('comentarios')
        .insert([comentarioData])
        .select('id, comentario, status, created_at, usuario_id')
        .single();

      if (adminError) {
        if (adminError.code === '23503') {
          return ResponseHandler.validationError(res, 'Erro de referÃªncia - verifique ID do item');
        }
        throw adminError;
      }
      novoComentario = adminData;
    } else if (error) {
      throw error;
    } else {
      novoComentario = data;
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url, telefone')
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
    } else {
      ResponseHandler.serverError(res, 'Erro ao adicionar comentÃ¡rio', error);
    }
  }
});

// âœ… CURTIDAS
router.post('/curtir', verifyToken, async (req, res) => {
  try {
    const { item_id, tipo_conteudo } = req.body;
    const usuario_id = req.user.id;

    if (!item_id || !tipo_conteudo) {
      return ResponseHandler.validationError(res, 'ID do item e tipo de conteÃºdo sÃ£o obrigatÃ³rios');
    }

    if (!isValidNumber(item_id)) {
      return ResponseHandler.validationError(res, 'ID do item invÃ¡lido');
    }

    const itemIdNum = parseInt(item_id);

    const columnMap = {
      'oferta': 'oferta_id',
      'servico': 'servico_id',
      'novidade': 'novidade_id'
    };

    const columnName = columnMap[tipo_conteudo];
    if (!columnName) {
      return ResponseHandler.validationError(res, 'Tipo de conteÃºdo nÃ£o suportado para curtidas');
    }

    const { data: curtidas } = await supabase
      .from('curtidas')
      .select('id, usuario_id, oferta_id, servico_id, novidade_id, tipo_conteudo')
      .eq('usuario_id', usuario_id)
      .eq(columnName, itemIdNum)
      .eq('tipo_conteudo', tipo_conteudo);

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

      if (deleteError) {
        throw deleteError;
      }
      operationResult = false;
      action = 'unliked';
    } else {
      const curtidaData = {
        usuario_id,
        tipo_conteudo,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      curtidaData[columnName] = itemIdNum;

      const { error: insertError } = await adminClient
        .from('curtidas')
        .insert([curtidaData]);

      if (insertError) {
        throw insertError;
      }
      operationResult = true;
      action = 'liked';
    }

    const { count: curtidasCount } = await supabase
      .from('curtidas')
      .select('*', { count: 'exact', head: true })
      .eq(columnName, itemIdNum)
      .eq('tipo_conteudo', tipo_conteudo);

    ResponseHandler.success(res, {
      isLiked: operationResult,
      action: action,
      curtidasCount: curtidasCount || 0,
      item_id: itemIdNum,
      tipo_conteudo
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

router.get('/curtidas/verificar/:itemId', verifyToken, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { tipo } = req.query;
    const usuario_id = req.user.id;

    if (!itemId || !tipo) {
      return ResponseHandler.validationError(res, 'ID do item e tipo sÃ£o obrigatÃ³rios');
    }

    if (!isValidNumber(itemId)) {
      return ResponseHandler.validationError(res, 'ID do item invÃ¡lido');
    }

    const columnMap = {
      'oferta': 'oferta_id',
      'servico': 'servico_id',
      'novidade': 'novidade_id'
    };

    const columnName = columnMap[tipo];
    if (!columnName) {
      return ResponseHandler.validationError(res, 'Tipo de conteÃºdo nÃ£o suportado');
    }

    const { data: curtidas, error } = await supabase
      .from('curtidas')
      .select('id')
      .eq('usuario_id', usuario_id)
      .eq(columnName, parseInt(itemId))
      .eq('tipo_conteudo', tipo);

    if (error) {
      throw error;
    }

    const isLiked = curtidas && curtidas.length > 0;
    
    ResponseHandler.success(res, {
      isLiked
    });
  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao verificar curtida', error);
  }
});

// âœ… ENDPOINTS ADICIONAIS
router.get('/vendedor/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !isValidUUID(id)) {
      return ResponseHandler.validationError(res, 'ID do vendedor invÃ¡lido');
    }

    const { data: vendedor, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, bairro, cidade, imagem_url, telefone')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return ResponseHandler.success(res, { 
          vendedor: {
            id: id,
            nome: 'Vendedor',
            bairro: 'Bairro nÃ£o informado',
            cidade: 'Cidade nÃ£o informada',
            imagem_url: null,
            telefone: null
          }
        });
      }
      throw error;
    }

    ResponseHandler.success(res, { vendedor: vendedor || {
      id: id,
      nome: 'Vendedor',
      bairro: 'Bairro nÃ£o informado',
      cidade: 'Cidade nÃ£o informada',
      imagem_url: null,
      telefone: null
    }});
  } catch (error) {
    ResponseHandler.success(res, { 
      vendedor: {
        id: req.params.id || 'unknown',
        nome: 'Vendedor',
        bairro: 'Bairro nÃ£o informado',
        cidade: 'Cidade nÃ£o informada',
        imagem_url: null,
        telefone: null
      }
    });
  }
});

// âœ… ENDPOINT DE ANÃšNCIOS
router.get('/anuncios', verifyToken, async (req, res) => {
  try {
    const { categoria, cidade } = req.query;
    const userId = req.user.id;

    let query = supabase
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, categoria, condicao, descricao, nivel, usuario_id, cidade')
      .neq('usuario_id', userId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .eq('nivel', 'basic')
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false });

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    if (cidade) {
      query = query.eq('cidade', cidade);
    }

    query = query.limit(8);

    const { data: ofertas, error } = await query;

    if (error) {
      throw error;
    }

    if (ofertas && ofertas.length > 0) {
      const maisRecentes = ofertas.slice(0, 2);
      const restantes = ofertas.slice(2);
      const aleatorios = _shuffleArray(restantes).slice(0, 2);
      const anunciosSelecionados = [...maisRecentes, ...aleatorios];
      const anunciosFinal = anunciosSelecionados.slice(0, 4);

      const vendedorIds = anunciosFinal.map(a => a.usuario_id).filter(id => id);
      const vendedoresMap = await _getUsersBatch(vendedorIds, 'id, nome, bairro, cidade, imagem_url, telefone');

      const anunciosComVendedor = anunciosFinal.map(anuncio => ({
        ...anuncio,
        vendedor: vendedoresMap.get(anuncio.usuario_id) || {
          id: anuncio.usuario_id,
          nome: 'Vendedor',
          bairro: 'Bairro nÃ£o informado',
          cidade: 'Cidade nÃ£o informada',
          imagem_url: null,
          telefone: null
        }
      }));

      return ResponseHandler.success(res, {
        anuncios: anunciosComVendedor,
        total: anunciosComVendedor.length,
        tipo: 'oferta (2 recentes + 2 aleatÃ³rios)'
      });
    }

    ResponseHandler.success(res, {
      anuncios: [],
      total: 0,
      tipo: 'oferta'
    });
  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar anÃºncios', error);
  }
});

router.get('/fretes', verifyToken, async (req, res) => {
  try {
    const { categoria, subcategoria, cidade } = req.query;
    const userId = req.user.id;

    let query = supabase
      .from('servicos')
      .select('*')
      .neq('usuario_id', userId)
      .eq('status', 'Ativo');

    if (categoria) {
      query = query.eq('categoria', categoria);
    }
    
    if (subcategoria) {
      query = query.eq('subcategoria', subcategoria);
    }
    
    if (cidade) {
      query = query.ilike('cidade', `%${cidade}%`);
    }

    query = query.order('created_at', { ascending: false }).limit(20);

    const { data: servicos, error } = await query;
    if (error) {
      throw error;
    }

    let servicosFormatados = [];

    if (servicos && servicos.length > 0) {
      const usuarioIds = [...new Set(servicos.map(s => s.usuario_id))];
      const usuariosMap = await _getUsersBatch(usuarioIds, 'id, nome, bairro, cidade, imagem_url, telefone');

      servicosFormatados = servicos.map(servico => {
        const usuario = usuariosMap.get(servico.usuario_id);

        return {
          ...servico,
          vendedor: {
            id: servico.usuario_id,
            nome: usuario?.nome || 'Prestador',
            bairro: usuario?.bairro || 'Bairro nÃ£o informado',
            cidade: usuario?.cidade || 'Cidade nÃ£o informada',
            imagem_url: usuario?.imagem_url || null,
            telefone: usuario?.telefone || null
          }
        };
      });
    }

    ResponseHandler.success(res, {
      servicos: servicosFormatados,
      total: servicosFormatados.length
    });
  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar serviÃ§os de frete', error);
  }
});

router.get('/subcategorias/:categoria', async (req, res) => {
  try {
    const { categoria } = req.params;

    const { data: subcategorias, error } = await supabase
      .from('subcategoria')
      .select('id, nome, Categoria')
      .eq('Categoria', categoria)
      .order('nome', { ascending: true });

    if (error) {
      throw error;
    }

    ResponseHandler.success(res, {
      subcategorias: subcategorias || []
    });
  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar subcategorias', error);
  }
});

// âœ… ENDPOINT DE OFERTAS RECOMENDADAS
router.get('/ofertas-recomendadas', verifyToken, async (req, res) => {
  try {
    const { categoria, cidade } = req.query;
    const userId = req.user.id;

    let query = supabase
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, categoria, condicao, descricao, usuario_id, cidade, nivel')
      .neq('usuario_id', userId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .eq('nivel', 'standard')
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false });

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    if (cidade) {
      query = query.eq('cidade', cidade);
    }

    query = query.limit(8);

    const { data: ofertas, error } = await query;

    if (error) {
      throw error;
    }

    if (ofertas && ofertas.length > 0) {
      const maisRecentes = ofertas.slice(0, 2);
      const restantes = ofertas.slice(2);
      const aleatorios = _shuffleArray(restantes).slice(0, 2);
      const ofertasSelecionadas = [...maisRecentes, ...aleatorios];
      const ofertasFinal = ofertasSelecionadas.slice(0, 4);

      const vendedorIds = ofertasFinal.map(p => p.usuario_id).filter(id => id);
      const vendedoresMap = await _getUsersBatch(vendedorIds, 'id, nome, bairro, cidade, imagem_url, telefone');

      const ofertasComVendedor = ofertasFinal.map(oferta => ({
        ...oferta,
        vendedor: vendedoresMap.get(oferta.usuario_id) || {
          id: oferta.usuario_id,
          nome: 'Vendedor',
          bairro: 'Bairro nÃ£o informado',
          cidade: 'Cidade nÃ£o informada',
          imagem_url: null,
          telefone: null
        }
      }));

      return ResponseHandler.success(res, {
        ofertas: ofertasComVendedor,
        total: ofertasComVendedor.length,
        tipo: 'oferta (2 recentes + 2 aleatÃ³rios)'
      });
    }

    ResponseHandler.success(res, {
      ofertas: [],
      total: 0,
      tipo: 'oferta'
    });
  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar ofertas recomendadas', error);
  }
});

module.exports = router;

