// Tema claro / oscuro

// Aplicar el tema guardado antes de mostrar la página (evita un parpadeo)
(function() {
  let tema = 'claro';
  try {
    tema = localStorage.getItem('kioscoAna_tema') || 'claro';
  } catch (error) {}
  if (tema === 'oscuro') document.documentElement.classList.add('oscuro');
})();

// Dibujos del botón (luna y sol)
const ICONO_LUNA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
const ICONO_SOL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';

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
