// Arranque y navegación. La tienda y la administración son una sola página:
// #/ muestra la tienda y #/admin la administración.

// Aviso corto que desaparece solo
function mostrarAviso(texto) {
  const caja = document.getElementById('avisos');

  // Si el mismo aviso ya está en pantalla, no se repite
  if (Array.from(caja.children).some(a => a.textContent === texto)) return;

  const aviso = document.createElement('div');
  aviso.className = 'aviso-flotante';
  aviso.textContent = texto;
  caja.appendChild(aviso);
  setTimeout(function() { aviso.remove(); }, 4500);
}

// El estado de la base se muestra en la administración
alCambiarEstado = function(texto, tipo) {
  const linea = document.getElementById('estado-bd');
  if (linea) {
    linea.textContent = texto;
    linea.className = 'estado-bd estado-' + tipo;
  }
  if (tipo === 'error') mostrarAviso(texto);
};

// Si la sesión del servidor venció, se vuelve a pedir la clave
alVencerSesion = function() {
  mostrarAviso('La sesión venció. Entra de nuevo.');
  if (location.hash.indexOf('#/admin') === 0) prepararAdmin();
};

// Pie de página con los datos de contacto
function actualizarPie() {
  document.getElementById('pie-telefono').hidden = tienda.telefono === '';
  document.getElementById('pie-correo').hidden = tienda.correo === '';
  document.getElementById('pie-vacio').hidden = tienda.telefono !== '' || tienda.correo !== '';

  const enlaceTel = document.getElementById('enlace-telefono');
  enlaceTel.textContent = tienda.telefono;
  enlaceTel.href = 'tel:+' + tienda.telefono.replace(/\D/g, '');

  const enlaceCorreo = document.getElementById('enlace-correo');
  enlaceCorreo.textContent = tienda.correo;
  enlaceCorreo.href = 'mailto:' + tienda.correo;
}

// Muestra la tienda o la administración según la dirección
function mostrarVistaActual() {
  const enAdmin = location.hash.indexOf('#/admin') === 0;

  document.getElementById('vista-tienda').hidden = enAdmin;
  document.getElementById('vista-admin').hidden = !enAdmin;
  document.getElementById('nav-tienda').classList.toggle('activo', !enAdmin);
  document.getElementById('nav-admin').classList.toggle('activo', enAdmin);

  window.scrollTo(0, 0);

  if (enAdmin) {
    prepararAdmin();
  } else {
    renderizarCatalogo();
    renderizarPedido();
  }
}

async function iniciarApp() {
  iniciarTienda();
  iniciarAdmin();

  await cargarDatos();
  actualizarPie();

  // Sombra en la cabecera cuando se baja la página
  const cabecera = document.querySelector('.cabecera');
  window.addEventListener('scroll', function() {
    cabecera.classList.toggle('con-sombra', window.scrollY > 4);
  }, { passive: true });

  window.addEventListener('hashchange', mostrarVistaActual);
  mostrarVistaActual();
}

document.addEventListener('DOMContentLoaded', iniciarApp);
