// Datos de la tienda y conexión con la base de datos (KioscoAna.db).

// La web guarda sus datos de tres formas, según donde esté abierta:

// Datos del repositorio, solo se usan en GitHub Pages
const GITHUB_DUENO = 'enocyesmer-cmd';
const GITHUB_REPO = 'KioscoAna';
const GITHUB_ARCHIVO = 'KioscoAna.db';
const CLAVE_TOKEN = 'kioscoAna_token';
const CLAVE_TOKEN_ADMIN = 'kioscoAna_token_admin';
const CLAVE_LOCAL = 'kioscoAna_datos_local';

const CATEGORIAS = ['Frescos', 'Repostería', 'Chiverías'];


// Fechas y textos


function fechaATexto(fecha) {
  const mes = ('0' + (fecha.getMonth() + 1)).slice(-2);
  const dia = ('0' + fecha.getDate()).slice(-2);
  return fecha.getFullYear() + '-' + mes + '-' + dia;
}

function fechaHoy() {
  return fechaATexto(new Date());
}

// Fecha y hora para guardar una venta: 2026-10-12 14:30
function fechaHoraActual() {
  const ahora = new Date();
  const hora = ('0' + ahora.getHours()).slice(-2);
  const minuto = ('0' + ahora.getMinutes()).slice(-2);
  return fechaATexto(ahora) + ' ' + hora + ':' + minuto;
}

