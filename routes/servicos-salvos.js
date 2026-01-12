const express = require('express');
const supabase = require('../supabaseClient.js');
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

    const { data: favoritos, error: favError } = await supabase
      .from('favoritos_servicos')
      .select('servico_id', { count: 'exact' })
      .eq('usuario_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (favError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar favoritos'
      });
    }

    const servicoIds = favoritos?.map(f => f.servico_id) || [];

    if (servicoIds.length === 0) {
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
      .from('servicos')
      .select('*')
      .in('id', servicoIds)
      .eq('status', 'Ativo')
      .order('created_at', { ascending: false });

    if (userCidade && userCidade !== 'undefined') {
      query = query.eq('cidade', userCidade);
    }

    const { data: servicos, error: servError } = await query;

    if (servError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar serviÃ§os'
      });
    }

    const { count: totalFavoritos, error: countError } = await supabase
      .from('favoritos_servicos')
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
      data: servicos?.map(s => ({ 
        ...s, 
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
      error: 'Erro ao buscar serviÃ§os salvos'
    });
  }
});

router.post('/remove', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.body;
    const userId = req.user.id;

    if (!servicoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do serviÃ§o Ã© obrigatÃ³rio'
      });
    }

    const { error: deleteError } = await supabase
      .from('favoritos_servicos')
      .delete()
      .eq('usuario_id', userId)
      .eq('servico_id', servicoId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao remover serviÃ§o dos favoritos'
      });
    }

    res.json({
      success: true,
      message: 'ServiÃ§o removido dos favoritos com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao remover serviÃ§o dos favoritos'
    });
  }
});

router.delete('/', verifyToken, async (req, res) => {
  try {
    const { servicoId } = req.body;
    const userId = req.user.id;

    if (!servicoId) {
      return res.status(400).json({
        success: false,
        error: 'ID do serviÃ§o Ã© obrigatÃ³rio'
      });
    }

    const { error: deleteError } = await supabase
      .from('favoritos_servicos')
      .delete()
      .eq('usuario_id', userId)
      .eq('servico_id', servicoId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao remover serviÃ§o dos favoritos'
      });
    }

    res.json({
      success: true,
      message: 'ServiÃ§o removido dos favoritos com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao remover serviÃ§o dos favoritos'
    });
  }
});

module.exports = router;
