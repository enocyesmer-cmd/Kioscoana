// Administración: productos, ventas y ajustes.


const CLAVE_ADMIN = 'admin123';

// Con este stock o menos se marca como bajo
const STOCK_BAJO = 5;

let idEditando = null;
let imagenNueva = '';

// Ventas
let filtroVentas = 'todas';           // todas, pendiente, si o no
const ventasCambiando = new Set();    // ventas donde se está cambiando la respuesta


// Acceso

function haySesionAdmin() {
  if (modo === 'servidor') return leerTokenAdmin() !== '';
  try { return sessionStorage.getItem('kioscoAna_admin') === '1'; } catch (e) { return false; }
}

function guardarSesionAdmin(abierta) {
  try {
    if (abierta) sessionStorage.setItem('kioscoAna_admin', '1');
    else sessionStorage.removeItem('kioscoAna_admin');
  } catch (e) {}
}

// Se llama cada vez que se entra a la administración
async function prepararAdmin() {
  const hayClave = haySesionAdmin();
  document.getElementById('admin-login').hidden = hayClave;
  document.getElementById('admin-panel').hidden = !hayClave;

  if (!hayClave) {
    document.getElementById('txt-clave').focus();
    return;
  }

  // Lee otra vez los datos para ver lo más reciente
  await cargarDatos();
  mostrarEstadoInicial();
  limpiarFormulario();
  iniciarVentasVistas();
  renderizarAdmin();
}

async function entrarAdmin(e) {
  e.preventDefault();
  const clave = document.getElementById('txt-clave').value;
  const mensaje = document.getElementById('msg-clave');
  const boton = document.querySelector('#form-login .btn-principal');

  let entro = false;
  let error = 'Clave incorrecta.';

  if (modo === 'servidor') {
    boton.disabled = true;
    const r = await iniciarSesionServidor(clave);
    boton.disabled = false;
    entro = r.ok;
    if (!r.ok) error = r.error;
  } else {
    entro = clave === CLAVE_ADMIN;
    if (entro) guardarSesionAdmin(true);
  }

  if (entro) {
    document.getElementById('txt-clave').value = '';
    mensaje.hidden = true;
    prepararAdmin();
  } else {
    mensaje.textContent = error;
    mensaje.hidden = false;
  }
}

function cerrarSesionAdmin() {
  guardarSesionAdmin(false);
  cerrarSesionServidor();
  location.hash = '#/';
}

function mostrarEstadoInicial() {
  if (modo === 'servidor') {
    avisarEstado('Conectado al servidor. Los cambios se guardan en KioscoAna.db.', 'ok');
  } else if (modo === 'local') {
    avisarEstado('Modo de prueba: los datos se guardan solo en este navegador.', 'info');
  } else if (baseLista && leerToken() !== '') {
    avisarEstado('Conectado a GitHub. ' + inventario.length + ' productos en KioscoAna.db.', 'ok');
  } else if (leerToken() === '') {
    avisarEstado('Solo lectura: conecta tu token de GitHub en Ajustes para guardar cambios.', 'aviso');
  }
}

function avisarSinPermiso() {
  avisar('No se puede guardar todavía. Conecta tu token de GitHub en Ajustes.');
  mostrarPestana('ajustes');
}

// Muestra el error de una operación que falló
function avisarError(error) {
  avisar('No se guardó: ' + error);
}


// Pestañas

function mostrarPestana(nombre) {
  document.querySelectorAll('.pestanas button').forEach(boton => {
    boton.classList.toggle('activo', boton.dataset.pestana === nombre);
  });
  ['productos', 'ventas', 'ajustes'].forEach(p => {
    document.getElementById('pest-' + p).hidden = p !== nombre;
  });

  if (nombre === 'ventas') {
    idVentaAntes = idVentaVista;
    registrarVentasVistas();
    renderizarVentas();
  }
}


// Dibujar el panel

function renderizarAdmin() {
  renderizarResumen();
  renderizarGrafico();
  renderizarInventarioAdmin();
  renderizarVentas();
  renderizarAjustes();
  actualizarInsigniaVentas();
}

function renderizarResumen() {
  // Las ventas marcadas como "no confirmada" no suman al total
  let totalVendido = 0;
  ventas.forEach(v => { if (v.confirmada !== 'no') totalVendido += Number(v.total) || 0; });

  document.getElementById('res-productos').textContent = inventario.length;
  const bajos = inventario.filter(p => p.stock <= STOCK_BAJO).length;
  document.getElementById('res-stock-bajo').textContent = bajos;
  document.getElementById('res-stock-bajo').closest('.dato').classList.toggle('alerta-dato', bajos > 0);
  document.getElementById('res-ventas').textContent = ventas.length;
  document.getElementById('res-total').textContent = dinero(totalVendido);
}

