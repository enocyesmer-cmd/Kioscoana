// Copia los datos de Render al archivo KioscoAna.db de esta computadora.
//
//   node sincronizar.js               copia una vez
//   node sincronizar.js --vigilar     copia cada minuto (deja la ventana abierta)
//   node sincronizar.js --restaurar   sube la base de esta computadora a Render
//
// Datos de conexión: archivo sincronizar.config.json o las variables
// RENDER_URL y ADMIN_CLAVE (ver LEEME.txt).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');

const ARCHIVO_DB = path.join(__dirname, 'KioscoAna.db');
const CARPETA_RESPALDOS = path.join(__dirname, 'respaldos');
const argumentos = process.argv.slice(2);

function leerConfiguracion() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(__dirname, 'sincronizar.config.json'), 'utf8'));
  } catch (e) {}

  const url = String(process.env.RENDER_URL || config.url || '').replace(/\/+$/, '');
  const clave = process.env.ADMIN_CLAVE || config.clave || '';
  if (!url || !clave) {
    console.error('Falta la dirección de Render o la clave.');
    console.error('Copia sincronizar.config.ejemplo.json como sincronizar.config.json y llénalo.');
    process.exit(1);
  }
  return { url: url, clave: clave };
}

const { url: URL_RENDER, clave: CLAVE } = leerConfiguracion();


// Base de datos local

const db = new DatabaseSync(ARCHIVO_DB);

db.exec(`
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
);
CREATE TABLE IF NOT EXISTS Ventas (
  id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  detalle TEXT NOT NULL,
  total REAL NOT NULL,
  cliente TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS Config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
`);

function leerLocal() {
  const inventario = db.prepare(`
    SELECT id_productos AS id, nombre, precio, stock, categorias AS categoria,
           tamano, sabor, vencimiento, descripcion, receta, imagen
    FROM Productos ORDER BY id_productos
  `).all();

  const ventas = db.prepare('SELECT id_venta AS id, fecha, detalle, total, cliente FROM Ventas ORDER BY id_venta').all().map(v => {
    let cliente = {};
    try { cliente = JSON.parse(v.cliente || '{}'); } catch (e) {}
    return { id: v.id, fecha: v.fecha, detalle: v.detalle, total: v.total, cliente: cliente };
  });

  const config = { telefono: '', correo: '' };
  db.prepare('SELECT clave, valor FROM Config').all().forEach(f => { config[f.clave] = f.valor; });

  return { inventario: inventario, ventas: ventas, config: config };
}

