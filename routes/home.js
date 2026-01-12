const express = require('express');
const supabase = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

router.get('/categorias', verifyToken, async (req, res) => {
  try {
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('nome')
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

router.get('/produtos/:cidade', verifyToken, async (req, res) => {
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
      .from('produtos')
      .select('*')
      .eq('cidade', cidade)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (categoria && categoria !== 'null' && categoria !== 'undefined') {
      query = query.eq('categoria', categoria);
    }

    const { data: produtos, error } = await query;

    if (error) {
      return res.status(500).json([]);
    }

    if (!produtos || produtos.length === 0) {
      return res.status(200).json([]);
    }

    const { data: favoritos, error: favoritosError } = await supabase
      .from('favoritos')
      .select('produto_id')
      .eq('usuario_id', userId);

    const produtosComFavoritos = produtos.map(produto => ({
      ...produto,
      isFavorito: favoritos?.some(f => f.produto_id === produto.id) || false
    }));

    res.status(200).json(produtosComFavoritos);

  } catch (err) {
    res.status(500).json([]);
  }
});

router.get('/propagandas-premium/:cidade', verifyToken, async (req, res) => {
  try {
    const { cidade } = req.params;
    const userId = req.user.id;

    if (!cidade) {
      return res.status(400).json({
        success: false,
        error: 'Cidade é obrigatória'
      });
    }

    const { data: propagandas, error } = await supabase
      .from('produtos_propaganda')
      .select('*')
      .eq('cidade', cidade)
      .eq('status_pagamento', true)
      .eq('nivel', 'premium')
      .eq('status', true)
      .neq('usuario_id', userId)
      .gt('visualizacoes_restantes', 0)
      .order('created_at', { ascending: false })
      .limit(8);

    if (error) {
      return res.status(200).json([]);
    }

    const propagandasFormatadas = (propagandas || []).map(prop => ({
      ...prop,
      tipo: 'premium',
      destaque: true
    }));

    res.status(200).json(propagandasFormatadas);

  } catch (err) {
    res.status(200).json([]);
  }
});

router.post('/favoritos', verifyToken, async (req, res) => {
  try {
    const { produtoId } = req.body;
    const userId = req.user.id;

    if (!produtoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do produto é obrigatório'
      });
    }

    if (isNaN(Number(produtoId))) {
      return res.status(400).json({
        success: false,
        error: 'ID do produto deve ser um número'
      });
    }

    const { data: produto, error: produtoError } = await supabase
      .from('produtos')
      .select('id, status, nome')
      .eq('id', produtoId)
      .eq('status', 'ativo')
      .single();

    if (produtoError) {
      if (produtoError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Produto não encontrado'
        });
      }
      throw produtoError;
    }

    if (!produto) {
      return res.status(404).json({
        success: false,
        error: 'Produto não encontrado ou inativo'
      });
    }

    const { data: favorito, error: favoritoError } = await supabase
      .from('favoritos')
      .select('id, usuario_id, produto_id')
      .eq('usuario_id', userId)
      .eq('produto_id', produtoId)
      .maybeSingle();

    if (favoritoError) {
      throw favoritoError;
    }

    if (favorito) {
      const { error: deleteError } = await supabase
        .from('favoritos')
        .delete()
        .eq('id', favorito.id);

      if (deleteError) {
        throw deleteError;
      }

      return res.json({
        success: true,
        action: 'removed',
        isFavorito: false,
        produtoId: produtoId
      });
    } else {
      const { data: novoFavorito, error: insertError } = await supabase
        .from('favoritos')
        .insert([
          {
            usuario_id: userId,
            produto_id: produtoId,
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
        produtoId: produtoId,
        favorito: novoFavorito
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerenciar favoritos',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code,
        details: error.details
      } : undefined
    });
  }
});

module.exports = router;