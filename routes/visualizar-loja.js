const express = require('express');
const { supabaseAdmin } = require('../supabaseClient.js');
const { verifyToken } = require('../authMiddleware.js');

const router = express.Router();

// FunÃ§Ã£o auxiliar para calcular dias restantes
const calcularDiasRestantes = (dataFim) => {
    try {
        const fim = new Date(dataFim);
        const hoje = new Date();
        const diffTime = fim - hoje;
        const dias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return dias > 0 ? dias : 0;
    } catch (error) {
        return 0;
    }
};

// FunÃ§Ã£o para validar UUID
function isValidUUID(uuid) {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return regex.test(uuid);
}

// Rota principal para visualizar detalhes da loja
router.get('/:lojaId', verifyToken, async (req, res) => {
    try {
        const { lojaId } = req.params;
        const currentUserId = req.user.id;

        if (!lojaId || !isValidUUID(lojaId)) {
            return res.status(400).json({
                success: false,
                error: 'ID da loja invÃ¡lido'
            });
        }

        const { data: loja, error: lojaError } = await supabaseAdmin
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
            `)
            .eq('usuario_id', lojaId)
            .eq('ativa', true)
            .single();

        if (lojaError || !loja) {
            return res.status(404).json({
                success: false,
                error: 'Loja nÃ£o encontrada'
            });
        }

        const { data: produtos, error: produtosError } = await supabaseAdmin
            .from('produtos')
            .select('*')
            .eq('usuario_id', loja.usuario_id)
            .eq('status', 'ativo')
            .order('created_at', { ascending: false });

        const { data: ofertas, error: ofertasError } = await supabaseAdmin
            .from('ofertas')
            .select('*')
            .eq('usuario_id', loja.usuario_id)
            .eq('ativa', true)
            .gte('data_fim', new Date().toISOString())
            .order('data_fim', { ascending: true });

        const ofertasValidas = (ofertas || []).filter(oferta => {
            const diasRestantes = calcularDiasRestantes(oferta.data_fim);
            return diasRestantes > 0;
        });

        const novidadesPage = parseInt(req.query.novidadesPage) || 1;
        const novidadesPerPage = 8;
        const novidadesOffset = (novidadesPage - 1) * novidadesPerPage;

        const { data: novidades, error: novidadesError } = await supabaseAdmin
            .from('novidades')
            .select('*')
            .eq('usuario_id', loja.usuario_id)
            .order('data_publicacao', { ascending: false })
            .range(novidadesOffset, novidadesOffset + novidadesPerPage - 1);

        const { count: seguidoresCount, error: seguidoresError } = await supabaseAdmin
            .from('Seguidores')
            .select('*', { count: 'exact', head: true })
            .eq('perfil_seguido_id', loja.usuario_id);

        const { data: seguindo, error: seguindoError } = await supabaseAdmin
            .from('Seguidores')
            .select('id')
            .eq('usuario_id', currentUserId)
            .eq('perfil_seguido_id', loja.usuario_id)
            .maybeSingle();

        const { data: favoritos, error: favoritosError } = await supabaseAdmin
            .from('favoritos')
            .select('*, produtos:produto_id(*)')
            .eq('usuario_id', currentUserId);

        const favoritosAtivos = (favoritos || []).filter(favorito => {
            return favorito.produtos && favorito.produtos.status === 'ativo';
        });

        const ofertasFormatadas = ofertasValidas.map(oferta => ({
            ...oferta,
            dias_restantes: calcularDiasRestantes(oferta.data_fim)
        }));

        const novidadesFormatadas = novidades || [];

        const produtosSalvos = favoritosAtivos.map(f => f.produto_id.toString());

        const hasMoreNovidades = (novidades || []).length >= novidadesPerPage;

        const responseData = {
            success: true,
            loja: {
                ...loja,
                usuario_nome: loja.usuarios?.nome,
                usuario_sobrenome: loja.usuarios?.sobrenome,
                usuario_imagem_url: loja.usuarios?.imagem_url
            },
            produtos: produtos || [],
            ofertas: ofertasFormatadas,
            novidades: novidadesFormatadas,
            seguidoresCount: seguidoresCount || 0,
            isFollowing: !!seguindo,
            produtosSalvos,
            hasMoreNovidades,
            novidadesPage
        };

        res.status(200).json(responseData);

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro interno no servidor'
        });
    }
});

// Rota para seguir/deseguir loja
router.post('/seguir', verifyToken, async (req, res) => {
    try {
        const { lojaId } = req.body;
        const userId = req.user.id;

        if (!lojaId) {
            return res.status(400).json({
                success: false,
                error: 'ID da loja Ã© obrigatÃ³rio'
            });
        }

        const { data: seguindoExistente, error: checkError } = await supabaseAdmin
            .from('Seguidores')
            .select('id')
            .eq('usuario_id', userId)
            .eq('perfil_seguido_id', lojaId)
            .maybeSingle();

        if (checkError) {
            throw checkError;
        }

        if (seguindoExistente) {
            const { error: deleteError } = await supabaseAdmin
                .from('Seguidores')
                .delete()
                .eq('id', seguindoExistente.id);

            if (deleteError) {
                throw deleteError;
            }

            res.json({
                success: true,
                action: 'deseguir',
                isFollowing: false,
                lojaId: lojaId
            });

        } else {
            const { data: novoSeguidor, error: insertError } = await supabaseAdmin
                .from('Seguidores')
                .insert([{
                    usuario_id: userId,
                    perfil_seguido_id: lojaId,
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();

            if (insertError) {
                if (insertError.code === '23505') {
                    return res.status(400).json({
                        success: false,
                        error: 'VocÃª jÃ¡ segue esta loja'
                    });
                }
                throw insertError;
            }

            res.json({
                success: true,
                action: 'seguir',
                isFollowing: true,
                lojaId: lojaId
            });
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro ao gerenciar seguidores'
        });
    }
});

// Rota para favoritar produto
router.post('/favoritos', verifyToken, async (req, res) => {
    try {
        const { produto_id } = req.body;
        const usuarioId = req.user.id;

        if (!produto_id) {
            return res.status(400).json({
                success: false,
                error: 'ID do produto Ã© obrigatÃ³rio'
            });
        }

        const { data: produto, error: produtoError } = await supabaseAdmin
            .from('produtos')
            .select('id')
            .eq('id', produto_id)
            .eq('status', 'ativo')
            .single();

        if (produtoError || !produto) {
            return res.status(404).json({
                success: false,
                error: 'Produto nÃ£o encontrado ou inativo'
            });
        }

        const { data: favorito } = await supabaseAdmin
            .from('favoritos')
            .select('id')
            .eq('usuario_id', usuarioId)
            .eq('produto_id', produto_id)
            .maybeSingle();

        let action = 'removed';
        let message = 'Produto removido dos favoritos';

        if (favorito) {
            await supabaseAdmin
                .from('favoritos')
                .delete()
                .eq('id', favorito.id);
        } else {
            await supabaseAdmin
                .from('favoritos')
                .insert([{
                    usuario_id: usuarioId,
                    produto_id: produto_id,
                    created_at: new Date().toISOString()
                }]);
            action = 'added';
            message = 'Produto adicionado aos favoritos';
        }

        res.status(200).json({
            success: true,
            action: action,
            message: message
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro ao atualizar favoritos'
        });
    }
});

// Rota para enviar mensagem sobre oferta
router.post('/mensagens', verifyToken, async (req, res) => {
    try {
        const { oferta_id, destinatario_id, mensagem } = req.body;
        const remetente_id = req.user.id;

        if (!oferta_id) {
            return res.status(400).json({
                success: false,
                error: 'ID da oferta Ã© obrigatÃ³rio'
            });
        }

        if (!destinatario_id || !isValidUUID(destinatario_id)) {
            return res.status(400).json({
                success: false,
                error: 'ID do destinatÃ¡rio invÃ¡lido'
            });
        }

        if (!mensagem?.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Digite uma mensagem vÃ¡lida'
            });
        }

        const { data: oferta, error: ofertaError } = await supabaseAdmin
            .from('ofertas')
            .select('id, produto_id, usuario_id')
            .eq('id', oferta_id)
            .single();

        if (ofertaError || !oferta) {
            return res.status(404).json({
                success: false,
                error: 'Oferta nÃ£o encontrada'
            });
        }

        if (oferta.usuario_id !== destinatario_id) {
            return res.status(400).json({
                success: false,
                error: 'DestinatÃ¡rio nÃ£o Ã© o proprietÃ¡rio desta oferta'
            });
        }

        if (remetente_id === destinatario_id) {
            return res.status(400).json({
                success: false,
                error: 'VocÃª nÃ£o pode enviar mensagem para si mesmo'
            });
        }

        const mensagemData = {
            remetente_id,
            destinatario_id,
            oferta_id: Number(oferta_id),
            mensagem: mensagem.trim(),
            data_hora: new Date().toISOString(),
            lida: false,
            remetente_deletado: false,
            destinatario_deletado: false,
            oferta: true
        };

        if (oferta.produto_id) {
            mensagemData.produto_id = oferta.produto_id;
        }

        const { data: novaMensagem, error: insertError } = await supabaseAdmin
            .from('mensagens')
            .insert([mensagemData])
            .select(`
                id,
                mensagem,
                data_hora,
                lida,
                remetente_id,
                destinatario_id,
                produto_id,
                oferta_id,
                oferta
            `)
            .single();

        if (insertError) {
            throw insertError;
        }

        const { data: remetente } = await supabaseAdmin
            .from('usuarios')
            .select('nome, sobrenome, imagem_url')
            .eq('id', remetente_id)
            .maybeSingle();

        const resposta = {
            id: novaMensagem.id,
            mensagem: novaMensagem.mensagem,
            data_hora: novaMensagem.data_hora,
            lida: novaMensagem.lida,
            remetente_id: novaMensagem.remetente_id,
            remetente_nome: remetente?.nome || 'UsuÃ¡rio',
            remetente_sobrenome: remetente?.sobrenome || '',
            remetente_imagem: remetente?.imagem_url,
            destinatario_id: novaMensagem.destinatario_id,
            oferta_id: novaMensagem.oferta_id,
            produto_id: novaMensagem.produto_id,
            oferta: novaMensagem.oferta,
            enviada_por_mim: true
        };

        res.status(200).json({
            success: true,
            data: resposta,
            message: 'Mensagem enviada com sucesso'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro ao enviar mensagem'
        });
    }
});

module.exports = router;
