// Tienda: catálogo, pedido y confirmación (lo que ve el cliente).

let textoBusqueda = '';
let categoriaActual = 'Todos';
let filtroTamano = 'Todos';
let filtroSabor = 'Todos';
let soloDisponibles = false;
let vistaActual = 'cuadros';
let ordenActual = 'destacados';

// Lista de { id, cantidad }
let pedido = [];

// Dibujos de las categorías
const ICONOS_CATEGORIA = {
  Frescos: icono('bebida'),
  'Repostería': icono('pastel'),
  'Chiverías': icono('snack')
};


// Ayudas

function buscarProducto(id) {
  return inventario.find(p => p.id === id);
}

// Se puede pedir si hay stock y no está vencido
function puedePedir(prod) {
  return prod.stock > 0 && !estaVencido(prod);
}

function claseCategoria(categoria) {
  if (categoria === 'Frescos') return 'cat-frescos';
  if (categoria === 'Repostería') return 'cat-reposteria';
  return 'cat-chiverias';
}

// Foto del producto; si no tiene, la inicial del nombre
function htmlFoto(prod) {
  if (prod.imagen.indexOf('data:image/') === 0) {
    return '<img src="' + escapar(prod.imagen) + '" alt="' + escapar(prod.nombre) + '" loading="lazy">';
  }
  return '<span class="foto-inicial ' + claseCategoria(prod.categoria) + '">' + escapar(prod.nombre.charAt(0).toUpperCase()) + '</span>';
}

// Cinta que se pone sobre la foto
function htmlCinta(prod) {
  if (estaVencido(prod)) return '<span class="cinta cinta-rojo">Vencido</span>';
  if (prod.stock <= 0) return '<span class="cinta cinta-rojo">Agotado</span>';
  if (prod.stock <= 5) return '<span class="cinta cinta-naranja">Quedan ' + prod.stock + '</span>';
  return '';
}

function avisar(texto) {
  if (typeof mostrarAviso === 'function') mostrarAviso(texto);
}


// Catálogo

function productosFiltrados() {
  const texto = textoBusqueda.trim().toLowerCase();

  return inventario.filter(prod => {
    if (categoriaActual !== 'Todos' && prod.categoria !== categoriaActual) return false;
    if (filtroTamano !== 'Todos' && prod.tamano !== filtroTamano) return false;
    if (filtroSabor !== 'Todos' && prod.sabor !== filtroSabor) return false;
    if (soloDisponibles && !puedePedir(prod)) return false;

    if (texto !== '') {
      const todo = (prod.nombre + ' ' + prod.sabor + ' ' + prod.tamano + ' ' + prod.descripcion + ' ' + prod.categoria).toLowerCase();
      if (todo.indexOf(texto) === -1) return false;
    }
    return true;
  });
}

// Ordena la lista según lo elegido (por defecto, los disponibles primero)
function ordenarProductos(lista) {
  const copia = lista.slice();
  if (ordenActual === 'precio-asc') {
    copia.sort((a, b) => a.precio - b.precio);
  } else if (ordenActual === 'precio-desc') {
    copia.sort((a, b) => b.precio - a.precio);
  } else if (ordenActual === 'nombre') {
    copia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } else {
    copia.sort((a, b) => Number(!puedePedir(a)) - Number(!puedePedir(b)));
  }
  return copia;
}

function renderizarCategorias() {
  const caja = document.getElementById('categorias');
  const nombres = ['Todos'].concat(CATEGORIAS);

  caja.innerHTML = nombres.map(nombre => {
    const cantidad = nombre === 'Todos' ? inventario.length : inventario.filter(p => p.categoria === nombre).length;
    const activo = nombre === categoriaActual ? ' activo' : '';
    const icono = ICONOS_CATEGORIA[nombre] || '';
    return '<button type="button" class="chip' + activo + '" data-categoria="' + nombre + '">' + icono + nombre + ' <span>' + cantidad + '</span></button>';
  }).join('');
}

