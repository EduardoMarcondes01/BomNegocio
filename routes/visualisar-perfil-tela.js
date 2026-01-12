const express = require('express');
const { supabase, supabaseAdmin  } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

const isValidUUID = (uuid) => {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
};

const isValidNumber = (num) => {
  return !isNaN(num) && num !== null && num !== undefined;
};

const calcularDiasRestantes = (dataFim) => {
  const fim = new Date(dataFim);
  const hoje = new Date();
  const diffTime = fim - hoje;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const ResponseHandler = {
  validationError: (res, message) => {
    return res.status(400).json({
      success: false,
      error: message
    });
  },
  error: (res, code, message) => {
    return res.status(403).json({
      success: false,
      error: message
    });
  },
  serverError: (res, message, error) => {
    return res.status(500).json({
      success: false,
      error: message
    });
  }
};

router.get('/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    const novidadesPage = parseInt(req.query.novidadesPage) || 1;
    const novidadesPerPage = 4;
    const novidadesOffset = (novidadesPage - 1) * novidadesPerPage;

    const { data: usuario, error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, sobrenome, imagem_url, bairro, cidade, telefone')
      .eq('id', userId)
      .single();

    if (usuarioError || !usuario) {
      return res.status(404).json({
        success: false,
        error: 'UsuÃ¡rio nÃ£o encontrado',
        debug: {
          userId: userId,
          errorCode: usuarioError?.code,
          errorMessage: usuarioError?.message,
          isValidUUID: isValidUUID(userId)
        }
      });
    }

    const [
      { data: produtos, error: produtosError },
      { data: ofertas, error: ofertasError },
      { data: novidades, error: novidadesError },
      { count: seguidoresCount },
      { data: seguindo },
      { data: favoritos },
    ] = await Promise.all([
      supabaseAdmin.from('produtos').select('*').eq('usuario_id', userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('ofertas').select('*, produtos(*)').eq('usuario_id', userId).eq('ativa', true).gte('data_fim', new Date().toISOString()),
      supabaseAdmin.from('novidades')
        .select('*, produtos(*)')
        .eq('usuario_id', userId)
        .order('data_publicacao', { ascending: false })
        .range(novidadesOffset, novidadesOffset + novidadesPerPage - 1),
      supabaseAdmin.from('Seguidores').select('*', { count: 'exact', head: true }).eq('perfil_seguido_id', userId),
      supabaseAdmin.from('Seguidores').select('*').eq('usuario_id', currentUserId).eq('perfil_seguido_id', userId).maybeSingle(),
      supabaseAdmin.from('favoritos').select('produto_id').eq('usuario_id', currentUserId),
    ]);

    if (produtosError || ofertasError || novidadesError) {
      throw new Error('Erro nas consultas');
    }

    const ofertasFormatadas = ofertas?.map(oferta => ({
      ...oferta,
      ...oferta.produtos,
      dias_restantes: calcularDiasRestantes(oferta.data_fim)
    })) || [];

    const novidadesFormatadas = novidades?.map(novidade => ({
      ...novidade,
      ...novidade.produtos
    })) || [];

    const produtosSalvos = favoritos?.map(f => f.produto_id.toString()) || [];
    const hasMoreNovidades = novidades?.length >= novidadesPerPage;

    const responseData = {
      success: true,
      usuario,
      produtos: produtos || [],
      ofertas: ofertasFormatadas,
      novidades: novidadesFormatadas,
      seguidoresCount: seguidoresCount || 0,
      isFollowing: !!seguindo,
      produtosSalvos,
      hasMoreNovidades,
      novidadesPage
    };

    res.status(200).json(responseData);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao carregar perfil',
      message: error.message,
      debug: {
        userId: req.params.userId,
        timestamp: new Date().toISOString()
      }
    });
  }
});

router.post('/favoritos', verifyToken, async (req, res) => {
  try {
    const { produto_id } = req.body;
    const usuarioId = req.user.id;

    const { data: produto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .select('id')
      .eq('id', produto_id)
      .single();

    if (produtoError || !produto) {
      return res.status(404).json({
        success: false,
        error: 'Produto nÃ£o encontrado'
      });
    }

    const { data: favorito } = await supabaseAdmin
      .from('favoritos')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('produto_id', produto_id)
      .maybeSingle();

    let action = 'removed';
    if (favorito) {
      await supabaseAdmin
        .from('favoritos')
        .delete()
        .eq('id', favorito.id);
    } else {
      await supabaseAdmin
        .from('favoritos')
        .insert([{
          usuario_id: usuarioId,
          produto_id: produto_id,
          created_at: new Date().toISOString()
        }]);
      action = 'added';
    }

    res.status(200).json({
      success: true,
      action: action,
      message: action === 'added'
        ? 'Produto adicionado aos favoritos'
        : 'Produto removido dos favoritos'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao atualizar favoritos',
      message: error.message
    });
  }
});

router.post('/seguir', verifyToken, async (req, res) => {
  try {
    const { perfilId, acao } = req.body;
    const usuarioId = req.user.id;

    if (!perfilId || !['seguir', 'deseguir'].includes(acao)) {
      return res.status(400).json({
        success: false,
        error: 'ParÃ¢metros invÃ¡lidos'
      });
    }

    if (acao === 'seguir') {
      const { data, error } = await supabaseAdmin
        .from('Seguidores')
        .insert([{
          usuario_id: usuarioId,
          perfil_seguido_id: perfilId,
          created_at: new Date().toISOString()
        }])
        .select();

      if (error) throw error;
      
      return res.status(200).json({ success: true, data: data[0] });
    } else {
      const { data, error } = await supabaseAdmin
        .from('Seguidores')
        .delete()
        .eq('usuario_id', usuarioId)
        .eq('perfil_seguido_id', perfilId)
        .select();

      if (error) throw error;
      
      return res.status(200).json({ success: true, data: data[0] });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Erro ao ${req.body.acao} perfil`,
      message: error.message
    });
  }
});

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

    const { data: novaMensagem, error: insertError } = await supabaseAdmin
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

module.exports = router;
