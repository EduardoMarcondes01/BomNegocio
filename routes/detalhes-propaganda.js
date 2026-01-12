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
    return ResponseHandler.error(res, 'VALIDATION_ERROR', message, details);
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
function _getDefaultSeller(vendedorId) {
  return {
    id: vendedorId,
    nome: 'Vendedor',
    bairro: 'Bairro nÃ£o informado',
    imagem_url: null,
    telefone: null
  };
}

function _getDefaultUser(userId) {
  return {
    id: userId,
    nome: 'UsuÃ¡rio',
    imagem_url: null,
    telefone: null
  };
}

function _getResult(result, defaultValue) {
  if (!result || typeof result !== 'object') {
    return defaultValue;
  }
  return result.status === 'fulfilled' ? result.value : defaultValue;
}

// âœ… BUSCA DE VENDEDORES EM BATCH
async function _getUsersBatch(userIds, fields = 'id, nome, imagem_url, telefone, bairro') {
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

// âœ… BUSCA DE PROPAGANDA + VENDEDOR
async function _getPropagandaInfo(propagandaId) {
  if (!isValidNumber(propagandaId)) {
    return null;
  }

  try {
    // BUSCAR PROPAGANDA
    const { data: propaganda, error } = await supabase
      .from('produtos_propaganda')
      .select(`
        id,
        nome,
        valor,
        condicao,
        categoria,
        descricao,
        cidade,
        rua,
        entrega,
        usuario_id,
        imagens,
        created_at,
        nivel,
        status,
        date_expired,
        status_pagamento,
        visualizacoes_restantes
      `)
      .eq('id', propagandaId)
      .eq('status', true)
      .eq('status_pagamento', true)
      .gt('visualizacoes_restantes', 0)
      .single();

    if (error || !propaganda) {
      return null;
    }

    // BUSCAR VENDEDOR SEPARADAMENTE
    const vendedorMap = await _getUsersBatch([propaganda.usuario_id], 'id, nome, bairro, imagem_url, telefone');
    const vendedor = vendedorMap.get(propaganda.usuario_id) || _getDefaultSeller(propaganda.usuario_id);

    return {
      ...propaganda,
      vendedor: vendedor
    };

  } catch (error) {
    return null;
  }
}

// âœ… BUSCA DE PROPAGANDAS COM VENDEDORES EM BATCH
async function _getPropagandasWithSellers(config) {
  const {
    categoria,
    usuarioId,
    limit,
    excludeUserId = true,
    onlyRecommended = false
  } = config;

  try {
    // 1. BUSCAR PROPAGANDAS
    let query = supabase
      .from('produtos_propaganda')
      .select(`
        id,
        nome,
        valor,
        imagens,
        categoria,
        condicao,
        descricao,
        nivel,
        usuario_id
      `)
      .eq('status', true)
      .eq('status_pagamento', true)
      .gt('visualizacoes_restantes', 0);

    if (excludeUserId && usuarioId) {
      query = query.neq('usuario_id', usuarioId);
    }

    if (categoria) {
      query = query.eq('categoria', categoria);
    }

    if (onlyRecommended) {
      query = query.gt('date_expired', new Date().toISOString());
    }

    if (limit) {
      query = query.limit(limit);
    }

    query = query.order('created_at', { ascending: false });

    const { data: propagandas, error } = await query;

    if (error || !propagandas || propagandas.length === 0) {
      return [];
    }

    // 2. BUSCAR VENDEDORES EM BATCH
    const userIds = propagandas.map(p => p.usuario_id).filter(id => id);
    const usuariosMap = await _getUsersBatch(userIds, 'id, nome, bairro, imagem_url, telefone');

    // 3. COMBINAR DADOS
    const propagandasComVendedor = propagandas.map(propaganda => ({
      ...propaganda,
      vendedor: usuariosMap.get(propaganda.usuario_id) || _getDefaultSeller(propaganda.usuario_id)
    }));

    return propagandasComVendedor;

  } catch (error) {
    return [];
  }
}

// âœ… BUSCA DE COMENTÃRIOS COM USUÃRIOS EM BATCH
async function _getComentarios(itemId, tipoConteudo) {
  if (!isValidNumber(itemId)) {
    return [];
  }

  try {
    // 1. BUSCAR COMENTÃRIOS
    const { data: comentarios, error } = await supabase
      .from('comentarios')
      .select(`
        id,
        comentario,
        status,
        created_at,
        usuario_id
      `)
      .eq(`${tipoConteudo}_id`, Number(itemId))
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (error || !comentarios || comentarios.length === 0) {
      return [];
    }

    // 2. BUSCAR USUÃRIOS EM BATCH
    const userIds = comentarios.map(c => c.usuario_id).filter(id => id);
    const usuariosMap = await _getUsersBatch(userIds, 'id, nome, imagem_url, telefone');

    // 3. COMBINAR DADOS
    const comentariosComUsuario = comentarios.map(comentario => ({
      ...comentario,
      usuario: usuariosMap.get(comentario.usuario_id) || _getDefaultUser(comentario.usuario_id)
    }));

    return comentariosComUsuario;

  } catch (error) {
    return [];
  }
}

// âœ… ENDPOINT PRINCIPAL - /initial-data
router.get('/initial-data', verifyToken, async (req, res) => {
  try {
    const { propaganda_id, categoria, vendedor_id } = req.query;
    const usuario_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!propaganda_id || !vendedor_id) {
      return ResponseHandler.validationError(res, 'ParÃ¢metros obrigatÃ³rios faltando');
    }

    if (!isValidUUID(vendedor_id) || !isValidNumber(propaganda_id)) {
      return ResponseHandler.validationError(res, 'IDs invÃ¡lidos');
    }

    // 1. BUSCAR PROPAGANDA COM VENDEDOR
    const propagandaInfo = await _getPropagandaInfo(propaganda_id);

    if (!propagandaInfo) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'Propaganda nÃ£o encontrada');
    }

    // 2. BUSCAR DEMAIS DADOS EM PARALELO
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 10000)
    );

    const dataPromise = Promise.allSettled([
      // AnÃºncios relacionados
      _getPropagandasWithSellers({
        categoria,
        usuarioId: usuario_id,
        limit: 2
      }),

      // ComentÃ¡rios
      _getComentarios(propaganda_id, 'propaganda'),

      // Propagandas recomendadas
      _getPropagandasWithSellers({
        categoria,
        usuarioId: usuario_id,
        limit: 4,
        onlyRecommended: true
      })
    ]);

    const results = await Promise.race([dataPromise, timeoutPromise]);

    // 3. CONSTRUIR RESPOSTA
    const responseData = {
      propaganda: propagandaInfo,
      vendedor: propagandaInfo.vendedor,
      anuncios: _getResult(results[0], []),
      comentarios: _getResult(results[1], []),
      propagandasRecomendadas: _getResult(results[2], [])
    };

    ResponseHandler.success(res, responseData, 'Dados carregados com sucesso');

  } catch (error) {
    if (error.message === 'TIMEOUT') {
      ResponseHandler.error(res, 'TIMEOUT', 'Tempo de carregamento esgotado');
    } else {
      ResponseHandler.serverError(res, 'Erro ao carregar dados', error);
    }
  }
});

