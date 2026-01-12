const express = require('express');
const { supabase, supabaseAdmin  } = require('../supabaseClient.js');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { verifyToken } = require('../authMiddleware.js');
const QRCode = require('qrcode');

const router = express.Router();

// ConfiguraÃ§Ã£o do Multer para upload de imagens
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10 // mÃ¡ximo 10 arquivos
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

// Planos de propaganda (igual ao do adicionar-produto.js)
const planosPropaganda = {
  'basic': {
    valor: 5.00,
    visualizacoes: 15,
    visualizacoes_restantes: 15,
    descricao: "Sua oferta serÃ¡ relacionada junto com categorias nas telas de visualizaÃ§Ã£o e sÃ³ ira vencer apÃ³s 15 visualizaÃ§Ã£o obtidas",
    cor: "#4CAF50",
    icone: "â­"
  },
  'standard': {
    valor: 8.00,
    visualizacoes: 20,
    visualizacoes_restantes: 20,
    descricao: "Sua oferta serÃ¡ relacionada nas telas de visualizaÃ§Ã£o e sÃ³ ira vencer apÃ³s 20 visualizaÃ§Ã£o obtidas",
    cor: "#2196F3", 
    icone: "â­â­"
  },
  'premium': {
    valor: 10.00,
    visualizacoes: 25,
    visualizacoes_restantes: 25,
    descricao: "Sua oferta serÃ¡ relacionada nas telas de visualizaÃ§Ã£o e FicarÃ¡ em ponto estrategico no home e sÃ³ ira vencer apÃ³s 25 visualizaÃ§Ã£o obtidas",
    cor: "#FF9800",
    icone: "â­â­â­"
  }
};

// FunÃ§Ã£o para gerar QR Code PIX (igual ao adicionar-produto.js)
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

// Endpoint para buscar categorias
router.get('/categorias', async (req, res) => {
  try {
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('nome')
      .order('nome');

    if (error) {
      return res.status(500).json({ 
        success: false, 
        error: 'Erro de conexÃ£o com o banco de dados' 
      });
    }

    const categoriasList = categorias ? categorias.map(cat => cat.nome) : [];

    res.json({ 
      success: true, 
      data: categoriasList 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Endpoint para buscar planos de propaganda
router.get('/planos-propaganda', async (req, res) => {
  try {
    res.json({ 
      success: true, 
      data: planosPropaganda 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Erro ao carregar planos' 
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

    // Verificar tamanho do arquivo
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'Arquivo muito grande. MÃ¡ximo 5MB permitido.'
      });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileName = `oferta-${uuidv4()}${fileExt}`;
    const filePath = `ofertas/${fileName}`;

    // Upload para o Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('produtos')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw new Error('Falha no upload da imagem: ' + uploadError.message);
    }

    // Obter URL pÃºblica
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

// Endpoint para buscar dados do usuÃ¡rio
router.get('/usuario/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ 
        success: false, 
        error: 'ID do usuÃ¡rio invÃ¡lido' 
      });
    }

    const { data: usuario, error } = await supabaseAdmin
      .from('usuarios')
      .select('id, cidade, rua')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.json({
          success: true,
          data: { 
            usuario: {
              id: id,
              cidade: 'Cidade nÃ£o informada',
              rua: 'EndereÃ§o nÃ£o informado',
              telefone: ''
            }
          }
        });
      }
      throw error;
    }

    res.json({ 
      success: true, 
      data: { usuario } 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Erro interno ao buscar dados do usuÃ¡rio' 
    });
  }
});

