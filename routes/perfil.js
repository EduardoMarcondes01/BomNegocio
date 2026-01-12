const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const profileLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Muitas requisições para o perfil. Tente novamente mais tarde.',
  skipSuccessfulRequests: false
});

router.get('/favoritos-count/:userId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: produtosUsuario, error: produtosError } = await supabaseAdmin
      .from('produtos')
      .select('id')
      .eq('usuario_id', userId)
      .eq('status', 'ativo');

    if (produtosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar produtos do usuário'
      });
    }

    if (!produtosUsuario || produtosUsuario.length === 0) {
      return res.status(200).json({
        success: true,
        data: { total: 0 }
      });
    }

    const produtoIds = produtosUsuario.map(p => p.id);

    const { count, error: favoritosError } = await supabaseAdmin
      .from('favoritos')
      .select('*', { count: 'exact', head: true })
      .in('produto_id', produtoIds);

    if (favoritosError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao contar favoritos'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        total: count || 0
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao contar favoritos do usuário'
    });
  }
});

router.delete('/produtos/:produtoId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { produtoId } = req.params;
    const userId = req.user.id;

    const { data: produto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .select('usuario_id')
      .eq('id', produtoId)
      .single();

    if (produtoError || !produto) {
      return res.status(404).json({
        success: false,
        error: 'Produto não encontrado'
      });
    }

    if (produto.usuario_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Permissão negada para deletar este produto'
      });
    }

    const { data: servicoExistente } = await supabaseAdmin
      .from('servicos')
      .select('id')
      .eq('produto_id', produtoId)
      .single();

    const existeNaTabelaServicos = !!servicoExistente;

    if (existeNaTabelaServicos) {
      await supabaseAdmin
        .from('servicos')
        .delete()
        .eq('produto_id', produtoId);
    }

    await supabaseAdmin
      .from('favoritos')
      .delete()
      .eq('produto_id', produtoId);

    const { error: produtoDeleteError } = await supabaseAdmin
      .from('produtos')
      .delete()
      .eq('id', produtoId);

    if (produtoDeleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao deletar produto'
      });
    }

    res.status(200).json({
      success: true,
      message: existeNaTabelaServicos ? 'Serviço deletado com sucesso' : 'Produto deletado com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao deletar produto'
    });
  }
});

router.delete('/ofertas/:ofertaId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { ofertaId } = req.params;
    const userId = req.user.id;

    const { data: oferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .select('usuario_id')
      .eq('id', ofertaId)
      .single();

    if (ofertaError || !oferta) {
      return res.status(404).json({
        success: false,
        error: 'Oferta não encontrada'
      });
    }

    if (oferta.usuario_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Permissão negada para deletar esta oferta'
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('ofertas')
      .delete()
      .eq('id', ofertaId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao deletar oferta'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Oferta deletada com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao deletar oferta'
    });
  }
});

router.delete('/novidades/:novidadeId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { novidadeId } = req.params;
    const userId = req.user.id;

    const { data: novidade, error: novidadeError } = await supabaseAdmin
      .from('novidades')
      .select('usuario_id')
      .eq('id', novidadeId)
      .single();

    if (novidadeError || !novidade) {
      return res.status(404).json({
        success: false,
        error: 'Novidade não encontrada'
      });
    }

    if (novidade.usuario_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Permissão negada para deletar esta novidade'
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('novidades')
      .delete()
      .eq('id', novidadeId);

    if (deleteError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao deletar novidade'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Novidade deletada com sucesso'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao deletar novidade'
    });
  }
});

