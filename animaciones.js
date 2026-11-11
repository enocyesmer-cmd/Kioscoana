// Kiosco Ana · Animaciones al bajar (archivo NUEVO, no cambia tienda.js ni app.js)
//
// Qué hace:
//  - Los productos entran DE LADO A LADO hasta su posición original:
//      · columna izquierda  -> viene desde la izquierda
//      · columna derecha    -> viene desde la derecha
//      · columna del centro -> sube desde abajo
//      · en vista de lista  -> van alternando izquierda / derecha
//  - Cada fila entra en cascada (uno tras otro), cuando el usuario baja.
//  - También se animan la portada y el pie de página.
//  - Funciona igual en celular y PC (se adapta a las columnas que haya).
//  - Si el usuario tiene activada la opción "reducir movimiento", no anima.

(function () {
  'use strict';

  var reducir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducir || !('IntersectionObserver' in window) || !('MutationObserver' in window)) return;

  document.documentElement.classList.add('ka-anim');

  var DURACION_MS = 850;
  var PASO_CASCADA_MS = 75;     // pausa entre un producto y el siguiente
  var MAX_CASCADA_MS = 450;

  // ---------- Entrada de un elemento ----------
  function revelar(el, retraso) {
    if (!el.classList.contains('ka-oculto')) return;
    el.style.setProperty('--ka-retraso', retraso + 'ms');
    el.classList.add('ka-entra');

    var limpiado = false;
    function limpiar() {
      if (limpiado) return;
      limpiado = true;
      el.classList.remove('ka-oculto', 'ka-entra');
      el.removeAttribute('data-ka');
      el.style.removeProperty('--ka-retraso');
    }
    // Al terminar la animación se quita todo: el elemento queda igual que
    // antes (y el efecto "hover" de las tarjetas sigue funcionando).
    el.addEventListener('animationend', function (e) {
      if (e.target === el) limpiar();
    });
    setTimeout(limpiar, DURACION_MS * 1.5 + retraso + 300);   // por seguridad
  }

  var vigilante = new IntersectionObserver(function (entradas) {
    var visibles = entradas.filter(function (e) { return e.isIntersecting; });
    // En orden de arriba hacia abajo y de izquierda a derecha
    visibles.sort(function (a, b) {
      var ra = a.boundingClientRect, rb = b.boundingClientRect;
      return (Math.round(ra.top / 10) - Math.round(rb.top / 10)) || (ra.left - rb.left);
    });
    visibles.forEach(function (e, i) {
      vigilante.unobserve(e.target);
      revelar(e.target, Math.min(i * PASO_CASCADA_MS, MAX_CASCADA_MS));
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  function preparar(el, direccion) {
    if (el.classList.contains('ka-oculto')) return;
    el.setAttribute('data-ka', direccion);
    el.classList.add('ka-oculto');
    vigilante.observe(el);
  }

  // ---------- Productos ----------
  var lista = document.getElementById('lista-productos');

  function columnasDe(caja) {
    var estilo = window.getComputedStyle(caja);
    if (estilo.display !== 'grid') return 1;
    var n = estilo.gridTemplateColumns.split(' ').filter(Boolean).length;
    return n > 0 ? n : 1;
  }

  function prepararProductos() {
    if (!lista) return;
    var tarjetas = lista.querySelectorAll('.producto');
    var columnas = columnasDe(lista);
    Array.prototype.forEach.call(tarjetas, function (tarjeta, i) {
      var direccion;
      if (columnas === 1) {
        direccion = i % 2 === 0 ? 'izq' : 'der';              // lista: alterna
      } else {
        var col = i % columnas;
        if (col < (columnas - 1) / 2) direccion = 'izq';       // lado izquierdo
        else if (col > (columnas - 1) / 2) direccion = 'der';  // lado derecho
        else direccion = 'abajo';                              // centro
      }
      preparar(tarjeta, direccion);
    });
  }

  if (lista) {
    // La tienda vuelve a dibujar los productos al buscar, filtrar u ordenar:
    // este vigilante detecta las tarjetas nuevas y las anima también.
    // (Se ejecuta antes de que el navegador pinte, así no hay parpadeo.)
    new MutationObserver(prepararProductos).observe(lista, { childList: true });
    prepararProductos();
  }

  // ---------- Portada y pie de página ----------
  [
    ['.portada-texto', 'izq'],
    ['.portada-logo',  'der'],
    ['.pie-marca',     'izq'],
    ['.pie-contacto',  'der']
  ].forEach(function (par) {
    var el = document.querySelector(par[0]);
    if (el) preparar(el, par[1]);
  });
})();