// Llena una lista desplegable con los valores distintos de un campo
function llenarFiltro(idSelect, campo, seleccionado) {
  const select = document.getElementById(idSelect);
  const valores = [];

  inventario.forEach(prod => {
    if (categoriaActual !== 'Todos' && prod.categoria !== categoriaActual) return;
    if (prod[campo] !== '' && valores.indexOf(prod[campo]) === -1) valores.push(prod[campo]);
  });
  valores.sort();

  let html = '<option value="Todos">Todos</option>';
  valores.forEach(v => {
    html += '<option value="' + escapar(v) + '"' + (v === seleccionado ? ' selected' : '') + '>' + escapar(v) + '</option>';
  });
  select.innerHTML = html;

  if (seleccionado !== 'Todos' && valores.indexOf(seleccionado) === -1) return 'Todos';
  return seleccionado;
}

function htmlProducto(prod) {
  const disponible = puedePedir(prod);
  const detalle = [prod.tamano, prod.sabor].filter(t => t !== '').join(' · ');

  return `
    <article class="producto${disponible ? '' : ' agotado'}">
      <button type="button" class="producto-foto" data-info="${prod.id}" aria-label="Ver información de ${escapar(prod.nombre)}">${htmlFoto(prod)}${htmlCinta(prod)}</button>
      <div class="producto-cuerpo">
        <span class="producto-cat ${claseCategoria(prod.categoria)}">${escapar(prod.categoria)}</span>
        <h3>${escapar(prod.nombre)}</h3>
        ${detalle !== '' ? '<p class="producto-detalle">' + escapar(detalle) + '</p>' : ''}
        ${prod.descripcion !== '' ? '<p class="producto-desc">' + escapar(prod.descripcion) + '</p>' : ''}
      </div>
      <div class="producto-pie">
        <span class="precio">${dinero(prod.precio)}</span>
        <div class="producto-botones">
          <button type="button" class="btn-secundario peq" data-info="${prod.id}">Info</button>
          <button type="button" class="btn-principal peq" data-agregar="${prod.id}"${disponible ? '' : ' disabled'}>${icono('mas')} Agregar</button>
        </div>
      </div>
    </article>`;
}

function renderizarCatalogo() {
  filtroTamano = llenarFiltro('sel-tamano', 'tamano', filtroTamano);
  filtroSabor = llenarFiltro('sel-sabor', 'sabor', filtroSabor);
  renderizarCategorias();

  const lista = document.getElementById('lista-productos');
  const resultados = document.getElementById('lbl-resultados');
  const encontrados = ordenarProductos(productosFiltrados());

  lista.className = 'productos vista-' + vistaActual;
  resultados.textContent = '';

  if (errorCarga !== '') {
    lista.innerHTML = '<div class="vacio">' + escapar(errorCarga) + '<br><button type="button" class="btn-secundario peq" id="btn-reintentar">Intentar de nuevo</button></div>';
    return;
  }

  if (inventario.length === 0) {
    lista.innerHTML = '<p class="vacio">Todavía no hay productos disponibles. Vuelve pronto.</p>';
    return;
  }

  if (encontrados.length === 0) {
    lista.innerHTML = '<p class="vacio">No encontramos productos con esa búsqueda.</p>';
    return;
  }

  resultados.textContent = encontrados.length + (encontrados.length === 1 ? ' producto' : ' productos');
  lista.innerHTML = encontrados.map(htmlProducto).join('');
}

function cambiarVista(vista) {
  vistaActual = vista;
  try { localStorage.setItem('kioscoAna_vista', vista); } catch (e) {}
  document.getElementById('btn-vista-cuadros').classList.toggle('activo', vista === 'cuadros');
  document.getElementById('btn-vista-lista').classList.toggle('activo', vista === 'lista');
  renderizarCatalogo();
}

function quitarFiltros() {
  textoBusqueda = '';
  filtroTamano = 'Todos';
  filtroSabor = 'Todos';
  soloDisponibles = false;
  document.getElementById('txt-buscar').value = '';
  document.getElementById('chk-disponibles').checked = false;
  renderizarCatalogo();
}


// Información del producto

