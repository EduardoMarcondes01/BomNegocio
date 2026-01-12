function aceitarTermos() {
    localStorage.setItem('termosAceitos', 'true');
    window.location.href = '/cadastro';
  }
  
  document.getElementById('aceitar-termos-button').addEventListener('click', aceitarTermos);