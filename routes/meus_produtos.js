const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// Rota para buscar TODOS os produtos do usuário de TODAS as tabelas
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [
      { data: produtos, error: produtosError },
      { data: servicos, error: servicosError },
      { data: ofertas, error: ofertasError },
      { data: novidades, error: novidadesError },
      { data: propagandas, error: propagandasError }
    ] = await Promise.all([
      supabaseAdmin
        .from('produtos')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false }),
      
      supabaseAdmin
        .from('servicos')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false }),
      
      supabaseAdmin
        .from('ofertas')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false }),
      
      supabaseAdmin
        .from('novidades')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false }),
      
      supabaseAdmin
        .from('produtos_propaganda')
        .select('*')
        .eq('usuario_id', userId)
        .order('created_at', { ascending: false })
    ]);

    const errors = [
      { tipo: 'produtos', error: produtosError },
      { tipo: 'servicos', error: servicosError },
      { tipo: 'ofertas', error: ofertasError },
      { tipo: 'novidades', error: novidadesError },
      { tipo: 'propagandas', error: propagandasError }
    ].filter(item => item.error);

    const todosItens = [];
    
    if (produtos) {
      produtos.forEach(produto => {
        todosItens.push({
          id: produto.id,
          tipo: 'produto',
          tipo_original: 'produto',
          tabela_origem: 'produtos',
          dados: produto,
          created_at: produto.created_at,
          usuario_id: produto.usuario_id
        });
      });
    }

    if (servicos) {
      servicos.forEach(servico => {
        todosItens.push({
          id: servico.id,
          tipo: 'servico',
          tipo_original: 'servico',
          tabela_origem: 'servicos',
          dados: servico,
          created_at: servico.created_at,
          usuario_id: servico.usuario_id
        });
      });
    }

    if (ofertas) {
      ofertas.forEach(oferta => {
        todosItens.push({
          id: oferta.id,
          tipo: 'oferta',
          tipo_original: 'oferta',
          tabela_origem: 'ofertas',
          dados: oferta,
          created_at: oferta.created_at,
          usuario_id: oferta.usuario_id
        });
      });
    }

    if (novidades) {
      novidades.forEach(novidade => {
        todosItens.push({
          id: novidade.id,
          tipo: 'novidade',
          tipo_original: 'novidade',
          tabela_origem: 'novidades',
          dados: novidade,
          created_at: novidade.created_at,
          usuario_id: novidade.usuario_id
        });
      });
    }

    if (propagandas) {
      propagandas.forEach(propaganda => {
        todosItens.push({
          id: propaganda.id,
          tipo: 'propaganda',
          tipo_original: 'propaganda',
          tabela_origem: 'produtos_propaganda',
          dados: propaganda,
          created_at: propaganda.created_at,
          usuario_id: propaganda.usuario_id
        });
      });
    }

    todosItens.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.status(200).json({
      success: true,
      data: todosItens,
      meta: {
        total: todosItens.length,
        por_tipo: {
          produtos: produtos?.length || 0,
          servicos: servicos?.length || 0,
          ofertas: ofertas?.length || 0,
          novidades: novidades?.length || 0,
          propagandas: propagandas?.length || 0
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar dados'
    });
  }
});

module.exports = router;