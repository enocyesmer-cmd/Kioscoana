// Al entrar a la web por primera vez en una sesión, abre primero la tienda.
// Si la dirección trae #/admin (por admin.html o un enlace guardado), se cambia a la tienda.
// Después, el botón "Administración" del menú sigue funcionando igual.
(function () {
  try {
    if (sessionStorage.getItem('kioscoana-inicio') === '1') return;
    sessionStorage.setItem('kioscoana-inicio', '1');
  } catch (e) { /* si no hay sessionStorage, se usa solo la regla de abajo */ }

  if (location.hash.indexOf('#/admin') === 0) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }
})();