// âœ… ENDPOINTS INDIVIDUAIS PARA FALLBACK
router.get('/vendedor/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return ResponseHandler.validationError(res, 'ID invÃ¡lido');
    }

    const usuariosMap = await _getUsersBatch([id]);
    const vendedor = usuariosMap.get(id) || _getDefaultSeller(id);

    ResponseHandler.success(res, { vendedor });

  } catch (error) {
    ResponseHandler.success(res, { vendedor: _getDefaultSeller(req.params.id) });
  }
});

router.get('/anuncios-propaganda', verifyToken, async (req, res) => {
  try {
    const { categoria } = req.query;
    const anuncios = await _getPropagandasWithSellers({
      categoria,
      usuarioId: req.user.id,
      limit: 2
    });

    ResponseHandler.success(res, { anuncios });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar anÃºncios', error);
  }
});

router.get('/recomendados-propaganda', verifyToken, async (req, res) => {
  try {
    const { categoria } = req.query;
    const propagandas = await _getPropagandasWithSellers({
      categoria,
      usuarioId: req.user.id,
      limit: 4,
      onlyRecommended: true
    });

    ResponseHandler.success(res, { propagandas });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar recomendados', error);
  }
});

router.get('/comentarios/:propagandaId', verifyToken, async (req, res) => {
  try {
    const { propagandaId } = req.params;

    if (!propagandaId) {
      return ResponseHandler.validationError(res, 'ID da propaganda Ã© obrigatÃ³rio');
    }

    const comentarios = await _getComentarios(propagandaId, 'propaganda');
    ResponseHandler.success(res, { comentarios });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar comentÃ¡rios', error);
  }
});

