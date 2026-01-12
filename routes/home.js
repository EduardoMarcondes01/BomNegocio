const express = require('express');
const { supabase } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// ⭐ LOG INICIAL ⭐
console.log('✅ home.js carregado - NODE_ENV:', process.env.NODE_ENV || 'production');
console.log('✅ JWT_SECRET configurado?', !!process.env.JWT_SECRET);
console.log('✅ SUPABASE_URL configurado?', !!process.env.SUPABASE_URL);
console.log('✅ SUPABASE_ANON_KEY configurado?', !!process.env.SUPABASE_ANON_KEY);

// ⭐ ROTA: /categorias ⭐
router.get('/categorias', verifyToken, async (req, res) => {
  console.log('📞 [ROTA] /categorias chamada');
  console.log('🔍 Token presente?', !!req.headers.authorization);
  console.log('🔍 req.user definido?', !!req.user);
  console.log('🔍 req.user:', req.user);
  console.log('🔍 req.user.id:', req.user?.id);
  
  try {
    console.log('🔗 Conectando ao Supabase...');
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('nome')
      .order('nome', { ascending: true });

    console.log('📊 Resultado Supabase:');
    console.log('   - Erro?', !!error);
    console.log('   - Mensagem de erro:', error?.message);
    console.log('   - Código de erro:', error?.code);
    console.log('   - Categorias encontradas:', categorias?.length || 0);

    if (error) {
      console.error('❌ Erro Supabase completo:', JSON.stringify(error, null, 2));
      return res.status(500).json({
        success: false,
        error: 'Erro ao consultar o banco de dados',
        details: process.env.NODE_ENV === 'development' ? {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        } : undefined
      });
    }

    if (!categorias || categorias.length === 0) {
      console.log('ℹ️ Nenhuma categoria encontrada no banco');
      return res.status(200).json([]);
    }

    const nomesCategorias = categorias.map(c => c.nome);
    console.log('✅ Sucesso! Categorias retornadas:', nomesCategorias);

    res.status(200).json(nomesCategorias);

  } catch (error) {
    console.error('💥 ERRO CATCH em /categorias:');
    console.error('   - Mensagem:', error.message);
    console.error('   - Stack:', error.stack);
    console.error('   - Tipo:', error.name);
    
    res.status(500).json({
      success: false,
      error: 'Erro interno no servidor ao buscar categorias',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
});

// ⭐ ROTA: /produtos/:cidade ⭐
router.get('/produtos/:cidade', verifyToken, async (req, res) => {
  console.log('📞 [ROTA] /produtos/:cidade chamada');
  console.log('🔍 Parâmetros:', req.params);
  console.log('🔍 Query:', req.query);
  console.log('🔍 Token:', req.headers.authorization?.substring(0, 20) + '...');
  console.log('🔍 req.user.id:', req.user?.id);
  console.log('🔍 req.user completo:', req.user);
  
  try {
    const { cidade } = req.params;
    const { categoria } = req.query;
    const userId = req.user?.id;

    console.log('🔍 Dados extraídos:');
    console.log('   - Cidade:', cidade);
    console.log('   - Categoria:', categoria);
    console.log('   - User ID:', userId);

    if (!cidade) {
      console.log('⚠️ Cidade não fornecida');
      return res.status(400).json({
        success: false,
        error: 'Cidade é obrigatória'
      });
    }

    if (!userId) {
      console.log('⚠️ User ID não encontrado em req.user');
      return res.status(401).json({
        success: false,
        error: 'Usuário não autenticado'
      });
    }

    console.log('🔗 Construindo query Supabase...');
    let query = supabase
      .from('produtos')
      .select('*')
      .eq('cidade', cidade)
      .eq('status', 'ativo')
      .order('created_at', { ascending: false });

    if (categoria && categoria !== 'null' && categoria !== 'undefined') {
      query = query.eq('categoria', categoria);
      console.log('   - Filtro categoria:', categoria);
    }

    console.log('🔗 Executando query produtos...');
    const { data: produtos, error } = await query;

    console.log('📊 Resultado produtos:');
    console.log('   - Erro?', !!error);
    console.log('   - Produtos encontrados:', produtos?.length || 0);

    if (error) {
      console.error('❌ Erro ao buscar produtos:', error);
      return res.status(500).json([]);
    }

    if (!produtos || produtos.length === 0) {
      console.log('ℹ️ Nenhum produto encontrado');
      return res.status(200).json([]);
    }

    console.log('🔗 Buscando favoritos do usuário...');
    const { data: favoritos, error: favoritosError } = await supabase
      .from('favoritos')
      .select('produto_id')
      .eq('usuario_id', userId);

    if (favoritosError) {
      console.error('❌ Erro ao buscar favoritos:', favoritosError);
    }

    console.log('📊 Favoritos encontrados:', favoritos?.length || 0);

    const produtosComFavoritos = produtos.map(produto => ({
      ...produto,
      isFavorito: favoritos?.some(f => f.produto_id === produto.id) || false
    }));

    console.log(`✅ Sucesso! ${produtosComFavoritos.length} produtos retornados`);
    res.status(200).json(produtosComFavoritos);

  } catch (err) {
    console.error('💥 ERRO CATCH em /produtos/:cidade:');
    console.error('   - Mensagem:', err.message);
    console.error('   - Stack:', err.stack);
    console.error('   - Tipo:', err.name);
    
    res.status(500).json([]);
  }
});

// ⭐ ROTA: /propagandas-premium/:cidade ⭐
router.get('/propagandas-premium/:cidade', verifyToken, async (req, res) => {
  console.log('📞 [ROTA] /propagandas-premium/:cidade chamada');
  console.log('🔍 Parâmetros:', req.params);
  console.log('🔍 req.user.id:', req.user?.id);
  
  try {
    const { cidade } = req.params;
    const userId = req.user?.id;

    if (!cidade) {
      console.log('⚠️ Cidade não fornecida');
      return res.status(400).json({
        success: false,
        error: 'Cidade é obrigatória'
      });
    }

    if (!userId) {
      console.log('⚠️ User ID não encontrado');
      return res.status(401).json({
        success: false,
        error: 'Usuário não autenticado'
      });
    }

    console.log('🔗 Buscando propagandas premium...');
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

    console.log('📊 Resultado propagandas:');
    console.log('   - Erro?', !!error);
    console.log('   - Propagandas encontradas:', propagandas?.length || 0);

    if (error) {
      console.error('❌ Erro ao buscar propagandas:', error);
      return res.status(200).json([]);
    }

    const propagandasFormatadas = (propagandas || []).map(prop => ({
      ...prop,
      tipo: 'premium',
      destaque: true
    }));

    console.log(`✅ Sucesso! ${propagandasFormatadas.length} propagandas retornadas`);
    res.status(200).json(propagandasFormatadas);

  } catch (err) {
    console.error('💥 ERRO CATCH em /propagandas-premium/:cidade:');
    console.error('   - Mensagem:', err.message);
    console.error('   - Stack:', err.stack);
    
    res.status(200).json([]);
  }
});

// ⭐ ROTA: /favoritos ⭐
router.post('/favoritos', verifyToken, async (req, res) => {
  console.log('📞 [ROTA] POST /favoritos chamada');
  console.log('🔍 Body:', req.body);
  console.log('🔍 req.user.id:', req.user?.id);
  
  try {
    const { produtoId } = req.body;
    const userId = req.user?.id;

    console.log('🔍 Dados:');
    console.log('   - produtoId:', produtoId);
    console.log('   - userId:', userId);

    if (!userId) {
      console.log('⚠️ User ID não encontrado');
      return res.status(401).json({
        success: false,
        error: 'Usuário não autenticado'
      });
    }

    if (!produtoId) {
      console.log('⚠️ produtoId não fornecido');
      return res.status(400).json({
        success: false,
        error: 'ID do produto é obrigatório'
      });
    }

    if (isNaN(Number(produtoId))) {
      console.log('⚠️ produtoId não é número:', produtoId);
      return res.status(400).json({
        success: false,
        error: 'ID do produto deve ser um número'
      });
    }

    console.log('🔗 Verificando produto no banco...');
    const { data: produto, error: produtoError } = await supabase
      .from('produtos')
      .select('id, status, nome')
      .eq('id', produtoId)
      .eq('status', 'ativo')
      .single();

    if (produtoError) {
      console.error('❌ Erro ao buscar produto:', produtoError);
      if (produtoError.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Produto não encontrado'
        });
      }
      throw produtoError;
    }

    if (!produto) {
      console.log('⚠️ Produto não encontrado ou inativo');
      return res.status(404).json({
        success: false,
        error: 'Produto não encontrado ou inativo'
      });
    }

    console.log('✅ Produto encontrado:', produto.nome);

    console.log('🔗 Verificando se já é favorito...');
    const { data: favorito, error: favoritoError } = await supabase
      .from('favoritos')
      .select('id, usuario_id, produto_id')
      .eq('usuario_id', userId)
      .eq('produto_id', produtoId)
      .maybeSingle();

    if (favoritoError) {
      console.error('❌ Erro ao verificar favorito:', favoritoError);
      throw favoritoError;
    }

    if (favorito) {
      console.log('🔗 Removendo dos favoritos...');
      const { error: deleteError } = await supabase
        .from('favoritos')
        .delete()
        .eq('id', favorito.id);

      if (deleteError) {
        console.error('❌ Erro ao remover favorito:', deleteError);
        throw deleteError;
      }

      console.log('✅ Favorito removido');
      return res.json({
        success: true,
        action: 'removed',
        isFavorito: false,
        produtoId: produtoId
      });
    } else {
      console.log('🔗 Adicionando aos favoritos...');
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
        console.error('❌ Erro ao adicionar favorito:', insertError);
        throw insertError;
      }

      console.log('✅ Favorito adicionado:', novoFavorito.id);
      return res.json({
        success: true,
        action: 'added',
        isFavorito: true,
        produtoId: produtoId,
        favorito: novoFavorito
      });
    }

  } catch (error) {
    console.error('💥 ERRO CATCH em POST /favoritos:');
    console.error('   - Mensagem:', error.message);
    console.error('   - Código:', error.code);
    console.error('   - Detalhes:', error.details);
    console.error('   - Stack:', error.stack);
    
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

console.log('✅ Todas rotas do home.js configuradas');
module.exports = router;
