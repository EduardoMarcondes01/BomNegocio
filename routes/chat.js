// routes/chat.js
const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const { enviarNotificacaoRealtime } = require('./chatRealtime.js');

const router = express.Router();

// Helper para validação de UUID
const isValidUUID = (id) => {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
};

// ==================== ROTA: LISTAR CONVERSAS ====================
router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    // Buscar mensagens do usuário (excluindo ofertas)
    const { data: mensagens, error: mensagensError } = await supabaseAdmin
      .from('mensagens')
      .select('*')
      .or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`)
      .or(`and(remetente_id.eq.${userId},remetente_deletado.is.false),and(destinatario_id.eq.${userId},destinatario_deletado.is.false)`)
      .is('oferta', false)
      .order('data_hora', { ascending: false });

    if (mensagensError) throw mensagensError;

    if (!mensagens || mensagens.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 10, hasNext: false }
      });
    }

    // Agrupa por conversa
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

    // Busca dados dos produtos
    const produtoIds = conversasPaginadas.map(c => c.produto_id);
    const contatoIds = [...new Set(conversasPaginadas.map(c => c.contato_id))];

    const { data: produtos, error: produtosError } = await supabaseAdmin
      .from('produtos')
      .select('id, nome, valor, imagens')
      .in('id', produtoIds);

    if (produtosError) throw produtosError;

    const { data: contatos, error: contatosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url, cidade')
      .in('id', contatoIds);

    if (contatosError) throw contatosError;

    // Monta resposta final
    const conversas = conversasPaginadas.map(conversa => {
      const produto = produtos.find(p => p.id === conversa.produto_id);
      const contato = contatos.find(c => c.id === conversa.contato_id);

      // Conta mensagens não lidas
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
          nome: produto?.nome || 'Produto não encontrado',
          valor: produto?.valor || 0,
          imagens: produto?.imagens || []
        },
        contato: {
          id: contato?.id || conversa.contato_id,
          nome: contato?.nome || 'Usuário não encontrado',
          foto: contato?.imagem_url || null,
          cidade: contato?.cidade || 'Cidade não informada'
        },
        ultima_mensagem: conversa.ultima_mensagem,
        ultima_mensagem_hora: conversa.ultima_mensagem_hora,
        nao_lidas: mensagensNaoLidas,
        eh_remetente: conversa.eh_remetente,
        tem_anexo: !!conversa.anexo_url,
        tipo_anexo: conversa.tipo_anexo
      };
    });

    // Ordena por data
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
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao carregar conversas',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// ==================== ROTA: ENVIAR MENSAGEM COM REALTIME ====================
router.post('/enviar', verifyToken, async (req, res) => {
  try {
    const { destinatario_id, produto_id, mensagem, anexo_url, tipo_anexo } = req.body;
    const remetente_id = req.user.id;

    // Validações
    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    if (!destinatario_id || !isValidUUID(destinatario_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_DESTINATARIO_INVALIDO',
        message: 'ID do destinatário inválido'
      });
    }

    // 1. Salva a mensagem no banco
    const { data: novaMensagem, error: insertError } = await supabaseAdmin
      .from('mensagens')
      .insert({
        remetente_id,
        destinatario_id,
        produto_id,
        mensagem: mensagem || '',
        anexo_url: anexo_url || null,
        tipo_anexo: tipo_anexo || null,
        data_hora: new Date().toISOString(),
        lida: false,
        remetente_deletado: false,
        destinatario_deletado: false,
        oferta: false
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // 2. Envia notificação em tempo real para o DESTINATÁRIO
    try {
      await enviarNotificacaoRealtime(destinatario_id, {
        tipo: 'nova_mensagem',
        mensagem: novaMensagem,
        conversaId: `${produto_id}_${remetente_id}`,
        remetente: {
          id: remetente_id,
          nome: req.user.nome || 'Usuário'
        },
        produto_id: produto_id,
        timestamp: new Date().toISOString()
      });
    } catch (realtimeError) {
      // Continua mesmo se realtime falhar
    }

    // 3. Retorna sucesso
    res.json({
      success: true,
      data: novaMensagem,
      message: 'Mensagem enviada com sucesso'
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

// ==================== ROTA: MARCAR COMO LIDA ====================
router.post('/:conversaId/ler', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { produto_id, contato_id } = req.body;
    const userId = req.user.id;

    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    if (!contato_id || !isValidUUID(contato_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato inválido'
      });
    }

    // Atualiza mensagens não lidas
    const { error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ lida: true })
      .eq('produto_id', produto_id)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .eq('lida', false)
      .is('oferta', false);

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao marcar mensagens como lidas'
    });
  }
});

// ==================== ROTA: EXCLUIR CONVERSA ====================
router.delete('/:conversaId', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { produto_id, contato_id } = req.body;
    const userId = req.user.id;

    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    if (!contato_id || !isValidUUID(contato_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato inválido'
      });
    }

    // Atualiza como remetente
    const { data: mensagensAtualizadas, error: updateError } = await supabaseAdmin
      .from('mensagens')
      .update({ remetente_deletado: true })
      .eq('produto_id', produto_id)
      .eq('remetente_id', userId)
      .eq('destinatario_id', contato_id)
      .is('oferta', false)
      .select();

    if (updateError) throw updateError;

    // Atualiza como destinatário
    const { data: mensagensAtualizadas2, error: updateError2 } = await supabaseAdmin
      .from('mensagens')
      .update({ destinatario_deletado: true })
      .eq('produto_id', produto_id)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .is('oferta', false)
      .select();

    if (updateError2) throw updateError2;

    const totalAtualizadas = (mensagensAtualizadas?.length || 0) + (mensagensAtualizadas2?.length || 0);

    res.json({
      success: true,
      message: 'Conversa excluída com sucesso',
      data: {
        conversaId,
        mensagensAtualizadas: totalAtualizadas
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao excluir conversa'
    });
  }
});

//==================== ROTA: PROPAGANDA ====================

// ==================== ROTA: LISTAR CONVERSAS PROPAGANDA ====================
router.get('/propaganda', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user.id;

    // 1. Buscar mensagens do usuário
    const { data: mensagens, error: mensagensError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .select('*')
      .or(`remetente_id.eq.${userId},destinatario_id.eq.${userId}`)
      .or(`and(remetente_id.eq.${userId},remetente_deletado.is.false),and(destinatario_id.eq.${userId},destinatario_deletado.is.false)`)
      .is('oferta', false)
      .order('data_hora', { ascending: false });

    if (mensagensError) {
      throw mensagensError;
    }

    if (!mensagens || mensagens.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 10, hasNext: false }
      });
    }

    // 2. Agrupar por conversa
    const conversasMap = new Map();

    mensagens.forEach((msg) => {
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

    // 3. Buscar dados dos produtos/propagandas
    const produtoIds = conversasPaginadas.map(c => c.produto_id);
    const contatoIds = [...new Set(conversasPaginadas.map(c => c.contato_id))];

    const { data: produtos, error: produtosError } = await supabaseAdmin
      .from('produtos_propaganda')
      .select('id, nome, valor, imagens, status, categoria')
      .in('id', produtoIds);

    if (produtosError) {
      throw produtosError;
    }

    const { data: contatos, error: contatosError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, imagem_url, cidade')
      .in('id', contatoIds);

    if (contatosError) {
      throw contatosError;
    }

    // 4. Montar resposta final
    const conversas = conversasPaginadas.map(conversa => {
      const produto = produtos.find(p => p.id === conversa.produto_id);
      const contato = contatos.find(c => c.id === conversa.contato_id);

      // Conta mensagens não lidas
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
          nome: produto?.nome || 'Produto não encontrado',
          valor: produto?.valor || 0,
          imagens: produto?.imagens || []
        },
        contato: {
          id: contato?.id || conversa.contato_id,
          nome: contato?.nome || 'Usuário não encontrado',
          foto: contato?.imagem_url || null,
          cidade: contato?.cidade || 'Cidade não informada'
        },
        ultima_mensagem: conversa.ultima_mensagem,
        ultima_mensagem_hora: conversa.ultima_mensagem_hora,
        nao_lidas: mensagensNaoLidas,
        eh_remetente: conversa.eh_remetente,
        tem_anexo: !!conversa.anexo_url,
        tipo_anexo: conversa.tipo_anexo
      };
    });

    // 5. Ordenar por data
    conversas.sort((a, b) => new Date(b.ultima_mensagem_hora) - new Date(a.ultima_mensagem_hora));

    const resposta = {
      success: true,
      data: conversas,
      meta: {
        total: totalConversas,
        page: parseInt(page),
        limit: parseInt(limit),
        hasNext: totalConversas > page * limit
      }
    };

    res.json(resposta);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao carregar conversas',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

// ==================== ROTA: MARCAR COMO LIDA PROPAGANDA ====================
router.post('/propaganda/:conversaId/ler', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { produto_id, contato_id } = req.body;
    const userId = req.user.id;

    if (!produto_id || isNaN(Number(produto_id))) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    if (!contato_id || !isValidUUID(contato_id)) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato inválido'
      });
    }

    // Atualiza mensagens não lidas
    const { error: updateError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .update({ lida: true })
      .eq('produto_id', produto_id)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .eq('lida', false)
      .is('oferta', false);

    if (updateError) throw updateError;

    res.json({
      success: true,
      message: 'Mensagens marcadas como lidas com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao marcar mensagens como lidas'
    });
  }
});

// ==================== ROTA: EXCLUIR CONVERSA PROPAGANDA ====================
router.delete('/propaganda/:conversaId', verifyToken, async (req, res) => {
  try {
    const { conversaId } = req.params;
    const { produto_id, propaganda_id, contato_id } = req.body;
    const userId = req.user.id;

    // CORREÇÃO: Aceitar ambos os nomes (produto_id ou propaganda_id)
    let produtoIdFinal = produto_id;

    if (!produtoIdFinal && propaganda_id) {
      produtoIdFinal = propaganda_id;
    }

    // Validação do produto_id
    if (!produtoIdFinal) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    // Verificar se produto_id é string ou número
    const produtoIdNum = Number(produtoIdFinal);
    const isProdutoIdValid = !isNaN(produtoIdNum);

    if (!isProdutoIdValid) {
      return res.status(400).json({
        success: false,
        error: 'ID_PRODUTO_INVALIDO',
        message: 'ID do produto inválido'
      });
    }

    // Validação do contato_id
    if (!contato_id) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato inválido'
      });
    }

    const isContatoUuid = isValidUUID(contato_id);

    if (!isContatoUuid) {
      return res.status(400).json({
        success: false,
        error: 'ID_CONTATO_INVALIDO',
        message: 'ID do contato inválido'
      });
    }

    // Atualiza como remetente
    const { data: mensagensAtualizadas, error: updateError } = await supabaseAdmin
      .from('mensagens_propaganda')
      .update({ remetente_deletado: true })
      .eq('produto_id', produtoIdFinal)
      .eq('remetente_id', userId)
      .eq('destinatario_id', contato_id)
      .is('oferta', false)
      .select();

    if (updateError) {
      throw updateError;
    }

    // Atualiza como destinatário
    const { data: mensagensAtualizadas2, error: updateError2 } = await supabaseAdmin
      .from('mensagens_propaganda')
      .update({ destinatario_deletado: true })
      .eq('produto_id', produtoIdFinal)
      .eq('remetente_id', contato_id)
      .eq('destinatario_id', userId)
      .is('oferta', false)
      .select();

    if (updateError2) {
      throw updateError2;
    }

    const totalAtualizadas = (mensagensAtualizadas?.length || 0) + (mensagensAtualizadas2?.length || 0);

    res.json({
      success: true,
      message: 'Conversa excluída com sucesso',
      data: {
        conversaId,
        mensagensAtualizadas: totalAtualizadas
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ERRO_SERVIDOR',
      message: 'Erro ao excluir conversa',
      details: process.env.NODE_ENV === 'development' ? error.message : null
    });
  }
});

module.exports = router;