// âœ… REGISTRAR VISUALIZAÃ‡ÃƒO DE PROPAGANDA
router.post('/visualizacoes/registrar', verifyToken, async (req, res) => {
  let adminClient = null;

  try {
    const { propaganda_id, vendedor_id, categoria } = req.body;
    const visualizador_id = req.user.id;

    // ValidaÃ§Ãµes bÃ¡sicas
    if (!propaganda_id) {
      return ResponseHandler.validationError(res, 'ID da propaganda Ã© obrigatÃ³rio');
    }

    if (!vendedor_id || !isValidUUID(vendedor_id)) {
      return ResponseHandler.validationError(res, 'ID do vendedor invÃ¡lido');
    }

    if (!isValidNumber(propaganda_id)) {
      return ResponseHandler.validationError(res, 'ID da propaganda invÃ¡lido');
    }

    const propagandaIdNum = parseInt(propaganda_id);

    // Obter cliente admin
    adminClient = await getSupabaseAdmin();

    // Buscar propaganda
    const { data: propaganda, error: propagandaError } = await adminClient
      .from('produtos_propaganda')
      .select('id, nome, usuario_id, visualizacoes_restantes, status, status_pagamento, date_expired')
      .eq('id', propagandaIdNum)
      .eq('status', true)
      .eq('status_pagamento', true)
      .single();

    if (propagandaError) {
      if (propagandaError.code === 'PGRST116') {
        return ResponseHandler.error(res, 'NOT_FOUND', 'Propaganda nÃ£o encontrada');
      }
      throw propagandaError;
    }

    if (!propaganda) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'Propaganda nÃ£o encontrada');
    }

    // Verificar visualizaÃ§Ãµes restantes
    if (propaganda.visualizacoes_restantes <= 0) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'VisualizaÃ§Ãµes esgotadas para esta propaganda');
    }

    // Verificar propriedade da propaganda
    if (propaganda.usuario_id !== vendedor_id) {
      return ResponseHandler.validationError(res, 'Vendedor nÃ£o Ã© o dono desta propaganda');
    }

    // Verificar se jÃ¡ hÃ¡ registro recente
    const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: visualizacaoExistente } = await adminClient
      .from('visualizacoes_produtos')
      .select('id')
      .eq('visualizador_id', visualizador_id)
      .eq('propaganda_id', propagandaIdNum)
      .eq('tipo_conteudo', 'propaganda')
      .gte('created_at', umaHoraAtras)
      .maybeSingle();

    // Preparar dados para histÃ³rico
    const visualizacaoData = {
      propaganda_id: propagandaIdNum,
      tipo_conteudo: 'propaganda',
      vendedor_id,
      visualizador_id,
      categoria: categoria || 'geral',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // VariÃ¡veis para transaÃ§Ã£o
    let novasVisualizacoesRestantes = propaganda.visualizacoes_restantes;
    let novaVisualizacao = null;
    let registroCriado = false;
    let novoStatus = propaganda.status;
    let novaDateExpired = propaganda.date_expired;

    try {
      // 1. DECREMENTAR VISUALIZAÃ‡Ã•ES E ATUALIZAR STATUS/DATA
      const { data: decrementResult, error: decrementError } = await adminClient.rpc(
        'decrementar_e_atualizar_propaganda',
        { propaganda_id_param: propagandaIdNum }
      );

      if (decrementError) {
        throw decrementError;
      }

      novasVisualizacoesRestantes = decrementResult !== null ? decrementResult : 0;

      // Buscar dados atualizados da propaganda
      const { data: propagandaAtualizada } = await adminClient
        .from('produtos_propaganda')
        .select('status, date_expired')
        .eq('id', propagandaIdNum)
        .single();

      if (propagandaAtualizada) {
        novoStatus = propagandaAtualizada.status;
        novaDateExpired = propagandaAtualizada.date_expired;
      }

      // 2. REGISTRAR HISTÃ“RICO (APENAS SE NÃƒO HOUVER REGISTRO RECENTE)
      if (!visualizacaoExistente) {
        const { data: insertData, error: insertError } = await adminClient
          .from('visualizacoes_produtos')
          .insert([visualizacaoData])
          .select()
          .single();

        if (insertError) {
          if (insertError.code === '23505') {
            // Duplicata - mantÃ©m decremento mas nÃ£o cria novo registro
            return ResponseHandler.success(res, {
              action: 'viewed_but_duplicate_log',
              visualizacoes_restantes: novasVisualizacoesRestantes,
              status: novoStatus,
              date_expired: novaDateExpired,
              propaganda_id: propagandaIdNum,
              propaganda_nome: propaganda.nome
            }, 'VisualizaÃ§Ã£o contabilizada');
          }

          // Rollback do decremento
          await adminClient
            .from('produtos_propaganda')
            .update({
              visualizacoes_restantes: propaganda.visualizacoes_restantes,
              status: propaganda.status,
              date_expired: propaganda.date_expired
            })
            .eq('id', propagandaIdNum);

          throw insertError;
        }

        novaVisualizacao = insertData;
        registroCriado = true;
      }

    } catch (transactionError) {
      // Rollback apenas para erros nÃ£o-duplicata
      if (propaganda?.visualizacoes_restantes !== undefined && transactionError.code !== '23505') {
        try {
          await adminClient
            .from('produtos_propaganda')
            .update({
              visualizacoes_restantes: propaganda.visualizacoes_restantes,
              status: propaganda.status,
              date_expired: propaganda.date_expired
            })
            .eq('id', propagandaIdNum);
        } catch (rollbackErr) {
          // Ignorar erro no rollback
        }
      }
      throw transactionError;
    }

    return ResponseHandler.success(res, {
      data: {
        visualizacao: novaVisualizacao,
        visualizacoes_restantes: novasVisualizacoesRestantes,
        status: novoStatus,
        date_expired: novaDateExpired,
        propaganda_id: propagandaIdNum,
        propaganda_nome: propaganda.nome,
        registro_criado: registroCriado
      },
      action: visualizacaoExistente ? 'viewed_without_new_log' : 'viewed_with_new_log'
    }, registroCriado ? 'VisualizaÃ§Ã£o registrada' : 'VisualizaÃ§Ã£o contabilizada');

  } catch (error) {
    if (error.code === '42501') {
      return ResponseHandler.error(res, 'FORBIDDEN', 'Acesso nÃ£o autorizado');
    } else if (error.code === '23503') {
      return ResponseHandler.validationError(res, 'Erro de referÃªncia no banco de dados');
    } else if (error.message?.includes('timeout')) {
      return ResponseHandler.error(res, 'TIMEOUT', 'Tempo limite excedido');
    } else {
      return ResponseHandler.serverError(res, 'Erro ao registrar visualizaÃ§Ã£o');
    }
  }
});

