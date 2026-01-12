function enviarMensagemSuporte() {
    const mensagem = document.getElementById('mensagem-suporte').value;
    alert('Mensagem enviada: ' + mensagem);
  }
  
  document.getElementById('enviar-mensagem-suporte').addEventListener('click', enviarMensagemSuporte);

module.exports = { mensagem };