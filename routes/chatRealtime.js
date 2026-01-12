// routes/chatRealtime.js
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase Realtime
const supabaseRealtime = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        realtime: {
            params: {
                eventsPerSecond: 10
            }
        }
    }
);

// Armazena canais ativos para evitar criar múltiplos
const canaisAtivos = new Map();

/**
 * Envia notificação em tempo real para um usuário específico
 * @param {string} userId - ID do usuário destinatário
 * @param {object} payload - Dados da notificação
 */
const enviarNotificacaoRealtime = async (userId, payload) => {
    try {
        // Validação básica
        if (!userId || typeof userId !== 'string') {
            return;
        }

        // Nome do canal baseado no userId
        const channelName = `user_${userId}`;

        // Se já tem um canal ativo para este usuário, reutiliza
        let channel = canaisAtivos.get(userId);

        if (!channel) {
            // Cria novo canal
            channel = supabaseRealtime.channel(channelName);
            canaisAtivos.set(userId, channel);
        }

        // Promessa para controle do subscribe
        return new Promise((resolve, reject) => {
            channel.subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    try {
                        // Envia a mensagem
                        const sendResult = channel.send({
                            type: 'broadcast',
                            event: 'nova_mensagem',
                            payload: payload
                        });

                        // Remove o canal após 2 segundos para limpeza
                        setTimeout(() => {
                            if (canaisAtivos.has(userId)) {
                                canaisAtivos.get(userId).unsubscribe();
                                canaisAtivos.delete(userId);
                            }
                        }, 2000);

                        resolve(sendResult);
                    } catch (sendError) {
                        reject(sendError);
                    }
                } else if (status === 'CHANNEL_ERROR') {
                    const error = new Error(`Erro no canal ${channelName}`);
                    canaisAtivos.delete(userId);
                    reject(error);
                }
            });
        });

    } catch (error) {
        // Limpa canal se existir
        if (canaisAtivos.has(userId)) {
            canaisAtivos.delete(userId);
        }
        throw error;
    }
};

/**
 * Limpa todos os canais ativos (usar no shutdown do servidor)
 */
const limparCanais = () => {
    canaisAtivos.forEach((channel, userId) => {
        channel.unsubscribe();
    });
    canaisAtivos.clear();
};

// Exportações
module.exports = { enviarNotificacaoRealtime, limparCanais };