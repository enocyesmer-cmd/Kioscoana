// Servidor de Kiosco Ana. Se usa en Render y con "npm start".
// Guarda todo en SQLite (KioscoAna.db) y entrega la web.

// Las fechas de las ventas se guardan con la hora de Nicaragua
process.env.TZ = process.env.TZ || 'America/Managua';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const CARPETA = __dirname;
// En Render con disco persistente: DATABASE_PATH=/var/data/KioscoAna.db
const ARCHIVO_DB = process.env.DATABASE_PATH || path.join(CARPETA, 'KioscoAna.db');
const CLAVE_ADMIN = process.env.ADMIN_CLAVE || 'admin123';
const CATEGORIAS = ['Frescos', 'Repostería', 'Chiverías'];
// Hora en que arrancó el servidor. sincronizar.js la usa para saber si Render se reinició.
const INICIO_SERVIDOR = new Date().toISOString();

if (!process.env.ADMIN_CLAVE) {
  console.warn('Aviso: usando la clave por defecto (admin123). Define ADMIN_CLAVE para cambiarla.');
}

fs.mkdirSync(path.dirname(ARCHIVO_DB), { recursive: true });
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
  cliente TEXT NOT NULL DEFAULT '{}',
  confirmada TEXT NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE IF NOT EXISTS Config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT ''
);
`);

// Si la base es anterior, se le agrega la columna "confirmada" sin tocar nada más.
// Valores: 'pendiente' (todavía no se decide), 'si' o 'no'.
if (db.prepare('PRAGMA table_info(Ventas)').all().every(c => c.name !== 'confirmada')) {
  db.exec("ALTER TABLE Ventas ADD COLUMN confirmada TEXT NOT NULL DEFAULT 'pendiente'");
}

const ESTADOS_VENTA = ['pendiente', 'si', 'no'];


// Lectura de datos

function leerProductos() {
  return db.prepare(`
    SELECT id_productos AS id, nombre, precio, stock, categorias AS categoria,
           tamano, sabor, vencimiento, descripcion, receta, imagen
    FROM Productos ORDER BY id_productos
  `).all();
}

function leerVentas() {
  return db.prepare('SELECT id_venta AS id, fecha, detalle, total, cliente, confirmada FROM Ventas ORDER BY id_venta').all().map(v => {
    let cliente = {};
    try { cliente = JSON.parse(v.cliente || '{}'); } catch (_) {}
    return { id: v.id, fecha: v.fecha, detalle: v.detalle, total: v.total, cliente: cliente, confirmada: v.confirmada };
  });
}

function leerConfig() {
  const config = { telefono: '', correo: '' };
  db.prepare('SELECT clave, valor FROM Config').all().forEach(f => { config[f.clave] = f.valor; });
  return config;
}


// Validación de lo que llega desde la web

function texto(valor, maximo) {
  return String(valor === undefined || valor === null ? '' : valor).trim().slice(0, maximo);
}

// Devuelve { valor } con el producto limpio, o { error } si algo no es válido
function limpiarProducto(p) {
  const nombre = texto(p.nombre, 80);
  const precio = Math.round(Number(p.precio) * 100) / 100;
  const stock = Number(p.stock);
  const categoria = texto(p.categoria, 20);
  const vencimiento = texto(p.vencimiento, 10);
  const imagen = String(p.imagen || '');

  if (nombre === '') return { error: 'Falta el nombre.' };
  if (!(precio > 0) || precio > 1000000) return { error: 'El precio no es válido.' };
  if (!Number.isInteger(stock) || stock < 0 || stock > 100000) return { error: 'El stock no es válido.' };
  if (CATEGORIAS.indexOf(categoria) === -1) return { error: 'La categoría no es válida.' };
  if (vencimiento !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(vencimiento)) return { error: 'La fecha de vencimiento no es válida.' };
  if (imagen !== '' && (imagen.indexOf('data:image/') !== 0 || imagen.length > 600000)) return { error: 'La imagen no es válida o es muy grande.' };

  return {
    valor: {
      nombre: nombre, precio: precio, stock: stock, categoria: categoria,
      tamano: texto(p.tamano, 40), sabor: texto(p.sabor, 40), vencimiento: vencimiento,
      descripcion: texto(p.descripcion, 200), receta: texto(p.receta, 2000), imagen: imagen
    }
  };
}

function limpiarConfig(c) {
  c = c || {};
  return { telefono: texto(c.telefono, 30), correo: texto(c.correo, 80) };
}

function guardarConfig(config) {
  db.prepare('DELETE FROM Config').run();
  const insertar = db.prepare('INSERT INTO Config (clave, valor) VALUES (?, ?)');
  insertar.run('telefono', config.telefono);
  insertar.run('correo', config.correo);
}

function fechaHoraActual() {
  const f = new Date();
  const dos = n => ('0' + n).slice(-2);
  return f.getFullYear() + '-' + dos(f.getMonth() + 1) + '-' + dos(f.getDate()) + ' ' + dos(f.getHours()) + ':' + dos(f.getMinutes());
}

function fechaHoy() {
  return fechaHoraActual().slice(0, 10);
}


// Sesión del administrador

const sesiones = new Map();          // token -> hora en que vence
const intentosLogin = new Map();     // ip -> { cantidad, hasta }
const pedidosPorIp = new Map();      // ip -> { cantidad, hasta }
const DURACION_SESION = 12 * 60 * 60 * 1000;

function ipDe(req) {
  const reenviada = req.headers['x-forwarded-for'];
  return (reenviada ? String(reenviada).split(',')[0].trim() : req.socket.remoteAddress) || 'desconocida';
}

// Cuenta un intento y avisa si ya pasó el límite en la ventana de tiempo
function superaLimite(mapa, ip, maximo, ventanaMs) {
  const ahora = Date.now();
  let registro = mapa.get(ip);
  if (!registro || registro.hasta < ahora) registro = { cantidad: 0, hasta: ahora + ventanaMs };
  registro.cantidad++;
  mapa.set(ip, registro);
  return registro.cantidad > maximo;
}

function claveCorrecta(clave) {
  const a = crypto.createHash('sha256').update(String(clave)).digest();
  const b = crypto.createHash('sha256').update(CLAVE_ADMIN).digest();
  return crypto.timingSafeEqual(a, b);
}

function esAdmin(req) {
  const cabecera = req.headers['authorization'] || '';
  const token = cabecera.indexOf('Bearer ') === 0 ? cabecera.slice(7) : '';
  const vence = sesiones.get(token);
  if (!vence) return false;
  if (vence < Date.now()) { sesiones.delete(token); return false; }
  return true;
}


// Respuestas

function responderJson(res, codigo, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(cuerpo);
}

// Lee el cuerpo de la petición como JSON (con límite de tamaño)
function leerCuerpo(req, limite) {
  return new Promise((resolver, rechazar) => {
    let cuerpo = '';
    let tamano = 0;
    req.on('data', parte => {
      tamano += parte.length;
      if (tamano > limite) { rechazar({ codigo: 413, mensaje: 'El envío es demasiado grande.' }); req.destroy(); return; }
      cuerpo += parte;
    });
    req.on('end', () => {
      try { resolver(cuerpo === '' ? {} : JSON.parse(cuerpo)); }
      catch (e) { rechazar({ codigo: 400, mensaje: 'Datos no válidos.' }); }
    });
    req.on('error', () => rechazar({ codigo: 400, mensaje: 'No se pudo leer el envío.' }));
  });
}


// Pedidos de los clientes

function registrarPedido(datos) {
  const c = datos.cliente || {};
  const cliente = {
    nombre: texto(c.nombre, 80), telefono: texto(c.telefono, 30), direccion: texto(c.direccion, 200),
    referencia: texto(c.referencia, 150), nota: texto(c.nota, 150)
  };
  if (cliente.nombre === '' || cliente.direccion === '' || cliente.telefono.length < 8) {
    return { codigo: 400, cuerpo: { ok: false, error: 'Completa tu nombre, teléfono y dirección.' } };
  }

  // Juntar productos repetidos
  const pedido = new Map();
  (Array.isArray(datos.items) ? datos.items : []).slice(0, 50).forEach(item => {
    const id = Number(item.id);
    const cantidad = Number(item.cantidad);
    if (Number.isInteger(id) && Number.isInteger(cantidad) && cantidad > 0 && cantidad <= 99) {
      pedido.set(id, (pedido.get(id) || 0) + cantidad);
    }
  });
  if (pedido.size === 0) return { codigo: 400, cuerpo: { ok: false, error: 'El pedido está vacío.' } };

  db.exec('BEGIN IMMEDIATE');
  try {
    const problemas = [];
    const lineas = [];
    let total = 0;

    pedido.forEach((cantidad, id) => {
      const prod = db.prepare('SELECT nombre, precio, stock, vencimiento FROM Productos WHERE id_productos = ?').get(id);
      if (!prod || (prod.vencimiento !== '' && prod.vencimiento < fechaHoy()) || prod.stock <= 0) {
        problemas.push((prod ? prod.nombre : 'Un producto') + ' ya no está disponible.');
      } else if (cantidad > prod.stock) {
        problemas.push('De ' + prod.nombre + ' solo quedan ' + prod.stock + '.');
      } else {
        lineas.push({ id: id, nombre: prod.nombre, cantidad: cantidad, subtotal: prod.precio * cantidad });
        total += prod.precio * cantidad;
      }
    });

    if (problemas.length > 0) {
      db.exec('ROLLBACK');
      return { codigo: 409, cuerpo: { ok: false, problemas: problemas } };
    }

    lineas.forEach(l => db.prepare('UPDATE Productos SET stock = stock - ? WHERE id_productos = ?').run(l.cantidad, l.id));
    const detalle = lineas.map(l => l.cantidad + ' x ' + l.nombre).join(', ');
    db.prepare('INSERT INTO Ventas (fecha, detalle, total, cliente) VALUES (?, ?, ?, ?)')
      .run(fechaHoraActual(), detalle, total, JSON.stringify(cliente));
    db.exec('COMMIT');

    return { codigo: 200, cuerpo: { ok: true, total: total, lineas: lineas.map(l => ({ nombre: l.nombre, cantidad: l.cantidad, subtotal: l.subtotal })) } };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}


// Reemplazar todo el contenido (lo usa la restauración desde la computadora)

function restaurarTodo(datos) {
  const productos = Array.isArray(datos.inventario) ? datos.inventario : [];
  const ventas = Array.isArray(datos.ventas) ? datos.ventas : [];

  const limpios = [];
  for (const p of productos) {
    const r = limpiarProducto(p);
    if (r.error) return { error: 'Producto "' + texto(p.nombre, 40) + '": ' + r.error };
    limpios.push({ id: Number(p.id), p: r.valor });
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM Productos').run();
    const insertarProducto = db.prepare(`
      INSERT INTO Productos
      (id_productos, nombre, precio, stock, categorias, tamano, sabor, vencimiento, descripcion, receta, imagen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    limpios.forEach(({ id, p }) => {
      insertarProducto.run(id, p.nombre, p.precio, p.stock, p.categoria, p.tamano, p.sabor, p.vencimiento, p.descripcion, p.receta, p.imagen);
    });

    db.prepare('DELETE FROM Ventas').run();
    const insertarVenta = db.prepare('INSERT INTO Ventas (id_venta, fecha, detalle, total, cliente, confirmada) VALUES (?, ?, ?, ?, ?, ?)');
    ventas.forEach(v => {
      const estado = ESTADOS_VENTA.indexOf(v.confirmada) === -1 ? 'pendiente' : v.confirmada;
      insertarVenta.run(Number(v.id) || null, texto(v.fecha, 20), texto(v.detalle, 2000), Number(v.total) || 0, JSON.stringify(v.cliente || {}), estado);
    });

    guardarConfig(limpiarConfig(datos.config));
    db.exec('COMMIT');
    return { ok: true, productos: limpios.length, ventas: ventas.length };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}