// Gráfico de barras con lo vendido en los últimos 7 días
const NOMBRES_DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function renderizarGrafico() {
  const caja = document.getElementById('grafico-ventas-barras');
  const resumen = document.getElementById('grafico-resumen');
  if (!caja) return;

  const hoy = new Date();
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i);
    dias.push({ clave: fechaATexto(fecha), etiqueta: NOMBRES_DIA[fecha.getDay()], total: 0, cantidad: 0, hoy: i === 0 });
  }

  let sumaSemana = 0;
  let pedidosSemana = 0;
  ventas.forEach(v => {
    if (v.confirmada === 'no') return;
    const dia = dias.find(d => d.clave === String(v.fecha).slice(0, 10));
    if (!dia) return;
    dia.total += Number(v.total) || 0;
    dia.cantidad++;
    sumaSemana += Number(v.total) || 0;
    pedidosSemana++;
  });

  if (pedidosSemana === 0) {
    resumen.textContent = '';
    caja.innerHTML = '<p class="grafico-vacio">Aún no hay ventas en los últimos 7 días.</p>';
    return;
  }

  resumen.textContent = pedidosSemana + (pedidosSemana === 1 ? ' venta' : ' ventas') + ' · ' + dinero(sumaSemana);

  const maximo = Math.max.apply(null, dias.map(d => d.total));
  caja.innerHTML = dias.map(d => {
    const alto = d.total > 0 ? Math.max(5, Math.round(d.total / maximo * 100)) : 0;
    const titulo = d.etiqueta + ': ' + d.cantidad + (d.cantidad === 1 ? ' venta' : ' ventas') + ' · ' + dinero(d.total);
    return '<div class="barra-dia' + (d.hoy ? ' hoy' : '') + '" title="' + titulo + '">' +
      '<span class="barra-valor">' + (d.total > 0 ? 'C$ ' + Math.round(d.total) : '') + '</span>' +
      '<div class="barra-pista"><div class="barra" style="height:' + alto + '%"></div></div>' +
      '<span class="barra-etiqueta">' + (d.hoy ? 'Hoy' : d.etiqueta) + '</span></div>';
  }).join('');
}

function renderizarInventarioAdmin() {
  const cuerpo = document.getElementById('cuerpo-inventario');
  const texto = document.getElementById('txt-buscar-admin').value.trim().toLowerCase();

  const lista = inventario.filter(p => texto === '' || (p.nombre + ' ' + p.categoria + ' ' + p.sabor).toLowerCase().indexOf(texto) !== -1);

  if (inventario.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla-vacia">Aún no hay productos. Agrega el primero con el formulario.</td></tr>';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla-vacia">No hay productos con esa búsqueda.</td></tr>';
    return;
  }

  cuerpo.innerHTML = lista.map(prod => {
    const vencido = estaVencido(prod);
    let marcaStock = '';
    if (prod.stock === 0) marcaStock = '<span class="marca-estado rojo">Agotado</span>';
    else if (prod.stock <= STOCK_BAJO) marcaStock = '<span class="marca-estado naranja">Bajo</span>';

    return `
      <tr>
        <td data-etiqueta="Producto">
          <div class="celda-producto">
            <span class="miniatura">${htmlFoto(prod)}</span>
            <strong>${escapar(prod.nombre)}</strong>
          </div>
        </td>
        <td class="col-media" data-etiqueta="Categoría">${escapar(prod.categoria)}</td>
        <td data-etiqueta="Precio">${dinero(prod.precio)}</td>
        <td data-etiqueta="Stock">${prod.stock} ${marcaStock}</td>
        <td class="col-media" data-etiqueta="Vence">${formatearFecha(prod.vencimiento)}${vencido ? ' <span class="marca-estado rojo">Vencido</span>' : ''}</td>
        <td class="acciones">
          <button type="button" class="btn-secundario peq" data-editar="${prod.id}" title="Editar" aria-label="Editar ${escapar(prod.nombre)}">${icono('editar')}</button>
          <button type="button" class="btn-peligro peq" data-eliminar="${prod.id}" title="Eliminar" aria-label="Eliminar ${escapar(prod.nombre)}">${icono('eliminar')}</button>
        </td>
      </tr>`;
  }).join('');
}

