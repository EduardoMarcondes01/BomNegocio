const express = require('express');
const cors = require('cors');
require('dotenv').config();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { verifyToken } = require('./authMiddleware.js');
const lojasRouter = require('./routes/lojas.js');
const authRouter = require('./routes/auth.js');
const loginRouter = require('./routes/login.js');
const homeRouter = require('./routes/home.js');
const produtosSalvosRouter = require('./routes/produtos-salvos.js');
const cadastroRouter = require('./routes/cadastro.js');
const chatRouter = require('./routes/chat.js');
const chatConversaRouter = require('./routes/chat-conversa.js');
const servicosDetalhesRouter = require('./routes/detalhes-servicos.js');
const servicosSalvosRouter = require('./routes/servicos-salvos.js');
const perfilRouter = require('./routes/perfil.js');
const visualisarperfiltelaRouter = require('./routes/visualisar-perfil-tela.js');
const adicionarProdutoRouter = require('./routes/adicionar-produto.js');
const adicionarServicoRouter = require('./routes/adicionar-servico.js');
const adicionarOfertaRouter = require('./routes/adicionar-oferta.js');
const servicosRouter = require('./routes/servicos.js');
const detalhesRouter = require('./routes/detalhes.js');
const visualizarLojaRouter = require('./routes/visualizar-loja.js');
const editarperfilRouter = require('./routes/editar-perfil.js');
const editarsenhaRouter = require('./routes/editar-senha.js');
const meusProdutosRouter = require('./routes/meus_produtos.js');
const criarLojaRouter = require('./routes/criar_loja.js');
const editarLojaRouter = require('./routes/editar-loja.js');
const detalhesPropagandaRouter = require('./routes/detalhes-propaganda.js');
const notif_configRouter = require('./routes/notif_config.js');
const detalhesOfertaRouter = require('./routes/detalhes-oferta.js');

const app = express();

// 1. Configuração de Segurança Básica
app.use(helmet());
app.disable('x-powered-by');

// 2. Limitação de Taxa (Rate Limiting)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 requisições por IP
  message: 'Muitas requisições deste IP, tente novamente mais tarde'
});
app.use(limiter);

// 3. Configuração de CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware para JSON (para todas as rotas exceto cadastro com multipart)
app.use((req, res, next) => {
  if (req.path === '/api/cadastro' && req.method === 'POST') {
    return next();
  }
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  if (req.path === '/api/cadastro' && req.method === 'POST') {
    return next();
  }
  express.urlencoded({ extended: true })(req, res, next);
});

// Rotas principais (com proteção onde necessário)
app.use('/api/auth', loginRouter);
app.use('/api/auth', authRouter);
app.use('/api/data', verifyToken, homeRouter);
app.use('/api/produtos-salvos', verifyToken, produtosSalvosRouter);
app.use('/api/cadastro', cadastroRouter);
app.use('/api/lojas', verifyToken, lojasRouter);
app.use('/api/chat', verifyToken, chatRouter);
app.use('/api/chat-conversa', verifyToken, chatConversaRouter);
app.use('/api/detalhes-servicos', verifyToken, servicosDetalhesRouter);
app.use('/api/servicos-salvos', verifyToken, servicosSalvosRouter);
app.use('/api/perfil', perfilRouter);
app.use('/api/visualisar-perfil-tela', verifyToken, visualisarperfiltelaRouter);
app.use('/api/adicionar-produto', verifyToken, adicionarProdutoRouter);
app.use('/api/adicionar-servico', verifyToken, adicionarServicoRouter);
app.use('/api/adicionar-oferta', verifyToken, adicionarOfertaRouter);
app.use('/api/servicos', verifyToken, servicosRouter);
app.use('/api/detalhes', verifyToken, detalhesRouter);
app.use('/api/visualizar-loja', verifyToken, visualizarLojaRouter);
app.use('/api/editar-perfil', verifyToken, editarperfilRouter);
app.use('/api/editar-senha', verifyToken, editarsenhaRouter);
app.use('/api/meus_produtos', verifyToken, meusProdutosRouter);
app.use('/api/criar_loja', verifyToken, criarLojaRouter);
app.use('/api/editar-loja', verifyToken, editarLojaRouter);
app.use('/api/detalhes-propaganda', verifyToken, detalhesPropagandaRouter);
app.use('/api/notif_config', verifyToken, notif_configRouter);
app.use('/api/detalhes-oferta', verifyToken, detalhesOfertaRouter);

// Rota de saúde
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    routes: {
      perfil: '/api/perfil',
      editarPerfil: '/api/editar-perfil',
      visualizarLoja: '/api/visualizar-loja',
      health: '/api/health'
    }
  });
});

// Middleware para rotas não encontradas
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Rota não encontrada',
    requestedUrl: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Tratamento de Erros Aprimorado
app.use((err, req, res, next) => {
  res.status(500).json({ 
    success: false,
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Ocorreu um erro',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// CONFIGURAÇÃO DE PORTA E VERCEL
// ============================================

const PORT = process.env.PORT || 3000;

// Verificar se está rodando na Vercel
const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  // Executar localmente APENAS
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`📁 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  });
}

// Exportar app PARA AMBAS situações (Vercel E local)
// A Vercel precisa desta exportação, localmente também funciona
console.log(isVercel ? '✅ Configurado para Vercel' : '✅ Configurado para desenvolvimento local');
module.exports = app;