// Endpoint principal para adicionar oferta (sem propaganda)
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      nome,
      valor,
      desconto,
      condicao,
      categoria,
      descricao,
      cidade,
      rua,
      telefone,
      entrega,
      imagens,
      data_inicio,
      duracao_dias,
      tornar_produto
    } = req.body;

    const usuario_id = req.user.id;

    // ValidaÃ§Ãµes bÃ¡sicas
    if (!nome || !valor || !condicao || !categoria || !descricao || !cidade || !telefone) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos obrigatÃ³rios devem ser preenchidos'
      });
    }

    if (desconto < 0 || desconto > 100) {
      return res.status(400).json({
        success: false,
        error: 'Desconto deve estar entre 0 e 100'
      });
    }

    // Converter data_inicio para formato ISO
    const dataInicioISO = new Date(data_inicio).toISOString();

    // Inserir oferta na tabela ofertas (SEM data_fim - Ã© generated column)
    const { data: novaOferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .insert([{
        nome: nome.trim(),
        valor: parseFloat(valor),
        desconto: parseFloat(desconto),
        condicao,
        categoria,
        descricao: descricao.trim(),
        cidade: cidade.trim(),
        rua: rua?.trim() || null,
        telefone: telefone.trim(),
        entrega: entrega || false,
        imagens: imagens || [],
        usuario_id,
        data_inicio: dataInicioISO,
        duracao_dias: parseInt(duracao_dias),
        ativa: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (ofertaError) {
      throw new Error('Erro ao salvar oferta no banco de dados: ' + ofertaError.message);
    }

    // Se o usuÃ¡rio quiser tornar tambÃ©m um produto
    if (tornar_produto) {
      // Calcular data_fim manualmente para o produto
      const dataFimCalculada = new Date(data_inicio);
      dataFimCalculada.setDate(dataFimCalculada.getDate() + parseInt(duracao_dias));

      const { data: novoProduto, error: produtoError } = await supabaseAdmin
        .from('produtos')
        .insert([{
          nome: nome.trim() + ' (Oferta)',
          valor: parseFloat(valor),
          condicao,
          categoria,
          descricao: descricao.trim() + '\n\nðŸ”¥ OFERTA ESPECIAL ðŸ”¥\nDesconto: ' + desconto + '%\nDe: R$ ' + parseFloat(valor).toFixed(2) + '\nPor: R$ ' + (parseFloat(valor) * (1 - parseFloat(desconto)/100)).toFixed(2) + ' Aproveite !!!!!\nVÃ¡lida atÃ©: ' + dataFimCalculada.toLocaleDateString('pt-BR'),
          cidade: cidade.trim(),
          rua: rua?.trim() || null,
          entrega: entrega || false,
          imagens: imagens || [],
          usuario_id,
          status: 'ativo',
          Servicos: false,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (produtoError) {
        // NÃ£o falha a operaÃ§Ã£o principal se der erro no produto
      }
    }

    res.status(201).json({
      success: true,
      data: {
        oferta: novaOferta
      },
      message: 'Oferta adicionada com sucesso!' + (tornar_produto ? ' E tambÃ©m adicionada como produto!' : '')
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Erro interno ao adicionar oferta: ' + error.message
    });
  }
});

// Endpoint para gerar pagamento manual (com propaganda)
router.post('/gerar-pagamento-manual', verifyToken, async (req, res) => {
  try {
    const { nivel_propaganda, dados_oferta } = req.body;
    const usuario_id = req.user.id;

    // Validar nÃ­vel de propaganda
    const plano = planosPropaganda[nivel_propaganda];
    if (!plano) {
      return res.status(400).json({
        success: false,
        error: 'NÃ­vel de propaganda invÃ¡lido'
      });
    }

    // Validar dados obrigatÃ³rios da oferta
    if (!dados_oferta.nome || !dados_oferta.valor || !dados_oferta.condicao || 
        !dados_oferta.categoria || !dados_oferta.descricao || !dados_oferta.cidade || !dados_oferta.telefone) {
      return res.status(400).json({
        success: false,
        error: 'Todos os campos obrigatÃ³rios da oferta devem ser preenchidos'
      });
    }

    // Converter data_inicio para formato ISO
    const dataInicioISO = new Date(dados_oferta.data_inicio).toISOString();

    // Inserir oferta na tabela ofertas (SEM data_fim - Ã© generated column)
    const { data: novaOferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas')
      .insert([{
        nome: dados_oferta.nome.trim(),
        valor: parseFloat(dados_oferta.valor),
        desconto: parseFloat(dados_oferta.desconto),
        condicao: dados_oferta.condicao,
        categoria: dados_oferta.categoria,
        descricao: dados_oferta.descricao.trim(),
        cidade: dados_oferta.cidade.trim(),
        rua: dados_oferta.rua?.trim() || null,
        telefone: dados_oferta.telefone.trim(),
        entrega: dados_oferta.entrega || false,
        imagens: dados_oferta.imagens || [],
        usuario_id,
        data_inicio: dataInicioISO,
        duracao_dias: parseInt(dados_oferta.duracao_dias),
        ativa: true,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (ofertaError) {
      throw new Error('Erro ao salvar oferta no banco de dados: ' + ofertaError.message);
    }

    // Se o usuÃ¡rio quiser tornar tambÃ©m um produto
    if (dados_oferta.tornar_produto) {
      // Calcular data_fim manualmente para o produto
      const dataFimCalculada = new Date(dados_oferta.data_inicio);
      dataFimCalculada.setDate(dataFimCalculada.getDate() + parseInt(dados_oferta.duracao_dias));

      const { data: novoProduto, error: produtoError } = await supabaseAdmin
        .from('produtos')
        .insert([{
          nome: dados_oferta.nome.trim() + ' (Oferta)',
          valor: parseFloat(dados_oferta.valor),
          condicao: dados_oferta.condicao,
          categoria: dados_oferta.categoria,
          descricao: dados_oferta.descricao.trim() + '\n\nðŸ”¥ OFERTA ESPECIAL ðŸ”¥\nDesconto: ' + dados_oferta.desconto + '%\nDe: R$ ' + parseFloat(dados_oferta.valor).toFixed(2) + '\nPor: R$ ' + (parseFloat(dados_oferta.valor) * (1 - parseFloat(dados_oferta.desconto)/100)).toFixed(2) + ' Aproveite !!!!!\nVÃ¡lida atÃ©: ' + dataFimCalculada.toLocaleDateString('pt-BR'),
          cidade: dados_oferta.cidade.trim(),
          rua: dados_oferta.rua?.trim() || null,
          entrega: dados_oferta.entrega || false,
          imagens: dados_oferta.imagens || [],
          usuario_id,
          status: 'ativo',
          Servicos: false,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (produtoError) {
        // NÃ£o falha a operaÃ§Ã£o principal se der erro no produto
      }
    }

    // Gerar cÃ³digo de pagamento Ãºnico
    const codigoPagamento = `OFERTA${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    // Gerar QR Code PIX
    const qrCodeData = await gerarQRCodePIXManual({
      valor: plano.valor,
      emailPix: "bomnegociocidade@gmail.com"
    });

    // Inserir na tabela de propaganda
    const { data: propaganda, error: propagandaError } = await supabaseAdmin
      .from('produtos_propaganda')
      .insert([{
        nome: dados_oferta.nome,
        valor: parseFloat(dados_oferta.valor),
        condicao: dados_oferta.condicao,
        categoria: dados_oferta.categoria,
        descricao: dados_oferta.descricao,
        cidade: dados_oferta.cidade,
        rua: dados_oferta.rua,
        entrega: dados_oferta.entrega,
        usuario_id: usuario_id,
        imagens: dados_oferta.imagens,
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
        tipo: 'oferta',
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (propagandaError) {
      throw new Error('Erro ao salvar dados de propaganda: ' + propagandaError.message);
    }

    res.json({
      success: true,
      data: {
        oferta: novaOferta,
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
      error: 'Erro ao gerar pagamento: ' + error.message
    });
  }
});

module.exports = router;


