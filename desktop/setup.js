const url = document.querySelector('#url');
const chave = document.querySelector('#chave');
const estado = document.querySelector('#estado');
const conectar = document.querySelector('#conectar');
window.nod.estado().then((s) => { url.value = s.url; estado.textContent = s.mensagem; });
document.querySelector('#login').addEventListener('click', async () => {
  const r = await window.nod.abrirLogin(url.value);
  estado.textContent = r.mensagem;
});
document.querySelector('#form').addEventListener('submit', async (e) => {
  e.preventDefault(); conectar.disabled = true;
  estado.textContent = 'Conectando e verificando o Claude…';
  try { const r = await window.nod.conectar({ url: url.value, chave: chave.value.trim() }); estado.textContent = r.mensagem; }
  catch { estado.textContent = 'Não foi possível conectar. Confira o endereço e tente novamente.'; }
  finally { chave.value = ''; conectar.disabled = false; }
});
