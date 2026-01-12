const express = require('express');
const { supabase } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = req.user.id;
    const userCidade = req.user.cidade;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const offset = (pageNum - 1) * limitNum;
    
    const { data: favoritos, error: favError, count } = await supabase
      .from('favoritos')
      .select('produto_id', { count: 'exact' })
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (favError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar favoritos'
      });
    }

    const produtoIds = favoritos?.map(f => f.produto_id) || [];

    if (produtoIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        meta: { 
          total: 0, 
          page: pageNum, 
          limit: limitNum, 
          hasNext: false 
        }
      });
    }

    let query = supabase
      .from('produtos')
      .select('*')
      .in('id', produtoIds)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (userCidade) {
      query = query.eq('cidade', userCidade);
    }

    const { data: produtos, error: prodError } = await query;

    if (prodError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar produtos'
      });
    }

    const { count: totalFavoritos, error: countError } = await supabase
      .from('favoritos')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', userId);

    if (countError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao contar favoritos'
      });
    }

    const hasNext = totalFavoritos > offset + limitNum;

    res.json({
      success: true,
      data: produtos?.map(p => ({ 
        ...p, 
        isFavorito: true
      })) || [],
      meta: {
        total: totalFavoritos || 0,
        page: pageNum,
        limit: limitNum,
        hasNext: hasNext
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao buscar produtos salvos'
    });
  }
});

router.post('/remove', verifyToken, async (req, res) => {
  try {
    const { produtoId } = req.body;
    const userId = req.user.id;

    if (!produtoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do produto Ã© obrigatÃ³rio'
      });
    }

    const { error: deleteError } = await supabase
      .from('favoritos')
      .delete()
      .eq('usuario_id', userId)
      .eq('produto_id', produtoId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao remover produto dos favoritos'
      });
    }

    res.json({
      success: true,
      message: 'Produto removido dos favoritos com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao remover produto dos favoritos'
    });
  }
});

router.delete('/', verifyToken, async (req, res) => {
  try {
    const { produtoId } = req.body;
    const userId = req.user.id;

    if (!produtoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do produto Ã© obrigatÃ³rio'
      });
    }

    const { error: deleteError } = await supabase
      .from('favoritos')
      .delete()
      .eq('usuario_id', userId)
      .eq('produto_id', produtoId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao remover produto dos favoritos'
      });
    }

    res.json({
      success: true,
      message: 'Produto removido dos favoritos com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao remover produto dos favoritos'
    });
  }
});

module.exports = router;
