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
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    mimetype && extname ? cb(null, true) : cb(new Error('Apenas imagens sÃ£o permitidas'));
  }
});

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

const planosPropaganda = {
  'basic': {
    valor: 5.00,
    visualizacoes: 15,
    visualizacoes_restantes: 15,
    descricao: "Seu produto serÃ¡ relacionado junto com categorias nas telas de visualizaÃ§Ã£o dos produtos e sÃ³ ira vencer apÃ³s 15 visualizaÃ§Ã£o obtidas",
    cor: "#4CAF50",
    icone: "â­"
  },
  'standard': {
    valor: 8.00,
    visualizacoes: 20,
    visualizacoes_restantes: 20,
    descricao: "Seu produto serÃ¡ relacionado nas telas de visualizaÃ§Ã£o dos produtos e sÃ³ ira vencer apÃ³s 20 visualizaÃ§Ã£o obtidas",
    cor: "#2196F3", 
    icone: "â­â­"
  },
  'premium': {
    valor: 10.00,
    visualizacoes: 25,
    visualizacoes_restantes: 25,
    descricao: "Seu produto serÃ¡ relacionado nas telas de visualizaÃ§Ã£o dos produtos e FicarÃ¡ em ponto estrategico no home e sÃ³ ira vencer apÃ³s 25 visualizaÃ§Ã£o obtidas",
    cor: "#FF9800",
    icone: "â­â­â­"
  }
};

router.get('/categorias', async (req, res) => {
  try {
    const { data: categorias, error } = await supabase
      .from('categorias')
      .select('nome')
      .order('nome');

    if (error) throw error;
    const nomesCategorias = categorias.map(cat => cat.nome);

    res.json({ success: true, data: nomesCategorias });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao carregar categorias' });
  }
});

router.get('/usuario/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID do usuÃ¡rio invÃ¡lido' });
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
              rua: 'EndereÃ§o nÃ£o informado'
            }
          }
        });
      }
      throw error;
    }

    res.json({ success: true, data: { usuario } });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro interno ao buscar dados do usuÃ¡rio' });
  }
});

router.post('/upload', upload.single('imagem'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Nenhuma imagem fornecida' });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Arquivo muito grande. MÃ¡ximo 5MB permitido.' });
    }

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const fileName = `produto-${uuidv4()}${fileExt}`;
    const filePath = `produtos/${fileName}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('produtos')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('produtos')
      .getPublicUrl(filePath);

    res.json({ success: true, data: { url: publicUrl, filename: fileName } });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao fazer upload da imagem' });
  }
});

router.get('/planos-propaganda', async (req, res) => {
  try {
    res.json({ success: true, data: planosPropaganda });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro ao carregar planos' });
  }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { nome, valor, condicao, categoria, descricao, cidade, rua, entrega, imagens, isNovidade } = req.body;
    const usuario_id = req.user.id;

    if (!nome || !valor || !condicao || !categoria || !descricao || !cidade) {
      return res.status(400).json({ success: false, error: 'Todos os campos obrigatÃ³rios devem ser preenchidos' });
    }

    const { data: novoProduto, error } = await supabaseAdmin
      .from('produtos')
      .insert([{
        nome: nome.trim(),
        valor: parseFloat(valor),
        condicao,
        categoria,
        descricao: descricao.trim(),
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

    if (error) throw error;

    if (isNovidade) {
      await supabaseAdmin
        .from('novidades')
        .insert([{
          produto_id: novoProduto.id,
          nome: nome.trim(),
          valor: parseFloat(valor),
          condicao,
          categoria,
          descricao: descricao.trim(),
          cidade: cidade.trim(),
          rua: rua?.trim() || null,
          entrega: entrega || false,
          usuario_id,
          imagens: imagens || [],
          data_publicacao: new Date(),
          destaque: false,
          visualizacoes: 0,
          created_at: new Date().toISOString()
        }]);
    }

    res.status(201).json({
      success: true,
      data: { produto: novoProduto },
      message: 'Produto adicionado com sucesso!' + (isNovidade ? ' E adicionado Ã s novidades!' : '')
    });

  } catch (error) {
    res.status(500).json({ success: false, error: 'Erro interno ao adicionar produto' });
  }
});

router.post('/gerar-pagamento-manual', verifyToken, async (req, res) => {
  try {
    const { nivel_propaganda, dados_produto } = req.body;
    const usuario_id = req.user.id;

    const plano = planosPropaganda[nivel_propaganda];
    if (!plano) {
      return res.status(400).json({ success: false, error: 'NÃ­vel de propaganda invÃ¡lido' });
    }

    const { data: novoProduto, error: produtoError } = await supabaseAdmin
      .from('produtos')
      .insert([{
        nome: dados_produto.nome.trim(),
        valor: parseFloat(dados_produto.valor),
        condicao: dados_produto.condicao,
        categoria: dados_produto.categoria,
        descricao: dados_produto.descricao.trim(),
        cidade: dados_produto.cidade.trim(),
        rua: dados_produto.rua?.trim() || null,
        entrega: dados_produto.entrega || false,
        imagens: dados_produto.imagens || [],
        usuario_id,
        status: 'ativo',
        Servicos: false,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (produtoError) throw produtoError;

    if (dados_produto.isNovidade) {
      await supabaseAdmin
        .from('novidades')
        .insert([{
          produto_id: novoProduto.id,
          nome: dados_produto.nome.trim(),
          valor: parseFloat(dados_produto.valor),
          condicao: dados_produto.condicao,
          categoria: dados_produto.categoria,
          descricao: dados_produto.descricao.trim(),
          cidade: dados_produto.cidade.trim(),
          rua: dados_produto.rua?.trim() || null,
          entrega: dados_produto.entrega || false,
          usuario_id,
          imagens: dados_produto.imagens || [],
          data_publicacao: new Date(),
          destaque: false,
          visualizacoes: 0,
          created_at: new Date().toISOString()
        }]);
    }

    const codigoPagamento = `PROP${Date.now()}${Math.random().toString(36).substr(2, 5)}`.toUpperCase();

    const qrCodeData = await gerarQRCodePIXManual({
      valor: plano.valor,
      emailPix: "bomnegociocidade@gmail.com"
    });

    const { data: propaganda, error: propagandaError } = await supabaseAdmin
      .from('produtos_propaganda')
      .insert([{
        nome: dados_produto.nome,
        valor: parseFloat(dados_produto.valor),
        condicao: dados_produto.condicao,
        categoria: dados_produto.categoria,
        descricao: dados_produto.descricao,
        cidade: dados_produto.cidade,
        rua: dados_produto.rua,
        entrega: dados_produto.entrega,
        usuario_id: usuario_id,
        imagens: dados_produto.imagens,
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
        tipo: 'produtos',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (propagandaError) throw propagandaError;

    res.json({
      success: true,
      data: {
        produto: novoProduto,
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
    res.status(500).json({ success: false, error: 'Erro ao gerar pagamento' });
  }
});

module.exports = router;

