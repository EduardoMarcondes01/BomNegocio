const express = require('express');
const supabase = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// Rota para listar lojas
router.get('/:cidade?', verifyToken, async (req, res) => {
    try {
        const { cidade } = req.params;
        const userId = req.user.id;

        if (!cidade) {
            return res.status(400).json({
                success: false,
                error: 'Cidade é obrigatória'
            });
        }

        let query = supabase
            .from('loja')
            .select(`
                id,
                usuario_id,
                nome,
                descricao,
                telefone,
                email,
                cep,
                estado,
                cidade,
                bairro,
                rua,
                numero,
                complemento,
                horario_funcionamento,
                categoria,
                website,
                whatsapp,
                instagram,
                facebook,
                url_imagem,
                ativa,
                data_criacao,
                usuarios:usuario_id (id, nome, sobrenome, imagem_url)
            `, { count: 'exact' })
            .eq('cidade', cidade)
            .eq('ativa', true)
            .order('nome', { ascending: true });

        const { data: lojas, error, count } = await query;

        if (error) {
            return res.status(500).json({
                success: false,
                error: 'Erro ao buscar lojas',
                details: error.message
            });
        }

        const { data: seguindo } = await supabase
            .from('Seguidores')
            .select('perfil_seguido_id')
            .eq('usuario_id', userId);

        const lojasFormatadas = lojas.map(loja => ({
            id: loja.usuario_id,
            loja_id: loja.id,
            nome: loja.nome,
            descricao: loja.descricao,
            telefone: loja.telefone,
            email: loja.email,
            cidade: loja.cidade,
            bairro: loja.bairro,
            rua: loja.rua,
            numero: loja.numero,
            complemento: loja.complemento,
            horario_funcionamento: loja.horario_funcionamento,
            categoria: loja.categoria,
            website: loja.website,
            whatsapp: loja.whatsapp,
            instagram: loja.instagram,
            facebook: loja.facebook,
            imagem_url: loja.url_imagem,
            ativa: loja.ativa,
            data_criacao: loja.data_criacao,
            usuario_nome: loja.usuarios?.nome,
            usuario_sobrenome: loja.usuarios?.sobrenome,
            usuario_imagem_url: loja.usuarios?.imagem_url
        }));

        const lojasComSeguimento = lojasFormatadas.map(loja => ({
            ...loja,
            isFollowing: seguindo?.some(s => s.perfil_seguido_id === loja.id) || false
        }));

        res.status(200).json(lojasComSeguimento);

    } catch (err) {
        res.status(500).json({
            success: false,
            error: 'Erro interno no servidor'
        });
    }
});

// Rota para seguir/deseguir loja
router.post('/seguir', verifyToken, async (req, res) => {
    try {
        const { vendedorId, acao } = req.body;
        const userId = req.user.id;

        if (!vendedorId) {
            return res.status(400).json({
                success: false,
                error: 'ID do vendedor é obrigatório'
            });
        }

        if (acao === 'seguir') {
            const { data: novoSeguidor, error } = await supabase
                .from('Seguidores')
                .insert([{
                    usuario_id: userId,
                    perfil_seguido_id: vendedorId,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) {
                return res.status(500).json({
                    success: false,
                    error: 'Erro ao seguir vendedor'
                });
            }

            return res.json({
                success: true,
                action: 'seguir',
                isFollowing: true,
                vendedorId: vendedorId
            });

        } else if (acao === 'deseguir') {
            const { error } = await supabase
                .from('Seguidores')
                .delete()
                .eq('usuario_id', userId)
                .eq('perfil_seguido_id', vendedorId);

            if (error) {
                return res.status(500).json({
                    success: false,
                    error: 'Erro ao deixar de seguir vendedor'
                });
            }

            return res.json({
                success: true,
                action: 'deseguir',
                isFollowing: false,
                vendedorId: vendedorId
            });

        } else {
            return res.status(400).json({
                success: false,
                error: 'Ação inválida'
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro ao gerenciar seguidores'
        });
    }
});

// Rota para listar lojas que o usuário segue
router.get('/seguindo/listar', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const { data: seguindo, error } = await supabase
            .from('Seguidores')
            .select('perfil_seguido_id')
            .eq('usuario_id', userId);

        if (error) {
            return res.status(500).json([]);
        }

        if (!seguindo || seguindo.length === 0) {
            return res.status(200).json([]);
        }

        const usuariosSeguidosIds = seguindo.map(s => s.perfil_seguido_id);

        const { data: lojas, error: lojasError } = await supabase
            .from('loja')
            .select(`
                id,
                usuario_id,
                nome,
                descricao,
                telefone,
                email,
                cidade,
                bairro,
                rua,
                numero,
                complemento,
                horario_funcionamento,
                categoria,
                website,
                whatsapp,
                instagram,
                facebook,
                url_imagem,
                ativa,
                data_criacao,
                usuarios:usuario_id (id, nome, sobrenome, imagem_url)
            `)
            .in('usuario_id', usuariosSeguidosIds)
            .eq('ativa', true);

        if (lojasError) {
            return res.status(500).json([]);
        }

        const lojasFormatadas = lojas.map(loja => ({
            id: loja.usuario_id,
            loja_id: loja.id,
            nome: loja.nome,
            descricao: loja.descricao,
            telefone: loja.telefone,
            email: loja.email,
            cidade: loja.cidade,
            bairro: loja.bairro,
            rua: loja.rua,
            numero: loja.numero,
            complemento: loja.complemento,
            horario_funcionamento: loja.horario_funcionamento,
            categoria: loja.categoria,
            website: loja.website,
            whatsapp: loja.whatsapp,
            instagram: loja.instagram,
            facebook: loja.facebook,
            imagem_url: loja.url_imagem,
            ativa: loja.ativa,
            data_criacao: loja.data_criacao,
            usuario_nome: loja.usuarios?.nome,
            usuario_sobrenome: loja.usuarios?.sobrenome,
            usuario_imagem_url: loja.usuarios?.imagem_url,
            isFollowing: true
        }));

        res.status(200).json(lojasFormatadas);

    } catch (error) {
        res.status(500).json([]);
    }
});

module.exports = router;