function abrirInfo(id) {
  const prod = buscarProducto(id);
  if (!prod) return;

  const filas = [];
  if (prod.tamano !== '') filas.push(['Tamaño', prod.tamano]);
  if (prod.sabor !== '') filas.push(['Sabor', prod.sabor]);
  filas.push(['Vencimiento', formatearFecha(prod.vencimiento)]);
  filas.push(['Disponibles', prod.stock]);

  document.getElementById('info-contenido').innerHTML = `
    <div class="info-foto">${htmlFoto(prod)}</div>
    <div class="info-texto">
      <span class="producto-cat ${claseCategoria(prod.categoria)}">${escapar(prod.categoria)}</span>
      <h2>${escapar(prod.nombre)}</h2>
      <p class="precio grande">${dinero(prod.precio)}</p>
      ${prod.descripcion !== '' ? '<p>' + escapar(prod.descripcion) + '</p>' : ''}
      <dl class="info-datos">
        ${filas.map(f => '<dt>' + f[0] + '</dt><dd>' + escapar(f[1]) + '</dd>').join('')}
      </dl>
      ${prod.receta !== '' ? '<h3>Receta e ingredientes</h3><p class="receta">' + escapar(prod.receta) + '</p>' : ''}
      <div class="botones-form">
        <button type="button" class="btn-principal" data-agregar-info="${prod.id}"${puedePedir(prod) ? '' : ' disabled'}>${icono('carrito')} Agregar al pedido</button>
        <button type="button" class="btn-secundario" data-cerrar>${icono('cerrar')} Cerrar</button>
      </div>
    </div>`;

  document.getElementById('dlg-info').showModal();
}


// Pedido

function agregarAlPedido(id) {
  const prod = buscarProducto(id);
  if (!prod || !puedePedir(prod)) return;

  const item = pedido.find(i => i.id === id);
  if (item) {
    if (item.cantidad >= prod.stock) {
      avisar('Solo hay ' + prod.stock + ' de ' + prod.nombre + '.');
      return;
    }
    item.cantidad++;
  } else {
    pedido.push({ id: id, cantidad: 1 });
  }
  renderizarPedido();
  animarPedido();
}

// Pequeño salto en el total para confirmar que se agregó el producto
function animarPedido() {
  ['lbl-total', 'barra-movil'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('rebote');
    void el.offsetWidth;
    el.classList.add('rebote');
  });
}

function cambiarCantidad(id, cambio) {
  const prod = buscarProducto(id);
  const item = pedido.find(i => i.id === id);
  if (!item || !prod) return;

  if (cambio > 0 && item.cantidad >= prod.stock) {
    avisar('Solo hay ' + prod.stock + ' de ' + prod.nombre + '.');
    return;
  }
  item.cantidad += cambio;
  if (item.cantidad <= 0) pedido = pedido.filter(i => i.id !== id);
  renderizarPedido();
}

function vaciarPedido() {
  pedido = [];
  renderizarPedido();
}

function totalPedido() {
  let total = 0;
  pedido.forEach(item => {
    const prod = buscarProducto(item.id);
    if (prod) total += prod.precio * item.cantidad;
  });
  return total;
}

function cantidadPedido() {
  let cantidad = 0;
  pedido.forEach(item => { cantidad += item.cantidad; });
  return cantidad;
}

// Dibuja el pedido en el panel y en la barra del celular
function renderizarPedido() {
  // Quita lo que ya no existe en el inventario
  pedido = pedido.filter(item => buscarProducto(item.id));

  const caja = document.getElementById('pedido-items');
  const total = totalPedido();
  const cantidad = cantidadPedido();

  if (pedido.length === 0) {
    caja.innerHTML = `
      <div class="pedido-vacio">
        ${icono('carrito')}
        <p>Aún no agregas productos.</p>
      </div>`;
  } else {
    caja.innerHTML = pedido.map(item => {
      const prod = buscarProducto(item.id);
      return `
        <div class="pedido-item">
          <div class="pedido-item-info">
            <strong>${escapar(prod.nombre)}</strong>
            <span>${dinero(prod.precio)} c/u</span>
          </div>
          <div class="cantidad">
            <button type="button" data-menos="${prod.id}" aria-label="Quitar uno">${icono('menos')}</button>
            <span>${item.cantidad}</span>
            <button type="button" data-mas="${prod.id}" aria-label="Agregar uno">${icono('mas')}</button>
          </div>
          <span class="pedido-item-total">${dinero(prod.precio * item.cantidad)}</span>
        </div>`;
    }).join('');
  }

  document.getElementById('lbl-total').textContent = dinero(total);
  document.getElementById('lbl-total-movil').textContent = dinero(total);
  document.getElementById('lbl-cantidad-movil').textContent = cantidad;
  document.getElementById('lbl-unidad-movil').textContent = cantidad === 1 ? 'producto' : 'productos';
  document.getElementById('btn-confirmar').disabled = pedido.length === 0;
  document.getElementById('btn-vaciar').hidden = pedido.length === 0;
  document.getElementById('barra-movil').hidden = pedido.length === 0;
  if (pedido.length === 0) cerrarPanelPedido();
}

