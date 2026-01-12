const express = require('express');
const { supabase, supabaseAdmin  } = require('../supabaseClient.js');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { verifyToken } = require('../authMiddleware.js');
const QRCode = require('qrcode');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Apenas imagens sÃ£o permitidas (JPEG, JPG, PNG, GIF)'));
  }
});

// Planos de propaganda para serviÃ§os
const planosPropagandaServicos = {
  'basic': {
    valor: 5.00,
    visualizacoes: 15,
    visualizacoes_restantes: 15,
    descricao: "Seu serviÃ§o serÃ¡ relacionado junto com categorias nas telas de visualizaÃ§Ã£o e sÃ³ irÃ¡ vencer apÃ³s 15 visualizaÃ§Ãµes obtidas",
    cor: "#4CAF50",
    icone: "â­"
  },
  'standard': {
    valor: 8.00,
    visualizacoes: 20,
    visualizacoes_restantes: 20,
    descricao: "Seu serviÃ§o serÃ¡ relacionado nas telas de visualizaÃ§Ã£o e sÃ³ irÃ¡ vencer apÃ³s 20 visualizaÃ§Ãµes obtidas",
    cor: "#2196F3",
    icone: "â­â­"
  },
  'premium': {
    valor: 10.00,
    visualizacoes: 25,
    visualizacoes_restantes: 25,
    descricao: "Seu serviÃ§o serÃ¡ relacionado nas telas de visualizaÃ§Ã£o e ficarÃ¡ em ponto estratÃ©gico no home, sÃ³ vencerÃ¡ apÃ³s 25 visualizaÃ§Ãµes",
    cor: "#FF9800",
    icone: "â­â­â­"
  }
};

// Formas de cobranÃ§a por categoria
const formasCobranca = {
  'Fretes': ['Valor por KM', 'A combinar'],
  'Motoboy': ['Valor por KM', 'A combinar'],
  'ServiÃ§os Gerais': ['Metros quadrados', 'Hora', 'A combinar'],
  'Jardinagem': ['Metros quadrados', 'Hora', 'A combinar'],
  'Pedreiro': ['Por dia', 'Por obra', 'A combinar'],
  'Servente de Pedreiro': ['Por dia', 'Por quinzena', 'A combinar']
};

// HorÃ¡rios de trabalho
const horariosTrabalho = [
  'Segunda a sexta 8:00 a 17:00',
  'Segunda a sÃ¡bado 8:00 a 17:00',
  'Segunda a sexta 5:00 a 20:00',
  'Segunda a SÃ¡bado 5:00 a 20:00',
  'Apenas fim de semana 9:00 a 20:00',
  'Apenas fim de semana AtÃ© 22:00',
  'Todos os dias AtÃ© 23:00',
  'A combinar'
];

// Endpoint para buscar categorias
router.get('/categorias', async (req, res) => {
  try {
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('id, nome, tipo')
      .eq('tipo', 'servicos')
      .order('nome');

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar categorias'
      });
    }

    const nomesCategorias = categorias?.map(cat => cat.nome) || [];

    res.json({
      success: true,
      data: nomesCategorias
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar categorias'
    });
  }
});

// Endpoint para buscar subcategorias
router.get('/subcategorias', async (req, res) => {
  try {
    const { categoria } = req.query;

    if (!categoria) {
      return res.status(400).json({
        success: false,
        error: 'Categoria nÃ£o fornecida'
      });
    }

    const { data: subcategorias, error } = await supabase
      .from('subcategoria')
      .select('id, nome, Categoria')
      .eq('Categoria', categoria)
      .order('nome');

    if (error) {
      return res.status(500).json({
        success: false,
        error: 'Erro ao carregar subcategorias'
      });
    }

    res.json({
      success: true,
      data: subcategorias || []
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar subcategorias'
    });
  }
});

// Endpoint para formas de cobranÃ§a
router.get('/formas-cobranca', async (req, res) => {
  try {
    const { categoria } = req.query;

    if (!categoria) {
      return res.status(400).json({
        success: false,
        error: 'Categoria nÃ£o fornecida'
      });
    }

    const formas = formasCobranca[categoria] || ['A combinar'];

    res.json({
      success: true,
      data: formas
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar formas de cobranÃ§a'
    });
  }
});

// Endpoint para horÃ¡rios de trabalho
router.get('/horarios-trabalho', async (req, res) => {
  try {
    res.json({
      success: true,
      data: horariosTrabalho
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar horÃ¡rios'
    });
  }
});

// Endpoint para planos de propaganda
router.get('/planos-propaganda', async (req, res) => {
  try {
    res.json({
      success: true,
      data: planosPropagandaServicos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao carregar planos'
    });
  }
});