function textoCliente(cliente) {
  if (!cliente || !cliente.nombre) return '-';

  let texto = '<div class="cliente-datos"><strong>' + escapar(cliente.nombre) + '</strong>';
  texto += '<span class="dato-cliente" title="Teléfono">' + icono('telefono') + escapar(cliente.telefono) + '</span>';
  texto += '<span class="dato-cliente" title="Dirección">' + icono('ubicacion') + escapar(cliente.direccion) + '</span>';
  if (cliente.referencia) texto += '<span class="dato-cliente" title="Referencia">' + icono('etiqueta') + escapar(cliente.referencia) + '</span>';
  if (cliente.nota) texto += '<span class="dato-cliente" title="Nota">' + icono('nota') + escapar(cliente.nota) + '</span>';
  return texto + '</div>';
}

// Pregunta "¿Venta confirmada?" con Sí y No. Al elegir, se guarda en la base de datos.
function htmlConfirmacion(venta) {
  const estado = venta.confirmada || 'pendiente';

  if (estado === 'pendiente' || ventasCambiando.has(Number(venta.id))) {
    return `
      <div class="confirmar-venta">
        <span class="confirmar-pregunta">¿Venta confirmada?</span>
        <div class="confirmar-botones">
          <button type="button" class="btn-si" data-confirmar="${venta.id}" data-valor="si">${icono('check')} Sí</button>
          <button type="button" class="btn-no" data-confirmar="${venta.id}" data-valor="no">${icono('cerrar')} No</button>
        </div>
      </div>`;
  }

  const confirmada = estado === 'si';
  return `
    <div class="confirmar-venta">
      <span class="estado-venta ${confirmada ? 'si' : 'no'}">${icono(confirmada ? 'confirmar' : 'cancelar')} ${confirmada ? 'Confirmada' : 'No confirmada'}</span>
      <button type="button" class="enlace" data-cambiar="${venta.id}">Cambiar</button>
    </div>`;
}

// Cuántas ventas hay en cada grupo (para los botones de filtro)
function contarVentas(estado) {
  return ventas.filter(v => (v.confirmada || 'pendiente') === estado).length;
}

// La venta más reciente va primero
function renderizarVentas() {
  const cuerpo = document.getElementById('cuerpo-ventas');
  document.getElementById('btn-borrar-ventas').hidden = ventas.length === 0;

  // Números y botón activo de los filtros
  document.getElementById('cnt-todas').textContent = ventas.length;
  document.getElementById('cnt-pendiente').textContent = contarVentas('pendiente');
  document.getElementById('cnt-si').textContent = contarVentas('si');
  document.getElementById('cnt-no').textContent = contarVentas('no');
  document.querySelectorAll('[data-filtro-venta]').forEach(boton => {
    boton.classList.toggle('activo', boton.dataset.filtroVenta === filtroVentas);
  });

  if (ventas.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="5" class="tabla-vacia">Aún no hay ventas registradas.</td></tr>';
    return;
  }

  let html = '';
  for (let i = ventas.length - 1; i >= 0; i--) {
    const venta = ventas[i];
    const estado = venta.confirmada || 'pendiente';
    if (filtroVentas !== 'todas' && estado !== filtroVentas) continue;

    html += `
      <tr${estado === 'pendiente' ? ' class="fila-pendiente"' : ''}>
        <td data-etiqueta="Fecha">${escapar(formatearFechaHora(venta.fecha))}${Number(venta.id) > idVentaAntes ? ' <span class="marca-estado verde">Nuevo</span>' : ''}</td>
        <td data-etiqueta="Cliente">${textoCliente(venta.cliente)}</td>
        <td data-etiqueta="Detalle">${escapar(venta.detalle)}</td>
        <td data-etiqueta="Total"><strong>${dinero(venta.total)}</strong></td>
        <td data-etiqueta="Confirmación">${htmlConfirmacion(venta)}</td>
      </tr>`;
  }

  if (html === '') html = '<tr><td colspan="5" class="tabla-vacia">No hay ventas en este grupo.</td></tr>';
  cuerpo.innerHTML = html;
}

function renderizarAjustes() {
  document.getElementById('c-telefono').value = tienda.telefono;
  document.getElementById('c-correo').value = tienda.correo;
  document.getElementById('lbl-modo').textContent = nombreModo();
  document.getElementById('bloque-token').hidden = modo !== 'github';
  document.getElementById('nota-servidor').hidden = modo !== 'servidor';
  document.getElementById('txt-token').value = leerToken();
}