// En el celular el pedido sube desde abajo
function abrirPanelPedido() {
  document.getElementById('panel-pedido').classList.add('abierto');
}

function cerrarPanelPedido() {
  document.getElementById('panel-pedido').classList.remove('abierto');
}


// Confirmar el pedido

function abrirDatosPedido() {
  if (pedido.length === 0) return;

  let resumen = '';
  pedido.forEach(item => {
    const prod = buscarProducto(item.id);
    resumen += '<div><span>' + item.cantidad + ' x ' + escapar(prod.nombre) + '</span><span>' + dinero(prod.precio * item.cantidad) + '</span></div>';
  });
  resumen += '<div class="resumen-total"><span>Total</span><span>' + dinero(totalPedido()) + '</span></div>';

  document.getElementById('resumen-pedido').innerHTML = resumen;
  document.getElementById('dlg-pedido').showModal();
}

async function finalizarPedido() {
  const cliente = {
    nombre: document.getElementById('cli-nombre').value.trim(),
    telefono: document.getElementById('cli-telefono').value.trim(),
    direccion: document.getElementById('cli-direccion').value.trim(),
    referencia: document.getElementById('cli-referencia').value.trim(),
    nota: document.getElementById('cli-nota').value.trim()
  };

  if (cliente.nombre === '' || cliente.telefono === '' || cliente.direccion === '') {
    avisar('Completa tu nombre, teléfono y dirección.');
    return;
  }

  const boton = document.querySelector('#form-pedido .btn-principal');
  boton.disabled = true;
  boton.textContent = 'Enviando...';

  const resultado = await registrarPedidoBD(cliente, pedido);

  boton.disabled = false;
  boton.innerHTML = icono('check') + ' Realizar pedido';

  if (!resultado.ok) {
    // El stock cambió: se ajusta el pedido a lo que hay
    pedido = pedido.filter(item => {
      const prod = buscarProducto(item.id);
      if (!prod || !puedePedir(prod)) return false;
      item.cantidad = Math.min(item.cantidad, prod.stock);
      return true;
    });
    document.getElementById('dlg-pedido').close();
    renderizarCatalogo();
    renderizarPedido();
    avisar(resultado.problemas.join(' '));
    return;
  }

  pedido = [];
  document.getElementById('form-pedido').reset();
  document.getElementById('dlg-pedido').close();
  cerrarPanelPedido();
  renderizarCatalogo();
  renderizarPedido();
  mostrarExito(resultado, cliente);
}

// Mensaje de pedido listo, con opción de enviarlo por WhatsApp
function mostrarExito(resultado, cliente) {
  const digitos = tienda.telefono.replace(/\D/g, '');
  const lineas = resultado.lineas.map(l => l.cantidad + ' x ' + l.nombre + ' (' + dinero(l.subtotal) + ')');

  let mensaje = 'Hola, quiero hacer este pedido en Kiosco Ana:\n';
  mensaje += lineas.map(l => '- ' + l).join('\n');
  mensaje += '\nTotal: ' + dinero(resultado.total);
  mensaje += '\n\nNombre: ' + cliente.nombre;
  mensaje += '\nTeléfono: ' + cliente.telefono;
  mensaje += '\nDirección: ' + cliente.direccion;
  if (cliente.referencia !== '') mensaje += '\nReferencia: ' + cliente.referencia;
  if (cliente.nota !== '') mensaje += '\nNota: ' + cliente.nota;

  let texto;
  if (resultado.guardado) texto = 'Tu pedido quedó registrado en Kiosco Ana.';
  else if (digitos !== '') texto = 'Para que Kiosco Ana reciba tu pedido, envíalo por WhatsApp.';
  else texto = 'Comunícate con Kiosco Ana para confirmar tu pedido.';

  let boton = '';
  if (digitos !== '') {
    boton = '<a class="btn-secundario" target="_blank" rel="noopener" href="https://wa.me/' + digitos + '?text=' + encodeURIComponent(mensaje) + '">' + icono('telefono') + ' Enviar por WhatsApp</a>';
  }

  document.getElementById('exito-contenido').innerHTML = `
    <div class="exito-icono">${icono('check')}</div>
    <h2>Pedido listo</h2>
    <p class="exito-total">${dinero(resultado.total)}</p>
    <p>${texto}</p>
    <div class="botones-form">
      <button type="button" class="btn-principal" data-cerrar>${icono('tienda')} Seguir comprando</button>
      ${boton}
    </div>`;
  document.getElementById('dlg-exito').showModal();
}