// âœ… ENVIAR MENSAGEM
router.post('/mensagens', verifyToken, async (req, res) => {
  let adminClient = null;

  try {
    const { propaganda_id, destinatario_id, mensagem } = req.body;
    const remetente_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!propaganda_id || !isValidNumber(propaganda_id)) {
      return ResponseHandler.validationError(res, 'ID da propaganda Ã© obrigatÃ³rio e deve ser vÃ¡lido');
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

    // Obter cliente admin
    adminClient = await getSupabaseAdmin();

    // Buscar destinatÃ¡rio
    const { data: destinatario, error: errorDestinatario } = await adminClient
      .from('usuarios')
      .select('id, nome, telefone')
      .eq('id', destinatario_id)
      .single();

    if (errorDestinatario) {
      if (errorDestinatario.code === 'PGRST116') {
        return ResponseHandler.validationError(res, 'DestinatÃ¡rio nÃ£o encontrado');
      }
      throw errorDestinatario;
    }

    if (!destinatario) {
      return ResponseHandler.validationError(res, 'DestinatÃ¡rio nÃ£o encontrado');
    }

    // Buscar propaganda
    const { data: propaganda, error: errorPropaganda } = await adminClient
      .from('produtos_propaganda')
      .select('id, nome, usuario_id, status')
      .eq('id', propaganda_id)
      .eq('status', true)
      .single();

    if (errorPropaganda) {
      if (errorPropaganda.code === 'PGRST116') {
        return ResponseHandler.validationError(res, 'Propaganda nÃ£o encontrada ou nÃ£o estÃ¡ disponÃ­vel');
      }
      throw errorPropaganda;
    }

    if (!propaganda) {
      return ResponseHandler.validationError(res, 'Propaganda nÃ£o encontrada');
    }

    // Verificar se a propaganda pertence ao destinatÃ¡rio
    if (propaganda.usuario_id !== destinatario.id) {
      return ResponseHandler.validationError(res, 'Esta propaganda nÃ£o pertence ao destinatÃ¡rio');
    }

    // Preparar dados da mensagem
    const mensagemData = {
      remetente_id,
      destinatario_id,
      produto_id: Number(propaganda_id),
      mensagem: mensagem.trim(),
      data_hora: new Date().toISOString(),
      lida: false,
      remetente_deletado: false,
      destinatario_deletado: false,
      oferta: false
    };

    // Inserir mensagem
    const { data: novaMensagem, error: insertError } = await adminClient
      .from('mensagens_propaganda')
      .insert([mensagemData])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23503') {
        return ResponseHandler.validationError(res, 'Erro de referÃªncia - verifique IDs da propaganda e destinatÃ¡rio');
      }

      if (insertError.code === '42501') {
        return ResponseHandler.error(res, 'FORBIDDEN', 'NÃ£o foi possÃ­vel enviar mensagem devido Ã s polÃ­ticas de seguranÃ§a');
      }

      throw insertError;
    }

    res.status(201).json({
      success: true,
      message: 'Mensagem enviada com sucesso',
      mensagem_id: novaMensagem.id,
      data_hora: novaMensagem.data_hora,
      propaganda: {
        id: propaganda.id,
        nome: propaganda.nome
      },
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

// âœ… ENDPOINTS ADICIONAIS (mantidos para compatibilidade)
router.get('/propaganda/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidNumber(id)) {
      return ResponseHandler.validationError(res, 'ID da propaganda invÃ¡lido');
    }

    const propagandaInfo = await _getPropagandaInfo(id);

    if (!propagandaInfo) {
      return ResponseHandler.error(res, 'NOT_FOUND', 'Propaganda nÃ£o encontrada');
    }

    ResponseHandler.success(res, {
      propaganda: propagandaInfo
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar propaganda', error);
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

    if (categoria) query = query.eq('categoria', categoria);
    if (subcategoria) query = query.eq('subcategoria', subcategoria);
    if (cidade) query = query.ilike('cidade', `%${cidade}%`);

    query = query.order('created_at', { ascending: false }).limit(20);

    const { data: servicos, error } = await query;
    if (error) throw error;

    let servicosFormatados = [];

    if (servicos && servicos.length > 0) {
      const usuarioIds = [...new Set(servicos.map(s => s.usuario_id))];

      const { data: usuarios } = await supabaseAdmin
        .from('usuarios')
        .select('id, nome, bairro, imagem_url, telefone')
        .in('id', usuarioIds);

      servicosFormatados = servicos.map(servico => {
        const usuario = usuarios?.find(u => u.id === servico.usuario_id);

        return {
          ...servico,
          vendedor: {
            id: servico.usuario_id,
            nome: usuario?.nome || 'Prestador',
            bairro: usuario?.bairro || 'Bairro nÃ£o informado',
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

    if (error) throw error;

    ResponseHandler.success(res, {
      subcategorias: subcategorias || []
    });

  } catch (error) {
    ResponseHandler.serverError(res, 'Erro ao carregar subcategorias', error);
  }
});

module.exports = router;