router.get('/:userId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, pageSize = 10 } = req.query;

    const { data: usuario, error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .select('id, nome, sobrenome, cidade, bairro, imagem_url, telefone')
      .eq('id', userId)
      .single();

    if (usuarioError || !usuario) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    const isMeuPerfil = userId === req.user.id;

    const [seguidoresResult, seguindoResult, isFollowingResult] = await Promise.all([
      supabaseAdmin.from('Seguidores')
        .select('*', { count: 'exact', head: true })
        .eq('perfil_seguido_id', userId),
      supabaseAdmin.from('Seguidores')
        .select('*', { count: 'exact', head: true })
        .eq('usuario_id', userId),
      isMeuPerfil ? Promise.resolve({ data: null }) :
        supabaseAdmin.from('Seguidores')
          .select('id')
          .eq('usuario_id', req.user.id)
          .eq('perfil_seguido_id', userId)
          .single()
    ]);

    const seguidoresCount = seguidoresResult.error ? 0 : (seguidoresResult.count || 0);
    const seguindoCount = seguindoResult.error ? 0 : (seguindoResult.count || 0);
    const isFollowing = !isMeuPerfil && isFollowingResult.data !== null;

    const produtosPage = parseInt(page);
    const produtosPerPage = parseInt(pageSize);
    const produtosOffset = (produtosPage - 1) * produtosPerPage;

    const produtosResult = await supabaseAdmin
      .from('produtos')
      .select('id, nome, valor, imagens, categoria, descricao, condicao, entrega, bairro', {
        count: 'exact'
      })
      .eq('usuario_id', userId)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false })
      .range(produtosOffset, produtosOffset + produtosPerPage - 1);

    const produtos = produtosResult.data || [];
    const totalProdutos = produtosResult.count || 0;

    const { data: ofertas } = await supabaseAdmin
      .from('ofertas')
      .select('*')
      .eq('usuario_id', userId)
      .eq('ativa', true)
      .gte('data_fim', new Date().toISOString())
      .order('data_fim', { ascending: true });

    const { data: novidades } = await supabaseAdmin
      .from('novidades')
      .select('*')
      .eq('usuario_id', userId)
      .order('data_publicacao', { ascending: false })
      .limit(8);

    const novidadesFormatadas = (novidades || []).map(novidade => ({
      id: novidade.id,
      produtoId: novidade.produto_id,
      titulo: novidade.nome,
      valor: novidade.valor,
      categoria: novidade.categoria,
      imagem_url: novidade.imagens && novidade.imagens.length > 0
        ? novidade.imagens[0]
        : null,
      data_publicacao: novidade.data_publicacao,
      descricao: novidade.descricao,
      usuario_id: novidade.usuario_id
    }));

    const hasMoreProducts = produtosOffset + produtosPerPage < totalProdutos;

    res.status(200).json({
      success: true,
      data: {
        usuario: usuario,
        produtos: produtos,
        ofertas: ofertas || [],
        novidades: novidadesFormatadas,
        seguidoresCount: seguidoresCount,
        seguindoCount: seguindoCount,
        isFollowing: isFollowing,
        hasMore: hasMoreProducts,
        totalProdutos: totalProdutos,
        hasMoreNovidades: false
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar perfil'
    });
  }
});

router.get('/produtos-favoritos-contagem-otimizado/:userId', profileLimiter, verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: produtosComContagem, error: queryError } = await supabaseAdmin
      .from('produtos')
      .select(`
        id,
        nome,
        categoria,
        imagens,
        valor,
        status,
        created_at,
        favoritos:favoritos(count)
      `)
      .eq('usuario_id', userId)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (queryError) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao buscar dados dos produtos'
      });
    }

    if (!produtosComContagem || produtosComContagem.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          produtos: [],
          totalProdutos: 0,
          totalFavoritos: 0
        }
      });
    }

    const produtosProcessados = produtosComContagem.map(produto => {
      let favoritosCount = 0;

      if (produto.favoritos && Array.isArray(produto.favoritos)) {
        favoritosCount = produto.favoritos[0]?.count || 0;
      } else if (produto.favoritos && typeof produto.favoritos === 'object') {
        favoritosCount = produto.favoritos.count || 0;
      }

      let imagemUrl = '';
      if (produto.imagens && Array.isArray(produto.imagens) && produto.imagens.length > 0) {
        imagemUrl = produto.imagens[0];
      }

      return {
        id: produto.id,
        nome: produto.nome,
        categoria: produto.categoria,
        imagem_url: imagemUrl,
        valor: produto.valor,
        status: produto.status,
        created_at: produto.created_at,
        favoritos_count: favoritosCount
      };
    });

    const produtosOrdenados = produtosProcessados.sort((a, b) => b.favoritos_count - a.favoritos_count);

    const totalProdutos = produtosOrdenados.length;
    const totalFavoritos = produtosOrdenados.reduce((total, produto) => total + produto.favoritos_count, 0);

    res.status(200).json({
      success: true,
      data: {
        produtos: produtosOrdenados,
        totalProdutos,
        totalFavoritos,
        resumo: {
          maisFavoritado: produtosOrdenados.length > 0 ? {
            id: produtosOrdenados[0].id,
            nome: produtosOrdenados[0].nome,
            favoritos_count: produtosOrdenados[0].favoritos_count
          } : null,
          produtosComFavoritos: produtosOrdenados.filter(p => p.favoritos_count > 0).length,
          produtosSemFavoritos: produtosOrdenados.filter(p => p.favoritos_count === 0).length
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao processar dados'
    });
  }
});

module.exports = router;