// Eventos

function iniciarTienda() {
  try { vistaActual = localStorage.getItem('kioscoAna_vista') === 'lista' ? 'lista' : 'cuadros'; } catch (e) {}
  document.getElementById('btn-vista-cuadros').classList.toggle('activo', vistaActual === 'cuadros');
  document.getElementById('btn-vista-lista').classList.toggle('activo', vistaActual === 'lista');

  document.getElementById('txt-buscar').addEventListener('input', function() {
    textoBusqueda = this.value;
    renderizarCatalogo();
  });

  document.getElementById('btn-filtros').addEventListener('click', function() {
    const panel = document.getElementById('panel-filtros');
    panel.hidden = !panel.hidden;
    this.setAttribute('aria-expanded', String(!panel.hidden));
  });

  document.getElementById('sel-tamano').addEventListener('change', function() { filtroTamano = this.value; renderizarCatalogo(); });
  document.getElementById('sel-sabor').addEventListener('change', function() { filtroSabor = this.value; renderizarCatalogo(); });
  document.getElementById('chk-disponibles').addEventListener('change', function() { soloDisponibles = this.checked; renderizarCatalogo(); });
  document.getElementById('btn-limpiar').addEventListener('click', quitarFiltros);
  document.getElementById('sel-orden').addEventListener('change', function() { ordenActual = this.value; renderizarCatalogo(); });

  document.getElementById('btn-vista-cuadros').addEventListener('click', function() { cambiarVista('cuadros'); });
  document.getElementById('btn-vista-lista').addEventListener('click', function() { cambiarVista('lista'); });

  document.getElementById('categorias').addEventListener('click', function(e) {
    const boton = e.target.closest('[data-categoria]');
    if (!boton) return;
    categoriaActual = boton.dataset.categoria;
    filtroTamano = 'Todos';
    filtroSabor = 'Todos';
    renderizarCatalogo();
  });

  document.getElementById('lista-productos').addEventListener('click', function(e) {
    const info = e.target.closest('[data-info]');
    const agregar = e.target.closest('[data-agregar]');
    if (e.target.closest('#btn-reintentar')) {
      cargarDatos().then(function() { renderizarCatalogo(); renderizarPedido(); });
    } else if (agregar) {
      agregarAlPedido(Number(agregar.dataset.agregar));
    } else if (info) {
      abrirInfo(Number(info.dataset.info));
    }
  });

  document.getElementById('dlg-info').addEventListener('click', function(e) {
    const agregar = e.target.closest('[data-agregar-info]');
    if (agregar) {
      agregarAlPedido(Number(agregar.dataset.agregarInfo));
      this.close();
    } else if (e.target.closest('[data-cerrar]') || e.target === this) {
      this.close();
    }
  });
  document.getElementById('dlg-exito').addEventListener('click', function(e) {
    if (e.target.closest('[data-cerrar]') || e.target === this) this.close();
  });
  document.getElementById('dlg-pedido').addEventListener('click', function(e) {
    if (e.target === this) this.close();
  });

  document.getElementById('pedido-items').addEventListener('click', function(e) {
    const mas = e.target.closest('[data-mas]');
    const menos = e.target.closest('[data-menos]');
    if (mas) cambiarCantidad(Number(mas.dataset.mas), 1);
    if (menos) cambiarCantidad(Number(menos.dataset.menos), -1);
  });
  document.getElementById('btn-vaciar').addEventListener('click', vaciarPedido);
  document.getElementById('btn-confirmar').addEventListener('click', abrirDatosPedido);
  document.getElementById('btn-ver-pedido').addEventListener('click', abrirPanelPedido);
  document.getElementById('btn-cerrar-pedido').addEventListener('click', cerrarPanelPedido);

  document.getElementById('form-pedido').addEventListener('submit', function(e) {
    e.preventDefault();
    finalizarPedido();
  });
  document.getElementById('btn-volver-pedido').addEventListener('click', function() {
    document.getElementById('dlg-pedido').close();
  });

  renderizarPedido();
}