// 2026-10-12 pasa a 12/10/2026
function formatearFecha(texto) {
  if (!texto) return 'No aplica';
  const partes = texto.slice(0, 10).split('-');
  if (partes.length !== 3) return texto;
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function formatearFechaHora(texto) {
  return formatearFecha(texto) + (texto.length > 10 ? ' ' + texto.slice(11) : '');
}

function dinero(numero) {
  return 'C$ ' + Number(numero || 0).toFixed(2);
}

// Evita que el texto se interprete como HTML
function escapar(texto) {
  return String(texto === undefined || texto === null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// Datos en memoria

class Producto {
  constructor(id, nombre, precio, stock, categoria, tamano, sabor, vencimiento, descripcion, receta, imagen) {
    this.id = Number(id);
    this.nombre = nombre || '';
    this.precio = Number(precio) || 0;
    this.stock = Number(stock) || 0;
    this.categoria = categoria || CATEGORIAS[0];
    this.tamano = tamano || '';
    this.sabor = sabor || '';
    this.vencimiento = vencimiento || '';
    this.descripcion = descripcion || '';
    this.receta = receta || '';
    this.imagen = imagen || '';
  }
}

let inventario = [];
let ventas = [];
let tienda = { telefono: '', correo: '' };

let modo = '';             // 'servidor', 'github' o 'local'
let baseLista = false;     
let errorCarga = '';       
let bytesDB = null;        
let shaDB = '';            
let libSql = null;         // librería SQLite del navegador
let enviando = false;
let envioPendiente = false;

// La página define estas dos funciones para mostrar el estado y avisar si venció la sesión
let alCambiarEstado = function(texto, tipo) {};
let alVencerSesion = function() {};

function avisarEstado(texto, tipo) {
  alCambiarEstado(texto, tipo || 'info');
}

function estaVencido(prod) {
  return prod.vencimiento !== '' && prod.vencimiento < fechaHoy();
}

function aplicarDatos(datos) {
  const lista = Array.isArray(datos.inventario) ? datos.inventario : [];
  inventario = lista.map(p => new Producto(p.id, p.nombre, p.precio, p.stock, p.categoria, p.tamano, p.sabor, p.vencimiento, p.descripcion, p.receta, p.imagen));
  ventas = Array.isArray(datos.ventas) ? datos.ventas : [];
  const conf = datos.config || {};
  tienda = { telefono: conf.telefono || '', correo: conf.correo || '' };
}


// Sesión y token

function leerToken() {
  try { return localStorage.getItem(CLAVE_TOKEN) || ''; } catch (e) { return ''; }
}

function guardarToken(token) {
  try {
    if (token === '') localStorage.removeItem(CLAVE_TOKEN);
    else localStorage.setItem(CLAVE_TOKEN, token);
  } catch (e) {}
}

// Token de la sesión del administrador en el servidor
function leerTokenAdmin() {
  try { return sessionStorage.getItem(CLAVE_TOKEN_ADMIN) || ''; } catch (e) { return ''; }
}

function guardarTokenAdmin(token) {
  try {
    if (token === '') sessionStorage.removeItem(CLAVE_TOKEN_ADMIN);
    else sessionStorage.setItem(CLAVE_TOKEN_ADMIN, token);
  } catch (e) {}
}

// Indica si este navegador puede escribir en la base
function puedeGuardar() {
  if (modo === 'servidor') return leerTokenAdmin() !== '';
  if (modo === 'local') return true;
  return leerToken() !== '' && baseLista;
}

function nombreModo() {
  if (modo === 'servidor') return 'Servidor (Render o npm start)';
  if (modo === 'github') return 'GitHub (KioscoAna.db en el repositorio)';
  return 'Solo este navegador (prueba)';
}


// Servidor (Render o npm start)

// Llamada a la API. Devuelve { ok, status, datos }
async function api(metodo, ruta, cuerpo, comoAdmin) {
  const cabeceras = { 'Content-Type': 'application/json' };
  if (comoAdmin) cabeceras['Authorization'] = 'Bearer ' + leerTokenAdmin();

  const respuesta = await fetch(ruta, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: 'no-store'
  });

  let datos = {};
  try { datos = await respuesta.json(); } catch (e) {}

  if (comoAdmin && respuesta.status === 401) {
    guardarTokenAdmin('');
    alVencerSesion();
  }
  return { ok: respuesta.ok, status: respuesta.status, datos: datos };
}

// Entra como administrador en el servidor
async function iniciarSesionServidor(clave) {
  try {
    const r = await api('POST', '/api/login', { clave: clave });
    if (!r.ok) return { ok: false, error: r.datos.error || 'No se pudo entrar.' };
    guardarTokenAdmin(r.datos.token);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
}

function cerrarSesionServidor() {
  guardarTokenAdmin('');
}

// Lee los datos del servidor. Devuelve false si esta página no tiene servidor.
async function cargarDeServidor() {
  let respuesta;
  try {
    respuesta = await fetch('/api/productos', { cache: 'no-store' });
  } catch (e) {
    // Sin conexión: se asume servidor para mostrar el error en vez de una tienda vacía
    modo = 'servidor';
    errorCarga = 'No se pudo conectar con el servidor.';
    return true;
  }

  const tipo = respuesta.headers.get('content-type') || '';
  if (respuesta.status >= 500) {
    modo = 'servidor';
    errorCarga = 'El servidor no respondió bien. Intenta de nuevo en un momento.';
    return true;
  }
  if (!respuesta.ok || tipo.indexOf('json') === -1) return false;

  modo = 'servidor';
  baseLista = true;
  errorCarga = '';
  let datos = await respuesta.json();

  // El administrador ve también las ventas
  if (leerTokenAdmin() !== '') {
    const r = await api('GET', '/api/admin/datos', undefined, true);
    if (r.ok) datos = r.datos;
  }
  aplicarDatos(datos);
  return true;
}


// SQLite en el navegador (modo github)

function cargarLibSql() {
  if (libSql) return Promise.resolve(libSql);

  return new Promise(function(resolver, rechazar) {
    const script = document.createElement('script');
    script.src = 'lib/sql-wasm.js';
    script.onload = function() {
      initSqlJs({ locateFile: function(archivo) { return 'lib/' + archivo; } })
        .then(function(SQL) { libSql = SQL; resolver(SQL); })
        .catch(rechazar);
    };
    script.onerror = function() {
      rechazar(new Error('No se pudo cargar lib/sql-wasm.js. Revisa que la carpeta lib esté subida.'));
    };
    document.head.appendChild(script);
    setTimeout(function() { rechazar(new Error('La librería SQLite tardó demasiado en cargar.')); }, 15000);
  });
}

// Crea las tablas si no existen, sin borrar nada
function prepararTablas(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS Productos (
      id_productos INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      stock INTEGER NOT NULL,
      categorias TEXT NOT NULL,
      tamano TEXT NOT NULL DEFAULT '',
      sabor TEXT NOT NULL DEFAULT '',
      vencimiento TEXT NOT NULL DEFAULT '',
      descripcion TEXT NOT NULL DEFAULT '',
      receta TEXT NOT NULL DEFAULT '',
      imagen TEXT NOT NULL DEFAULT ''
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS Ventas (
      id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      detalle TEXT NOT NULL,
      total REAL NOT NULL,
      cliente TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS Config (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL DEFAULT ''
    )
  `);
}

function leerFilas(db, sql) {
  const filas = [];
  const consulta = db.prepare(sql);
  while (consulta.step()) filas.push(consulta.getAsObject());
  consulta.free();
  return filas;
}

// Pasa el contenido de KioscoAna.db a las variables
function leerDatosDeDB(bytes) {
  const db = new libSql.Database(bytes);
  try {
    prepararTablas(db);

    const productos = leerFilas(db, `
      SELECT id_productos AS id, nombre, precio, stock, categorias AS categoria,
             tamano, sabor, vencimiento, descripcion, receta, imagen
      FROM Productos ORDER BY id_productos
    `);

    const listaVentas = leerFilas(db, 'SELECT id_venta AS id, fecha, detalle, total, cliente FROM Ventas ORDER BY id_venta').map(v => {
      let cliente = {};
      try { cliente = JSON.parse(v.cliente || '{}'); } catch (e) {}
      return { id: v.id, fecha: v.fecha, detalle: v.detalle, total: v.total, cliente: cliente };
    });

    const config = {};
    leerFilas(db, 'SELECT clave, valor FROM Config').forEach(f => { config[f.clave] = f.valor; });

    aplicarDatos({ inventario: productos, ventas: listaVentas, config: config });
  } finally {
    db.close();
  }
}

// Escribe los datos en KioscoAna.db y devuelve el archivo nuevo
function crearBytesDB(bytesActuales) {
  const db = bytesActuales ? new libSql.Database(bytesActuales) : new libSql.Database();
  try {
    prepararTablas(db);

    db.run('BEGIN');
    try {
      db.run('DELETE FROM Productos');
      const insertarProducto = db.prepare(`
        INSERT INTO Productos
        (id_productos, nombre, precio, stock, categorias, tamano, sabor, vencimiento, descripcion, receta, imagen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      inventario.forEach(p => {
        insertarProducto.run([
          Number(p.id), String(p.nombre), Number(p.precio), Number(p.stock),
          String(p.categoria), String(p.tamano), String(p.sabor),
          String(p.vencimiento), String(p.descripcion), String(p.receta), String(p.imagen)
        ]);
      });
      insertarProducto.free();

      db.run('DELETE FROM Ventas');
      const insertarVenta = db.prepare('INSERT INTO Ventas (fecha, detalle, total, cliente) VALUES (?, ?, ?, ?)');
      ventas.forEach(v => {
        insertarVenta.run([String(v.fecha || ''), String(v.detalle || ''), Number(v.total || 0), JSON.stringify(v.cliente || {})]);
      });
      insertarVenta.free();

      db.run('DELETE FROM Config');
      db.run('INSERT INTO Config (clave, valor) VALUES (?, ?)', ['telefono', String(tienda.telefono || '')]);
      db.run('INSERT INTO Config (clave, valor) VALUES (?, ?)', ['correo', String(tienda.correo || '')]);

      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    db.run('VACUUM');
    return db.export();
  } finally {
    db.close();
  }
}


// GitHub (modo github)


function datosRepositorio() {
  let dueno = GITHUB_DUENO;
  let repo = GITHUB_REPO;
  if (location.hostname.endsWith('.github.io')) {
    dueno = location.hostname.split('.')[0];
    const primera = location.pathname.split('/')[1];
    if (primera && primera.indexOf('.') === -1) repo = primera;
  }
  return { dueno: dueno, repo: repo };
}

function urlArchivoGithub() {
  const r = datosRepositorio();
  return 'https://api.github.com/repos/' + r.dueno + '/' + r.repo + '/contents/' + GITHUB_ARCHIVO;
}

function cabecerasGithub(tipo) {
  return {
    'Accept': tipo || 'application/vnd.github+json',
    'Authorization': 'Bearer ' + leerToken()
  };
}

// Pide la versión (sha) del archivo. Devuelve '' si no existe.
async function pedirShaGithub() {
  const respuesta = await fetch(urlArchivoGithub() + '?t=' + Date.now(), {
    headers: cabecerasGithub(),
    cache: 'no-store'
  });
  if (respuesta.status === 404) return '';
  if (respuesta.status === 401) throw new Error('El token no es válido o venció.');
  if (!respuesta.ok) throw new Error('GitHub respondió ' + respuesta.status);
  const datos = await respuesta.json();
  return datos.sha;
}

async function leerDBConToken() {
  shaDB = await pedirShaGithub();
  if (shaDB === '') return null;

  const respuesta = await fetch(urlArchivoGithub() + '?t=' + Date.now(), {
    headers: cabecerasGithub('application/vnd.github.raw+json'),
    cache: 'no-store'
  });
  if (!respuesta.ok) throw new Error('No se pudo descargar KioscoAna.db (' + respuesta.status + ')');
  return new Uint8Array(await respuesta.arrayBuffer());
}

// Los clientes leen el archivo desde la propia web
async function leerDBDePagina() {
  const respuesta = await fetch(GITHUB_ARCHIVO + '?t=' + Date.now(), { cache: 'no-store' });
  if (!respuesta.ok) return null;
  return new Uint8Array(await respuesta.arrayBuffer());
}

function bytesABase64(bytes) {
  let texto = '';
  const trozo = 8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    texto += String.fromCharCode.apply(null, bytes.subarray(i, i + trozo));
  }
  return btoa(texto);
}

async function subirArchivoGithub(bytes) {
  const cuerpo = {
    message: 'Actualizar KioscoAna.db desde la web',
    content: bytesABase64(bytes)
  };
  if (shaDB !== '') cuerpo.sha = shaDB;

  return fetch(urlArchivoGithub(), {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cabecerasGithub()),
    body: JSON.stringify(cuerpo)
  });
}

async function guardarEnGithub() {
  await cargarLibSql();
  const bytesNuevos = crearBytesDB(bytesDB);

  let respuesta = await subirArchivoGithub(bytesNuevos);

  // Si el archivo cambió en GitHub, se pide la versión nueva y se repite
  if (respuesta.status === 409 || respuesta.status === 422) {
    shaDB = await pedirShaGithub();
    respuesta = await subirArchivoGithub(bytesNuevos);
  }

  if (respuesta.status === 401) throw new Error('El token no es válido o venció.');
  if (respuesta.status === 403 || respuesta.status === 404) {
    throw new Error('El token no tiene permiso de escritura en el repositorio (Contents: Read and write).');
  }
  if (!respuesta.ok) throw new Error('GitHub respondió ' + respuesta.status);

  const datos = await respuesta.json();
  shaDB = datos.content.sha;
  bytesDB = bytesNuevos;
}


// Cargar

// Lee los datos. Se llama al abrir la página y al entrar a la administración.
async function cargarDatos() {
  // 1. Servidor (Render o npm start). En github.io no hay servidor, ni se intenta.
  if ((modo === '' || modo === 'servidor') && !location.hostname.endsWith('.github.io') && location.protocol !== 'file:') {
    if (await cargarDeServidor()) return;
  }

  // 2. Abierta con doble clic: solo el navegador
  if (location.protocol === 'file:') {
    modo = 'local';
    baseLista = true;
    try {
      const guardado = localStorage.getItem(CLAVE_LOCAL);
      if (guardado) aplicarDatos(JSON.parse(guardado));
    } catch (e) {}
    return;
  }

  // 3. Web estática (GitHub Pages): se lee KioscoAna.db
  modo = 'github';
  baseLista = false;
  errorCarga = '';
  try {
    await cargarLibSql();
    const hayToken = leerToken() !== '';
    const bytes = hayToken ? await leerDBConToken() : await leerDBDePagina();

    if (bytes === null) {
      // Todavía no existe KioscoAna.db: el primer guardado la crea
      bytesDB = null;
      aplicarDatos({});
      baseLista = hayToken;
      return;
    }

    bytesDB = bytes;
    leerDatosDeDB(bytes);
    baseLista = true;
  } catch (error) {
    console.error('No se pudo leer KioscoAna.db:', error);
    errorCarga = 'No se pudo leer la base de datos.';
    avisarEstado('No se pudo leer KioscoAna.db: ' + error.message, 'error');
  }
}




// Devuelve false si este navegador no puede guardar
function guardarDatos() {
  if (modo === 'local') {
    try {
      localStorage.setItem(CLAVE_LOCAL, JSON.stringify({ inventario: inventario, ventas: ventas, config: tienda }));
    } catch (e) { return false; }
    return true;
  }

  if (!puedeGuardar()) return false;
  pedirGuardado();
  return true;
}

// Se guarda de a uno; si llegan cambios mientras tanto, se repite al terminar
function pedirGuardado() {
  if (enviando) { envioPendiente = true; return; }

  enviando = true;
  avisarEstado('Guardando en KioscoAna.db...', 'info');

  guardarEnGithub()
    .then(function() {
      avisarEstado('Guardado en KioscoAna.db. La web pública se actualiza en 1 o 2 minutos.', 'ok');
    })
    .catch(function(error) {
      console.error('Error al guardar:', error);
      avisarEstado('NO se guardó: ' + error.message, 'error');
    })
    .then(function() {
      enviando = false;
      if (envioPendiente) {
        envioPendiente = false;
        pedirGuardado();
      }
    });
}

window.addEventListener('beforeunload', function(evento) {
  if (enviando || envioPendiente) {
    evento.preventDefault();
    evento.returnValue = '';
  }
});


// Operaciones de la administración (funcionan en los tres modos)

function resultadoError(error) {
  return { ok: false, error: error };
}

// Ejecuta una acción del administrador en el servidor y vuelve a leer los datos
async function accionServidor(metodo, ruta, cuerpo) {
  try {
    const r = await api(metodo, ruta, cuerpo, true);
    if (!r.ok) return resultadoError(r.datos.error || 'El servidor respondió ' + r.status);
    await cargarDatos();
    return { ok: true };
  } catch (e) {
    return resultadoError('No se pudo conectar con el servidor.');
  }
}

// Agrega un producto (id null) o cambia uno existente
async function guardarProductoBD(datos, id) {
  if (modo === 'servidor') {
    return accionServidor(id === null ? 'POST' : 'PUT', '/api/admin/productos' + (id === null ? '' : '/' + id), datos);
  }

  if (!puedeGuardar()) return resultadoError('No se puede guardar todavía.');
  if (id === null) {
    let nuevoId = 1;
    inventario.forEach(p => { if (p.id >= nuevoId) nuevoId = p.id + 1; });
    inventario.push(new Producto(nuevoId, datos.nombre, datos.precio, datos.stock, datos.categoria, datos.tamano, datos.sabor, datos.vencimiento, datos.descripcion, datos.receta, datos.imagen));
  } else {
    const prod = inventario.find(p => p.id === id);
    if (!prod) return resultadoError('El producto no existe.');
    Object.assign(prod, datos);
  }
  return guardarDatos() ? { ok: true } : resultadoError('No se pudo guardar.');
}

async function eliminarProductoBD(id) {
  if (modo === 'servidor') return accionServidor('DELETE', '/api/admin/productos/' + id);

  if (!puedeGuardar()) return resultadoError('No se puede guardar todavía.');
  inventario = inventario.filter(p => p.id !== id);
  return guardarDatos() ? { ok: true } : resultadoError('No se pudo guardar.');
}

async function guardarContactoBD(telefono, correo) {
  if (modo === 'servidor') return accionServidor('PUT', '/api/admin/config', { telefono: telefono, correo: correo });

  if (!puedeGuardar()) return resultadoError('No se puede guardar todavía.');
  tienda = { telefono: telefono, correo: correo };
  return guardarDatos() ? { ok: true } : resultadoError('No se pudo guardar.');
}

async function borrarVentasBD() {
  if (modo === 'servidor') return accionServidor('DELETE', '/api/admin/ventas');

  if (!puedeGuardar()) return resultadoError('No se puede guardar todavía.');
  ventas = [];
  return guardarDatos() ? { ok: true } : resultadoError('No se pudo guardar.');
}


// Pedido del cliente (funciona en los tres modos)

async function registrarPedidoBD(cliente, pedido) {
  if (modo === 'servidor') {
    try {
      const r = await api('POST', '/api/pedidos', { cliente: cliente, items: pedido });
      await cargarDatos();
      if (r.ok) return { ok: true, total: r.datos.total, lineas: r.datos.lineas, guardado: true };
      return { ok: false, problemas: r.datos.problemas || [r.datos.error || 'No se pudo registrar el pedido.'] };
    } catch (e) {
      return { ok: false, problemas: ['No se pudo conectar con el servidor.'] };
    }
  }

  // GitHub o local: se vuelve a leer para tener el stock al día
  await cargarDatos();

  const problemas = [];
  pedido.forEach(item => {
    const prod = inventario.find(p => p.id === item.id);
    if (!prod || prod.stock <= 0 || estaVencido(prod)) problemas.push((prod ? prod.nombre : 'Un producto') + ' ya no está disponible.');
    else if (item.cantidad > prod.stock) problemas.push('De ' + prod.nombre + ' solo quedan ' + prod.stock + '.');
  });
  if (problemas.length > 0) return { ok: false, problemas: problemas };

  let total = 0;
  const lineas = pedido.map(item => {
    const prod = inventario.find(p => p.id === item.id);
    prod.stock -= item.cantidad;
    total += prod.precio * item.cantidad;
    return { nombre: prod.nombre, cantidad: item.cantidad, subtotal: prod.precio * item.cantidad };
  });

  const detalle = lineas.map(l => l.cantidad + ' x ' + l.nombre).join(', ');
  ventas.push({ fecha: fechaHoraActual(), detalle: detalle, total: total, cliente: cliente });
  return { ok: true, total: total, lineas: lineas, guardado: guardarDatos() };
}