// Endpoint para upload de imagem
router.post('/upload', upload.single('imagem'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Nenhuma imagem fornecida'
      });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileName = `servico-${uuidv4()}${fileExt}`;
    const filePath = `servicos/${fileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('produtos')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw new Error('Falha no upload da imagem');
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('produtos')
      .getPublicUrl(filePath);

    res.json({
      success: true,
      data: {
        url: publicUrl,
        filename: fileName
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao fazer upload da imagem'
    });
  }
});

// Gerar QR Code PIX
const gerarQRCodePIXManual = async (dadosPagamento) => {
  try {
    const { valor, emailPix = "bomnegociocidade@gmail.com", nomeRecebedor = "Eduardo D. Marcondes" } = dadosPagamento;

    const valorFormatado = parseFloat(valor).toFixed(2);

    const payload = [
      { id: '00', value: '01' },
      {
        id: '26',
        value: [
          { id: '00', value: 'br.gov.bcb.pix' },
          { id: '01', value: emailPix }
        ].map(field => field.id + String(field.value.length).padStart(2, '0') + field.value).join('')
      },
      { id: '52', value: '0000' },
      { id: '53', value: '986' },
      { id: '54', value: valorFormatado },
      { id: '58', value: 'BR' },
      { id: '59', value: nomeRecebedor },
      { id: '60', value: 'Sao Paulo' },
      {
        id: '62',
        value: [
          { id: '05', value: '***' }
        ].map(field => field.id + String(field.value.length).padStart(2, '0') + field.value).join('')
      }
    ];

    let payloadSemCRC = payload.map(field =>
      field.id + String(field.value.length).padStart(2, '0') + field.value
    ).join('');

    function calcularCRC16(payload) {
      let crc = 0xFFFF;
      for (let i = 0; i < payload.length; i++) {
        crc ^= payload.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
          if (crc & 0x8000) {
            crc = (crc << 1) ^ 0x1021;
          } else {
            crc = crc << 1;
          }
        }
      }
      return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    }

    const crc = calcularCRC16(payloadSemCRC + '6304');
    const payloadCompleto = payloadSemCRC + '6304' + crc;

    const qrCodeDataURL = await QRCode.toDataURL(payloadCompleto, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    return {
      qrcode: qrCodeDataURL,
      codigo_copia_cola: payloadCompleto,
      email_pix: emailPix,
      valor: parseFloat(valor)
    };

  } catch (error) {
    throw new Error('Falha ao gerar QR Code PIX');
  }
};

// Endpoint principal para adicionar serviÃ§o
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      nome,
      categoria,
      subcategoria,
      tipo_valor,
      valor,
      descricao,
      cidade,
      rua,
      telefone,
      horario_trabalho,
      imagens
    } = req.body;

    const usuario_id = req.user.id;

    // ValidaÃ§Ãµes
    if (!nome || !categoria || !subcategoria || !tipo_valor || !descricao || !cidade || !telefone || !horario_trabalho) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos obrigatÃ³rios devem ser preenchidos'
      });
    }

    if (!imagens || imagens.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Pelo menos uma imagem Ã© obrigatÃ³ria'
      });
    }

    // 1. PRIMEIRO: Inserir na tabela produtos (OBRIGATÃ“RIA)
    const { data: novoProduto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .insert([{
        nome: nome.trim(),
        valor: tipo_valor !== 'A combinar' ? parseFloat(valor) : 0,
        condicao: 'Novo',
        categoria: categoria,
        descricao: descricao.trim(),
        cidade: cidade.trim(),
        rua: rua?.trim() || null,
        entrega: false,
        imagens: imagens || [],
        usuario_id: usuario_id,
        status: 'ativo',
        Servicos: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (produtoError) {
      throw new Error('Erro ao salvar produto base no banco de dados');
    }

    // 2. DEPOIS: Inserir na tabela servicos com o produto_id
    const insertData = {
      produto_id: novoProduto.id,
      nome: nome.trim(),
      categoria,
      subcategoria,
      tipo_valor,
      valor: tipo_valor !== 'A combinar' ? parseFloat(valor) : 0,
      descricao: descricao.trim(),
      cidade: cidade.trim(),
      rua: rua?.trim() || null,
      telefone: telefone.trim(),
      horario_trabalho,
      usuario_id,
      imagens: imagens || [],
      status: 'Ativo',
      curtidas: 0,
      created_at: new Date().toISOString()
    };

    // Inserir serviÃ§o
    const { data: novoServico, error: servicoError } = await supabaseAdmin
      .from('servicos')
      .insert([insertData])
      .select()
      .single();

    if (servicoError) {
      // Rollback: deletar o produto inserido em caso de erro no serviÃ§o
      await supabaseAdmin
        .from('produtos')
        .delete()
        .eq('id', novoProduto.id);

      throw new Error('Erro ao salvar serviÃ§o no banco de dados');
    }

    res.status(201).json({
      success: true,
      data: {
        produto: novoProduto,
        servico: novoServico
      },
      message: 'ServiÃ§o adicionado com sucesso!'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao adicionar serviÃ§o'
    });
  }
});

// Endpoint para gerar pagamento de propaganda
router.post('/gerar-pagamento-manual', verifyToken, async (req, res) => {
  try {
    const { nivel_propaganda, dados_servico } = req.body;
    const usuario_id = req.user.id;

    const plano = planosPropagandaServicos[nivel_propaganda];
    if (!plano) {
      return res.status(400).json({
        success: false,
        error: 'NÃ­vel de propaganda invÃ¡lido'
      });
    }

    // 1. PRIMEIRO: Inserir na tabela produtos (OBRIGATÃ“RIA)
    const { data: novoProduto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .insert([{
        nome: dados_servico.nome.trim(),
        valor: dados_servico.tipo_valor !== 'A combinar' ? parseFloat(dados_servico.valor) : 0,
        condicao: 'Novo',
        categoria: dados_servico.categoria,
        descricao: dados_servico.descricao.trim(),
        cidade: dados_servico.cidade.trim(),
        rua: dados_servico.rua?.trim() || null,
        entrega: false,
        imagens: dados_servico.imagens || [],
        usuario_id: usuario_id,
        status: 'ativo',
        Servicos: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (produtoError) {
      throw new Error('Erro ao salvar produto base no banco de dados');
    }

    // 2. DEPOIS: Inserir na tabela servicos com o produto_id
    const insertData = {
      produto_id: novoProduto.id,
      nome: dados_servico.nome.trim(),
      categoria: dados_servico.categoria,
      subcategoria: dados_servico.subcategoria,
      tipo_valor: dados_servico.tipo_valor,
      valor: dados_servico.tipo_valor !== 'A combinar' ? parseFloat(dados_servico.valor) : 0,
      descricao: dados_servico.descricao.trim(),
      cidade: dados_servico.cidade.trim(),
      rua: dados_servico.rua?.trim() || null,
      telefone: dados_servico.telefone.trim(),
      horario_trabalho: dados_servico.horario_trabalho,
      usuario_id: usuario_id,
      imagens: dados_servico.imagens || [],
      status: 'Ativo',
      curtidas: 0,
      created_at: new Date().toISOString()
    };

    const { data: novoServico, error: servicoError } = await supabaseAdmin
      .from('servicos')
      .insert([insertData])
      .select()
      .single();

    if (servicoError) {
      // Rollback: deletar o produto inserido em caso de erro no serviÃ§o
      await supabaseAdmin
        .from('produtos')
        .delete()
        .eq('id', novoProduto.id);

      throw new Error('Erro ao salvar serviÃ§o no banco de dados');
    }

    // Gerar cÃ³digo de pagamento
    const codigoPagamento = `SERV${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    const qrCodeData = await gerarQRCodePIXManual({
      valor: plano.valor,
      emailPix: "bomnegociocidade@gmail.com"
    });

    // 3. Inserir na tabela de propaganda de serviÃ§os
    const { data: propaganda, error: propagandaError } = await supabaseAdmin
      .from('produtos_propaganda')
      .insert([{
        nome: dados_servico.nome,
        categoria: dados_servico.categoria,
        condicao: 'Novo',
        valor: dados_servico.tipo_valor !== 'A combinar' ? parseFloat(dados_servico.valor) : 0,
        descricao: dados_servico.descricao,
        cidade: dados_servico.cidade,
        rua: dados_servico.rua,
        usuario_id: usuario_id,
        imagens: dados_servico.imagens,
        nivel: nivel_propaganda,
        status: true,
        date_expired: null,
        codigo_pagamento: codigoPagamento,
        qrcode_data: qrCodeData.qrcode,
        status_pagamento: false,
        visualizacoes_restantes: plano.visualizacoes_restantes,
        data_pagamento: null,
        metodo_pagamento: null,
        transacao_id: null,
        data_ativacao: null,
        data_desativacao: null,
        tipo: 'servico',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (propagandaError) {
      // Rollback: deletar produto e serviÃ§o em caso de erro na propaganda
      await supabaseAdmin
        .from('servicos')
        .delete()
        .eq('id', novoServico.id);

      await supabaseAdmin
        .from('produtos')
        .delete()
        .eq('id', novoProduto.id);

      throw new Error('Erro ao salvar propaganda do serviÃ§o');
    }

    res.json({
      success: true,
      data: {
        produto: novoProduto,
        servico: novoServico,
        propaganda: {
          id: propaganda.id,
          codigo_pagamento: codigoPagamento
        },
        pagamento: {
          qrcode: qrCodeData.qrcode,
          codigo_copia_cola: qrCodeData.codigo_copia_cola,
          email_pix: qrCodeData.email_pix,
          valor: plano.valor,
          visualizacoes: plano.visualizacoes,
          codigo_pagamento: codigoPagamento,
          data_expiracao: new Date(Date.now() + 1 * 60 * 60 * 1000)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro ao gerar pagamento'
    });
  }
});

module.exports = router;


