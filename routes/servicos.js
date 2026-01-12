const express = require('express');
const { supabase } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// Rota para obter categorias de serviços
router.get('/categorias', verifyToken, async (req, res) => {
  try {
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('nome,tipo')
      .eq('tipo', 'servicos')
      .order('nome', { ascending: true });

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao consultar o banco de dados'
      });
    }

    if (!categorias || categorias.length === 0) {
      return res.status(200).json([]);
    }

    const nomesCategorias = categorias.map(c => c.nome);
    res.status(200).json(nomesCategorias);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor ao buscar categorias'
    });
  }
});

// Rota para listar serviços por cidade
router.get('/:cidade', verifyToken, async (req, res) => {
  try {
    const { cidade } = req.params;
    const { categoria } = req.query;
    const userId = req.user.id;

    if (!cidade) {
      return res.status(400).json({
        success: false,
        error: 'Cidade é obrigatória'
      });
    }

    let query = supabase
      .from('servicos')
      .select('*')
      .eq('cidade', cidade)
      .eq('status', 'Ativo')
      .order('created_at', { ascending: false });

    if (categoria && categoria !== 'null' && categoria !== 'undefined') {
      query = query.eq('categoria', categoria);
    }

    const { data: servicos, error } = await query;

    if (error) {
      return res.status(500).json([]);
    }

    if (!servicos || servicos.length === 0) {
      return res.status(200).json([]);
    }

    const { data: favoritos } = await supabase
      .from('favoritos_servicos')
      .select('servico_id')
      .eq('usuario_id', userId);

    const servicosComFavoritos = servicos.map(servico => ({
      ...servico,
      isFavorito: favoritos?.some(f => f.servico_id === servico.id) || false
    }));

    res.status(200).json(servicosComFavoritos);

  } catch (err) {
    res.status(500).json([]);
  }
});

// Rota para gerenciar favoritos de serviços
router.post('/favoritos', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.body;
    const userId = req.user.id;

    if (!servicoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do serviço é obrigatório'
      });
    }

    if (isNaN(Number(servicoId))) {
      return res.status(400).json({
        success: false,
        error: 'ID do serviço deve ser um número'
      });
    }

    const { data: servicos, error: servicoError } = await supabase
      .from('servicos')
      .select('id, nome')
      .eq('id', servicoId)
      .limit(1);

    if (servicoError) {
      throw servicoError;
    }

    if (!servicos || servicos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Serviço não encontrado'
      });
    }

    const { data: favoritos, error: favoritoError } = await supabase
      .from('favoritos_servicos')
      .select('id, usuario_id, servico_id')
      .eq('usuario_id', userId)
      .eq('servico_id', servicoId);

    if (favoritoError) {
      throw favoritoError;
    }

    const favoritoExistente = favoritos && favoritos.length > 0 ? favoritos[0] : null;

    if (favoritoExistente) {
      const { error: deleteError } = await supabase
        .from('favoritos_servicos')
        .delete()
        .eq('id', favoritoExistente.id);

      if (deleteError) {
        throw deleteError;
      }

      return res.json({
        success: true,
        action: 'removed',
        isFavorito: false,
        servicoId: servicoId
      });
    } else {
      const { data: novoFavorito, error: insertError } = await supabase
        .from('favoritos_servicos')
        .insert([
          {
            usuario_id: userId,
            servico_id: servicoId,
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      return res.json({
        success: true,
        action: 'added',
        isFavorito: true,
        servicoId: servicoId,
        favorito: novoFavorito
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerenciar favoritos de serviços'
    });
  }
});

// Rota para listar serviços favoritos do usuário
router.get('/favoritos/listar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: favoritos, error } = await supabase
      .from('favoritos_servicos')
      .select('servico_id')
      .eq('usuario_id', userId);

    if (error) {
      return res.status(500).json([]);
    }

    if (!favoritos || favoritos.length === 0) {
      return res.status(200).json([]);
    }

    const { data: servicos, error: servicosError } = await supabase
      .from('servicos')
      .select('*')
      .in('id', favoritos.map(f => f.servico_id))
      .eq('status', 'ativo');

    if (servicosError) {
      return res.status(500).json([]);
    }

    const servicosComFavoritos = servicos.map(servico => ({
      ...servico,
      isFavorito: true
    }));

    res.status(200).json(servicosComFavoritos);

  } catch (error) {
    res.status(500).json([]);
  }
});

module.exports = router;