// Productos

function llenarCategorias() {
  document.getElementById('p-categoria').innerHTML = CATEGORIAS.map(c => '<option value="' + c + '">' + c + '</option>').join('');
}

async function guardarProducto(e) {
  e.preventDefault();

  const nombre = document.getElementById('p-nombre').value.trim();
  const precio = Number(document.getElementById('p-precio').value);
  const stock = Number(document.getElementById('p-stock').value);

  if (nombre === '' || !(precio > 0) || stock < 0 || stock % 1 !== 0) {
    avisar('Revisa los datos: escribe un nombre, un precio mayor a 0 y un stock válido.');
    return;
  }
  if (!puedeGuardar()) {
    if (modo === 'servidor') prepararAdmin(); else avisarSinPermiso();
    return;
  }

  const datos = {
    nombre: nombre,
    precio: precio,
    stock: stock,
    categoria: document.getElementById('p-categoria').value,
    tamano: document.getElementById('p-tamano').value.trim(),
    sabor: document.getElementById('p-sabor').value.trim(),
    vencimiento: document.getElementById('p-vencimiento').value,
    descripcion: document.getElementById('p-descripcion').value.trim(),
    receta: document.getElementById('p-receta').value.trim(),
    imagen: imagenNueva
  };

  const boton = document.getElementById('btn-guardar');
  boton.disabled = true;
  const r = await guardarProductoBD(datos, idEditando);
  boton.disabled = false;

  if (!r.ok) {
    avisarError(r.error);
    return;
  }

  avisar(idEditando === null ? 'Producto agregado.' : 'Cambios guardados.');
  limpiarFormulario();
  renderizarAdmin();
}