// Rutas de la API

async function manejarApi(req, res, ruta) {
  const metodo = req.method;
  const ip = ipDe(req);

  // Públicas
  if (metodo === 'GET' && ruta === '/api/productos') {
    return responderJson(res, 200, { inventario: leerProductos(), config: leerConfig() });
  }

  if (metodo === 'POST' && ruta === '/api/pedidos') {
    if (superaLimite(pedidosPorIp, ip, 30, 60 * 60 * 1000)) {
      return responderJson(res, 429, { ok: false, error: 'Demasiados pedidos seguidos. Intenta más tarde.' });
    }
    const r = registrarPedido(await leerCuerpo(req, 50000));
    return responderJson(res, r.codigo, r.cuerpo);
  }

  if (metodo === 'POST' && ruta === '/api/login') {
    if (superaLimite(intentosLogin, ip, 10, 15 * 60 * 1000)) {
      return responderJson(res, 429, { ok: false, error: 'Demasiados intentos. Espera unos minutos.' });
    }
    const datos = await leerCuerpo(req, 2000);
    if (!claveCorrecta(datos.clave || '')) return responderJson(res, 401, { ok: false, error: 'Clave incorrecta.' });

    const token = crypto.randomBytes(32).toString('hex');
    sesiones.set(token, Date.now() + DURACION_SESION);
    intentosLogin.delete(ip);
    return responderJson(res, 200, { ok: true, token: token });
  }

  // Solo administrador
  if (ruta.indexOf('/api/admin/') === 0) {
    if (!esAdmin(req)) return responderJson(res, 401, { ok: false, error: 'Sesión no válida.' });

    if (metodo === 'GET' && ruta === '/api/admin/datos') {
      return responderJson(res, 200, { inventario: leerProductos(), ventas: leerVentas(), config: leerConfig(), inicio: INICIO_SERVIDOR });
    }

    if (metodo === 'POST' && ruta === '/api/admin/productos') {
      const r = limpiarProducto(await leerCuerpo(req, 1000000));
      if (r.error) return responderJson(res, 400, { ok: false, error: r.error });
      const p = r.valor;
      const resultado = db.prepare(`
        INSERT INTO Productos (nombre, precio, stock, categorias, tamano, sabor, vencimiento, descripcion, receta, imagen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(p.nombre, p.precio, p.stock, p.categoria, p.tamano, p.sabor, p.vencimiento, p.descripcion, p.receta, p.imagen);
      return responderJson(res, 200, { ok: true, id: Number(resultado.lastInsertRowid) });
    }

    const coincide = ruta.match(/^\/api\/admin\/productos\/(\d+)$/);
    if (coincide && metodo === 'PUT') {
      const r = limpiarProducto(await leerCuerpo(req, 1000000));
      if (r.error) return responderJson(res, 400, { ok: false, error: r.error });
      const p = r.valor;
      const cambio = db.prepare(`
        UPDATE Productos SET nombre = ?, precio = ?, stock = ?, categorias = ?, tamano = ?, sabor = ?,
        vencimiento = ?, descripcion = ?, receta = ?, imagen = ? WHERE id_productos = ?
      `).run(p.nombre, p.precio, p.stock, p.categoria, p.tamano, p.sabor, p.vencimiento, p.descripcion, p.receta, p.imagen, Number(coincide[1]));
      if (cambio.changes === 0) return responderJson(res, 404, { ok: false, error: 'El producto no existe.' });
      return responderJson(res, 200, { ok: true });
    }

    if (coincide && metodo === 'DELETE') {
      db.prepare('DELETE FROM Productos WHERE id_productos = ?').run(Number(coincide[1]));
      return responderJson(res, 200, { ok: true });
    }

    if (metodo === 'PUT' && ruta === '/api/admin/config') {
      guardarConfig(limpiarConfig(await leerCuerpo(req, 2000)));
      return responderJson(res, 200, { ok: true });
    }

    // Marcar una venta como confirmada ('si'), no confirmada ('no') o pendiente
    const ventaRuta = ruta.match(/^\/api\/admin\/ventas\/(\d+)$/);
    if (ventaRuta && metodo === 'PUT') {
      const datos = await leerCuerpo(req, 1000);
      if (ESTADOS_VENTA.indexOf(datos.confirmada) === -1) {
        return responderJson(res, 400, { ok: false, error: 'Estado de venta no válido.' });
      }
      const cambio = db.prepare('UPDATE Ventas SET confirmada = ? WHERE id_venta = ?').run(datos.confirmada, Number(ventaRuta[1]));
      if (cambio.changes === 0) return responderJson(res, 404, { ok: false, error: 'La venta no existe.' });
      return responderJson(res, 200, { ok: true });
    }

    if (metodo === 'DELETE' && ruta === '/api/admin/ventas') {
      db.prepare('DELETE FROM Ventas').run();
      return responderJson(res, 200, { ok: true });
    }

    if (metodo === 'PUT' && ruta === '/api/admin/restaurar') {
      const r = restaurarTodo(await leerCuerpo(req, 40 * 1024 * 1024));
      return responderJson(res, r.error ? 400 : 200, r.error ? { ok: false, error: r.error } : r);
    }
  }

  responderJson(res, 404, { ok: false, error: 'No existe.' });
}


// Productos iniciales
// Si la base es nueva (nunca tuvo productos) se cargan los de productos_iniciales.json,
// con sus fotos de la carpeta imagenes/. Así la tienda no arranca vacía cuando Render
// reinicia o se usa un disco nuevo. Si la base ya tuvo productos (aunque se hayan
// borrado) no se vuelve a cargar nada.

function sembrarProductosIniciales() {
  const hay = db.prepare('SELECT COUNT(*) AS n FROM Productos').get().n;
  const usada = db.prepare("SELECT COUNT(*) AS n FROM sqlite_sequence WHERE name = 'Productos'").get().n;
  if (hay > 0 || usada > 0) return;

  const archivo = path.join(CARPETA, 'productos_iniciales.json');
  if (!fs.existsSync(archivo)) return;

  let lista;
  try {
    lista = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch (e) {
    console.warn('No se pudo leer productos_iniciales.json:', e.message);
    return;
  }
  if (!Array.isArray(lista)) return;

  const insertar = db.prepare(`
    INSERT INTO Productos (nombre, precio, stock, categorias, tamano, sabor, vencimiento, descripcion, receta, imagen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    let cargados = 0;
    lista.forEach(item => {
      let imagen = '';
      if (item.imagen) {
        try {
          const bytes = fs.readFileSync(path.join(CARPETA, 'imagenes', path.basename(String(item.imagen))));
          imagen = 'data:image/jpeg;base64,' + bytes.toString('base64');
        } catch (e) {
          console.warn('Sin foto para ' + item.nombre + ': ' + item.imagen);
        }
      }
      const r = limpiarProducto(Object.assign({}, item, { imagen: imagen }));
      if (r.error) { console.warn('Producto inicial "' + item.nombre + '" omitido: ' + r.error); return; }
      const p = r.valor;
      insertar.run(p.nombre, p.precio, p.stock, p.categoria, p.tamano, p.sabor, p.vencimiento, p.descripcion, p.receta, p.imagen);
      cargados++;
    });
    db.exec('COMMIT');
    console.log('Productos iniciales cargados: ' + cargados);
  } catch (error) {
    db.exec('ROLLBACK');
    console.warn('No se pudieron cargar los productos iniciales:', error.message);
  }
}

sembrarProductosIniciales();


// Archivos de la web (solo estos; la base de datos y el servidor no se entregan)

const ARCHIVOS_PUBLICOS = {
  '/index.html': 'text/html; charset=utf-8',
  '/admin.html': 'text/html; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
  '/tema.js': 'text/javascript; charset=utf-8',
  '/datos.js': 'text/javascript; charset=utf-8',
  '/tienda.js': 'text/javascript; charset=utf-8',
  '/admin.js': 'text/javascript; charset=utf-8',
  '/app.js': 'text/javascript; charset=utf-8',
  '/Logo.png': 'image/png',
  '/lib/sql-wasm.js': 'text/javascript; charset=utf-8',
  '/lib/sql-wasm.wasm': 'application/wasm'
};

function servirArchivo(req, res, ruta) {
  if (ruta === '/') ruta = '/index.html';
  const tipo = ARCHIVOS_PUBLICOS[ruta];

  if (!tipo || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
    return;
  }

  fs.readFile(path.join(CARPETA, ruta), (error, contenido) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': tipo,
      'Cache-Control': ruta.indexOf('/lib/') === 0 || ruta === '/Logo.png' ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : contenido);
  });
}

const servidor = http.createServer(async (req, res) => {
  try {
    const ruta = decodeURIComponent(req.url.split('?')[0]);
    if (ruta === '/salud') { res.writeHead(200); res.end('ok'); return; }
    if (ruta.indexOf('/api/') === 0) { await manejarApi(req, res, ruta); return; }
    servirArchivo(req, res, ruta);
  } catch (error) {
    if (error && error.codigo) return responderJson(res, error.codigo, { ok: false, error: error.mensaje });
    console.error('Error:', error);
    responderJson(res, 500, { ok: false, error: 'Error del servidor.' });
  }
});

servidor.listen(PORT, () => {
  console.log('Kiosco Ana funcionando en el puerto ' + PORT);
  console.log('Base de datos: ' + ARCHIVO_DB);
});