// Reemplaza el contenido local con los datos de Render
function escribirLocal(datos) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM Productos').run();
    const insertarProducto = db.prepare(`
      INSERT INTO Productos
      (id_productos, nombre, precio, stock, categorias, tamano, sabor, vencimiento, descripcion, receta, imagen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    datos.inventario.forEach(p => {
      insertarProducto.run(p.id, p.nombre, p.precio, p.stock, p.categoria, p.tamano || '', p.sabor || '',
        p.vencimiento || '', p.descripcion || '', p.receta || '', p.imagen || '');
    });

    db.prepare('DELETE FROM Ventas').run();
    const insertarVenta = db.prepare('INSERT INTO Ventas (id_venta, fecha, detalle, total, cliente) VALUES (?, ?, ?, ?, ?)');
    datos.ventas.forEach(v => {
      insertarVenta.run(v.id, v.fecha, v.detalle, v.total, JSON.stringify(v.cliente || {}));
    });

    db.prepare('DELETE FROM Config').run();
    const insertarConfig = db.prepare('INSERT INTO Config (clave, valor) VALUES (?, ?)');
    insertarConfig.run('telefono', (datos.config && datos.config.telefono) || '');
    insertarConfig.run('correo', (datos.config && datos.config.correo) || '');

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Hora de arranque de Render que se vio la última vez. Si cambia, Render se reinició.
const ARCHIVO_INICIO = path.join(CARPETA_RESPALDOS, 'inicio_render.txt');

function leerInicioConocido() {
  try { return fs.readFileSync(ARCHIVO_INICIO, 'utf8').trim(); } catch (e) { return ''; }
}

function guardarInicioConocido(inicio) {
  if (!inicio) return;
  fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  fs.writeFileSync(ARCHIVO_INICIO, String(inicio));
}

// Una copia de la base por día, antes de cambiarla (se guardan las últimas 14)
function hacerRespaldo() {
  const hoy = new Date().toISOString().slice(0, 10);
  const destino = path.join(CARPETA_RESPALDOS, 'KioscoAna-' + hoy + '.db');
  if (fs.existsSync(destino) || !fs.existsSync(ARCHIVO_DB)) return;

  fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  fs.copyFileSync(ARCHIVO_DB, destino);

  const viejos = fs.readdirSync(CARPETA_RESPALDOS).filter(n => n.endsWith('.db')).sort().slice(0, -14);
  viejos.forEach(n => fs.unlinkSync(path.join(CARPETA_RESPALDOS, n)));
}


// Llamadas a Render

async function llamar(metodo, ruta, cuerpo, token) {
  const respuesta = await fetch(URL_RENDER + ruta, {
    method: metodo,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    // Render gratis puede tardar cerca de un minuto en despertar
    signal: AbortSignal.timeout(120000)
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(datos.error || 'Render respondió ' + respuesta.status);
  return datos;
}

async function iniciarSesion() {
  const r = await llamar('POST', '/api/login', { clave: CLAVE });
  return r.token;
}

function resumen(datos) {
  return datos.inventario.length + ' productos y ' + datos.ventas.length + ' ventas';
}

function estaVacio(datos) {
  const c = datos.config || {};
  return datos.inventario.length === 0 && datos.ventas.length === 0 && !c.telefono && !c.correo;
}

function preguntar(texto) {
  const interfaz = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolver => interfaz.question(texto, r => { interfaz.close(); resolver(r.trim().toLowerCase()); }));
}


// Acciones

async function restaurar(token, confirmar) {
  const local = leerLocal();
  if (confirmar) {
    const r = await preguntar('Se reemplazará lo que hay en Render por lo de esta computadora (' + resumen(local) + '). ¿Continuar? (s/n) ');
    if (r !== 's' && r !== 'si') { console.log('Cancelado.'); return; }
  }
  const resultado = await llamar('PUT', '/api/admin/restaurar', local, token);
  console.log('Render restaurado: ' + resultado.productos + ' productos y ' + resultado.ventas + ' ventas.');
  const despues = await llamar('GET', '/api/admin/datos', null, token);
  guardarInicioConocido(despues.inicio);
}

async function sincronizar() {
  const token = await iniciarSesion();
  const remoto = await llamar('GET', '/api/admin/datos', null, token);
  const local = leerLocal();
  const hayLocal = local.inventario.length > 0 || local.ventas.length > 0;

  // Render sin nada pero con datos aquí: probablemente Render se reinició y perdió los archivos.
  // Como Render ahora arranca con los productos iniciales, un reinicio también se nota
  // porque cambia la hora de arranque del servidor.
  const inicioConocido = leerInicioConocido();
  const seReinicio = inicioConocido !== '' && !!remoto.inicio && remoto.inicio !== inicioConocido;

  if ((estaVacio(remoto) || seReinicio) && hayLocal) {
    const motivo = estaVacio(remoto) ? 'Render está vacío (se reinició)' : 'Render se reinició y volvió a sus datos iniciales';
    if (argumentos.indexOf('--sin-auto-restaurar') === -1 && argumentos.indexOf('--vigilar') !== -1) {
      console.log(motivo + '. Restaurando desde esta computadora...');
      await restaurar(token, false);
    } else {
      console.log(motivo + ' y esta computadora tiene datos (' + resumen(local) + ').');
      console.log('No se copió nada para no perderlos. Para devolverlos a Render usa: npm run restaurar');
    }
    return;
  }

  hacerRespaldo();
  escribirLocal(remoto);
  guardarInicioConocido(remoto.inicio);
  console.log(new Date().toLocaleTimeString() + '  Copiado desde Render: ' + resumen(remoto) + '.');
}

async function principal() {
  if (argumentos.indexOf('--restaurar') !== -1) {
    await restaurar(await iniciarSesion(), argumentos.indexOf('--si') === -1);
    return;
  }

  if (argumentos.indexOf('--vigilar') === -1) {
    await sincronizar();
    return;
  }

  console.log('Copiando desde ' + URL_RENDER + ' cada minuto. Cierra esta ventana para detener.');
  while (true) {
    try { await sincronizar(); }
    catch (error) { console.error(new Date().toLocaleTimeString() + '  No se pudo copiar: ' + error.message); }
    await new Promise(r => setTimeout(r, 60000));
  }
}

principal().catch(error => {
  console.error('Error: ' + error.message);
  process.exit(1);
});