// Pasa los datos de un producto al formulario para editarlo
function editarProducto(id) {
  const prod = buscarProducto(id);
  if (!prod) return;

  idEditando = id;
  document.getElementById('p-nombre').value = prod.nombre;
  document.getElementById('p-precio').value = prod.precio;
  document.getElementById('p-stock').value = prod.stock;
  document.getElementById('p-categoria').value = prod.categoria;
  document.getElementById('p-tamano').value = prod.tamano;
  document.getElementById('p-sabor').value = prod.sabor;
  document.getElementById('p-vencimiento').value = prod.vencimiento;
  document.getElementById('p-descripcion').value = prod.descripcion;
  document.getElementById('p-receta').value = prod.receta;

  imagenNueva = prod.imagen;
  document.getElementById('p-imagen').value = '';
  mostrarVistaPrevia();

  document.getElementById('titulo-form').textContent = 'Editar producto';
  document.getElementById('btn-guardar').innerHTML = icono('check') + ' Guardar cambios';
  document.getElementById('btn-cancelar').hidden = false;
  document.getElementById('form-producto').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function limpiarFormulario() {
  idEditando = null;
  document.getElementById('form-producto').reset();
  document.getElementById('p-categoria').value = CATEGORIAS[0];

  imagenNueva = '';
  mostrarVistaPrevia();

  document.getElementById('titulo-form').textContent = 'Agregar producto';
  document.getElementById('btn-guardar').innerHTML = icono('mas') + ' Agregar';
  document.getElementById('btn-cancelar').hidden = true;
}

async function eliminarProducto(id) {
  const prod = buscarProducto(id);
  if (!prod) return;
  if (!puedeGuardar()) {
    if (modo === 'servidor') prepararAdmin(); else avisarSinPermiso();
    return;
  }

  if (!confirm('¿Eliminar "' + prod.nombre + '" del inventario?')) return;

  const r = await eliminarProductoBD(id);
  if (!r.ok) {
    avisarError(r.error);
    return;
  }
  if (idEditando === id) limpiarFormulario();
  renderizarAdmin();
  avisar('Producto eliminado.');
}

// Guarda la respuesta de "¿Venta confirmada?" (si / no) en la base de datos
async function confirmarVenta(id, estado, contenedor) {
  if (!puedeGuardar()) {
    if (modo === 'servidor') prepararAdmin(); else avisarSinPermiso();
    return;
  }

  // Se bloquean los botones mientras se guarda
  contenedor.querySelectorAll('button').forEach(b => { b.disabled = true; });

  const r = await confirmarVentaBD(id, estado);
  if (!r.ok) {
    avisarError(r.error);
    renderizarVentas();
    return;
  }

  ventasCambiando.delete(id);
  avisar(estado === 'si' ? 'Venta confirmada.' : 'Venta marcada como no confirmada.');
  renderizarResumen();
  renderizarGrafico();
  renderizarVentas();
}

async function borrarHistorial() {
  if (ventas.length === 0) return;
  if (!puedeGuardar()) {
    if (modo === 'servidor') prepararAdmin(); else avisarSinPermiso();
    return;
  }

  if (!confirm('¿Seguro que quieres borrar todo el historial de ventas?')) return;

  const r = await borrarVentasBD();
  if (!r.ok) {
    avisarError(r.error);
    return;
  }
  renderizarAdmin();
}


// Imagen del producto

// Lee la imagen y la reduce a 400 px como máximo para que ocupe poco
function elegirImagen() {
  const archivo = document.getElementById('p-imagen').files[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = function() {
    const imagen = new Image();
    imagen.onload = function() {
      const escala = Math.min(1, 400 / Math.max(imagen.width, imagen.height));
      const ancho = Math.round(imagen.width * escala);
      const alto = Math.round(imagen.height * escala);

      const lienzo = document.createElement('canvas');
      lienzo.width = ancho;
      lienzo.height = alto;

      const pincel = lienzo.getContext('2d');
      pincel.fillStyle = 'white';
      pincel.fillRect(0, 0, ancho, alto);
      pincel.drawImage(imagen, 0, 0, ancho, alto);

      imagenNueva = lienzo.toDataURL('image/jpeg', 0.75);
      mostrarVistaPrevia();
    };
    imagen.onerror = function() { avisar('No se pudo leer esa imagen.'); };
    imagen.src = lector.result;
  };
  lector.readAsDataURL(archivo);
}

function mostrarVistaPrevia() {
  const vista = document.getElementById('p-vista');
  const boton = document.getElementById('btn-quitar-imagen');

  if (imagenNueva !== '') {
    vista.src = imagenNueva;
    vista.hidden = false;
    boton.hidden = false;
  } else {
    vista.removeAttribute('src');
    vista.hidden = true;
    boton.hidden = true;
  }
}

function quitarImagen() {
  imagenNueva = '';
  document.getElementById('p-imagen').value = '';
  mostrarVistaPrevia();
}


// Ventas nuevas


const CLAVE_VENTA_VISTA = 'kioscoAna_ultima_venta_vista';
let idVentaVista = 0;    
let idVentaAntes = 0;    

function ultimaVentaId() {
  let mayor = 0;
  ventas.forEach(v => { if (Number(v.id) > mayor) mayor = Number(v.id); });
  return mayor;
}

function guardarVentaVista(id) {
  try { localStorage.setItem(CLAVE_VENTA_VISTA, String(id)); } catch (e) {}
}

function iniciarVentasVistas() {
  const ultima = ultimaVentaId();
  let vista = ultima;   // la primera vez no se marca nada como nuevo
  try {
    const guardado = localStorage.getItem(CLAVE_VENTA_VISTA);
    if (guardado !== null) vista = Math.min(Number(guardado) || 0, ultima);
  } catch (e) {}

  idVentaVista = vista;
  idVentaAntes = vista;
  guardarVentaVista(vista);

  if (!document.getElementById('pest-ventas').hidden) registrarVentasVistas();
}

// Da por vistas todas las ventas que hay ahora
function registrarVentasVistas() {
  idVentaVista = ultimaVentaId();
  guardarVentaVista(idVentaVista);
  actualizarInsigniaVentas();
}

function actualizarInsigniaVentas() {
  const insignia = document.getElementById('insignia-ventas');
  if (!insignia) return;
  const nuevas = ventas.filter(v => Number(v.id) > idVentaVista).length;
  insignia.textContent = nuevas > 99 ? '99+' : nuevas;
  insignia.hidden = nuevas === 0;
}

let revisandoVentas = false;

async function revisarVentasNuevas() {
  if (revisandoVentas || modo !== 'servidor' || !haySesionAdmin() || document.hidden) return;
  if (location.hash.indexOf('#/admin') !== 0) return;

  revisandoVentas = true;
  try {
    const ultimaAntes = ultimaVentaId();
    const errorAntes = errorCarga;
    await cargarDatos();
    if (errorAntes === '') errorCarga = '';   // un fallo de conexión pasajero no daña la tienda

    const nuevas = ventas.filter(v => Number(v.id) > ultimaAntes);
    if (nuevas.length === 1) {
      const c = nuevas[0].cliente || {};
      avisar('Nuevo pedido' + (c.nombre ? ' de ' + c.nombre : '') + ': ' + dinero(nuevas[0].total));
    } else if (nuevas.length > 1) {
      avisar(nuevas.length + ' pedidos nuevos.');
    }

    if (haySesionAdmin()) {
      if (!document.getElementById('pest-ventas').hidden) registrarVentasVistas();
      renderizarResumen();
      renderizarGrafico();
      renderizarInventarioAdmin();
      renderizarVentas();
      actualizarInsigniaVentas();
    }
  } finally {
    revisandoVentas = false;
  }
}


// Ajustes

async function guardarContacto(e) {
  e.preventDefault();
  if (!puedeGuardar()) {
    if (modo === 'servidor') prepararAdmin(); else avisarSinPermiso();
    return;
  }

  const r = await guardarContactoBD(
    document.getElementById('c-telefono').value.trim(),
    document.getElementById('c-correo').value.trim()
  );
  if (!r.ok) {
    avisarError(r.error);
    return;
  }

  if (typeof actualizarPie === 'function') actualizarPie();
  avisar('Datos de contacto guardados.');
}

// Guarda el token y vuelve a leer KioscoAna.db con él
async function conectarGithub(e) {
  e.preventDefault();
  const token = document.getElementById('txt-token').value.trim();
  if (token === '') {
    avisar('Pega primero el token de GitHub.');
    return;
  }

  guardarToken(token);
  avisarEstado('Conectando con GitHub...', 'info');
  await cargarDatos();
  if (baseLista) mostrarEstadoInicial();
  renderizarAdmin();
}

function quitarToken() {
  guardarToken('');
  baseLista = false;
  document.getElementById('txt-token').value = '';
  avisarEstado('Token quitado. Solo lectura.', 'aviso');
}


// Eventos

function iniciarAdmin() {
  llenarCategorias();
  limpiarFormulario();

  // Cada 20 segundos se revisa si algún cliente hizo un pedido
  setInterval(revisarVentasNuevas, 20000);

  document.getElementById('form-login').addEventListener('submit', entrarAdmin);
  document.getElementById('btn-salir').addEventListener('click', cerrarSesionAdmin);

  document.querySelectorAll('.pestanas button').forEach(boton => {
    boton.addEventListener('click', function() { mostrarPestana(boton.dataset.pestana); });
  });

  document.getElementById('form-producto').addEventListener('submit', guardarProducto);
  document.getElementById('btn-cancelar').addEventListener('click', limpiarFormulario);
  document.getElementById('p-imagen').addEventListener('change', elegirImagen);
  document.getElementById('btn-quitar-imagen').addEventListener('click', quitarImagen);
  document.getElementById('txt-buscar-admin').addEventListener('input', renderizarInventarioAdmin);

  document.getElementById('cuerpo-inventario').addEventListener('click', function(e) {
    const editar = e.target.closest('[data-editar]');
    const eliminar = e.target.closest('[data-eliminar]');
    if (editar) editarProducto(Number(editar.dataset.editar));
    if (eliminar) eliminarProducto(Number(eliminar.dataset.eliminar));
  });

  document.getElementById('btn-borrar-ventas').addEventListener('click', borrarHistorial);

  // Botones Sí / No y "Cambiar" de cada venta
  document.getElementById('cuerpo-ventas').addEventListener('click', function(e) {
    const respuesta = e.target.closest('[data-confirmar]');
    const cambiar = e.target.closest('[data-cambiar]');
    if (respuesta) {
      confirmarVenta(Number(respuesta.dataset.confirmar), respuesta.dataset.valor, respuesta.parentElement);
    }
    if (cambiar) {
      ventasCambiando.add(Number(cambiar.dataset.cambiar));
      renderizarVentas();
    }
  });

  // Filtro: todas, pendientes, confirmadas, no confirmadas
  document.getElementById('filtros-venta').addEventListener('click', function(e) {
    const boton = e.target.closest('[data-filtro-venta]');
    if (!boton) return;
    filtroVentas = boton.dataset.filtroVenta;
    renderizarVentas();
  });
  document.getElementById('form-contacto').addEventListener('submit', guardarContacto);
  document.getElementById('form-token').addEventListener('submit', conectarGithub);
  document.getElementById('btn-quitar-token').addEventListener('click', quitarToken);
}
