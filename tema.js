// Tema claro / oscuro

// Aplicar el tema guardado antes de mostrar la página (evita un parpadeo)
(function() {
  let tema = 'claro';
  try {
    tema = localStorage.getItem('kioscoAna_tema') || 'claro';
  } catch (error) {}
  if (tema === 'oscuro') document.documentElement.classList.add('oscuro');
})();

// Dibujo de un icono del paquete (el sprite está en index.html)
function icono(nombre, extra) {
  return '<svg class="icono' + (extra ? ' ' + extra : '') + '" aria-hidden="true"><use href="#icon-' + nombre + '"/></svg>';
}

// Dibujos del botón (luna y sol)
const ICONO_LUNA = icono('luna');
const ICONO_SOL = icono('sol');

// Cambiar entre claro y oscuro
function cambiarTema() {
  const oscuro = document.documentElement.classList.toggle('oscuro');
  try {
    localStorage.setItem('kioscoAna_tema', oscuro ? 'oscuro' : 'claro');
  } catch (error) {}
  actualizarBotonTema();
}

// Poner el dibujo correcto en el botón
function actualizarBotonTema() {
  const boton = document.getElementById('btn-tema');
  if (!boton) return;
  const oscuro = document.documentElement.classList.contains('oscuro');
  boton.innerHTML = oscuro ? ICONO_SOL : ICONO_LUNA;
  boton.title = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  boton.setAttribute('aria-label', boton.title);
}

document.addEventListener('DOMContentLoaded', actualizarBotonTema);
