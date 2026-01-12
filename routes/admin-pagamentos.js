const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');

const router = express.Router();

const verifyAdmin = (req, res, next) => {
  next(); // Implemente autenticação admin
};

// Listar pagamentos pendentes
router.get('/pagamentos-pendentes', verifyAdmin, async (req, res) => {
  try {
    const { data: propagandas, error } = await supabaseAdmin
      .from('produtos_propaganda')
      .select('*')
      .eq('status_pagamento', false)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: {
        propagandas: propagandas || [],
        total_pendente: propagandas?.length || 0,
        total_valor: propagandas?.reduce((sum, p) => sum + parseFloat(p.valor || 0), 0) || 0
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

// Ativar propaganda manualmente
router.post('/ativar-propaganda/:codigo', verifyAdmin, async (req, res) => {
  try {
    const { codigo } = req.params;

    const { data: propaganda, error } = await supabaseAdmin
      .from('produtos_propaganda')
      .select('*')
      .eq('codigo_pagamento', codigo)
      .single();

    if (error) throw error;

    if (propaganda.status) {
      return res.json({ success: true, message: 'Propaganda já está ativa' });
    }

    const visualizacoesPorNivel = { 'basic': 15, 'standard': 20, 'premium': 25 };
    const visualizacoes = visualizacoesPorNivel[propaganda.nivel] || 15;

    const { error: updateError } = await supabaseAdmin
      .from('produtos_propaganda')
      .update({
        status: true,
        status_pagamento: true,
        data_pagamento: new Date().toISOString(),
        data_ativacao: new Date().toISOString(),
        visualizacoes_restantes: visualizacoes
      })
      .eq('codigo_pagamento', codigo);

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: { codigo, visualizacoes, nivel: propaganda.nivel },
      message: `Propaganda ativada com ${visualizacoes} visualizações!`
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao ativar propaganda' });
  }
});

module.exports = router;