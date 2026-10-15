'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.join(__dirname, '..');
const BASE = path.join(RAIZ, 'pos_evento.db');
const RESPALDOS = path.join(RAIZ, 'respaldos');

if (!fs.existsSync(BASE)) {
  console.error('❌ No se encontró la base de datos:', BASE);
  process.exit(1);
}

fs.mkdirSync(RESPALDOS, { recursive: true });

// 1. Respaldo de seguridad previo
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const archivoRespaldo = path.join(RESPALDOS, `pos_evento_antes_de_reinicio_${timestamp}.db`);

try {
  const dbTmp = new DatabaseSync(BASE);
  dbTmp.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  try {
    dbTmp.exec(`VACUUM INTO '${archivoRespaldo.replace(/'/g, "''")}';`);
    console.log('📦 Respaldo previo creado vía VACUUM en:', archivoRespaldo);
  } catch (errVac) {
    fs.copyFileSync(BASE, archivoRespaldo);
    console.log('📦 Respaldo previo creado vía copia de archivo en:', archivoRespaldo);
  }
  dbTmp.close();
} catch (errBkp) {
  fs.copyFileSync(BASE, archivoRespaldo);
  console.log('📦 Respaldo previo creado en:', archivoRespaldo);
}

const db = new DatabaseSync(BASE);
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN IMMEDIATE;');

try {
  // -------------------------------------------------------------
  // 2. VACIAR VENTAS, COMANDAS, DETALLES, PAGOS E IMPRESIONES
  // -------------------------------------------------------------
  const tablasVentas = [
    'impresion_comanda_cajero',
    'impresion_comanda_mesero',
    'pago_comanda',
    'detalle_comanda',
    'comanda',
    'movimiento_stock',
    'traspaso_detalle',
    'traspaso',
    'promocion_detalle',
    'promocion',
    'auditoria_admin'
  ];

  for (const t of tablasVentas) {
    db.exec(`DELETE FROM ${t};`);
    console.log(`✔ Vaciada tabla: ${t}`);
  }

  // -------------------------------------------------------------
  // 3. VACIAR PERSONAL (MESEROS Y CAJEROS)
  // -------------------------------------------------------------
  db.exec('DELETE FROM mesero;');
  console.log('✔ Vaciada tabla: mesero');

  db.exec('DELETE FROM cajero;');
  console.log('✔ Vaciada tabla: cajero');

  // Conservar solo el administrador principal
  db.exec("DELETE FROM administrador_evento WHERE usuario != 'admin' AND id_admin != 1;");
  db.exec("UPDATE administrador_evento SET activo = 1 WHERE usuario = 'admin' OR id_admin = 1;");
  console.log('✔ Usuario administrador conservado y activo.');

  // -------------------------------------------------------------
  // 4. REINICIAR CONTADORES AUTOINCREMENTALES
  // -------------------------------------------------------------
  const secuencias = [
    'comanda',
    'detalle_comanda',
    'pago_comanda',
    'impresion_comanda_cajero',
    'impresion_comanda_mesero',
    'movimiento_stock',
    'traspaso',
    'traspaso_detalle',
    'promocion',
    'promocion_detalle',
    'mesero',
    'cajero',
    'auditoria_admin'
  ];
  const placeholders = secuencias.map(s => `'${s}'`).join(', ');
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders});`);
  console.log('✔ Secuencias autoincrementales reiniciadas a 1.');

  // -------------------------------------------------------------
  // 5. CONFIGURACIÓN DEL EVENTO ALICE PARK
  // -------------------------------------------------------------
  db.prepare("UPDATE evento SET nombre_evento = 'Alice Park' WHERE id_evento = 1;").run();
  db.prepare("UPDATE configuracion SET evento = 'Alice Park' WHERE id_configuracion = 1;").run();
  console.log('✔ Evento configurado a "Alice Park".');

  // -------------------------------------------------------------
  // 6. GESTIÓN DE CATEGORÍAS
  // -------------------------------------------------------------
  const categoriasDef = [
    { id: 1, nombre: 'Botellas', desc: 'Botellas Prestige, Prémium, Main y Espumantes', tipo: 'BEBIDA', orden: 1 },
    { id: 2, nombre: 'Vasos y Yardas', desc: 'Tragos servidos en vaso o yarda', tipo: 'BEBIDA', orden: 2 },
    { id: 3, nombre: 'Cocktails', desc: 'Coctelería, Fish Bowls y Vermouth', tipo: 'BEBIDA', orden: 3 },
    { id: 4, nombre: 'Shots y Rondas', desc: 'Shots de Jägermeister, Olmeca y rondas', tipo: 'BEBIDA', orden: 4 },
    { id: 5, nombre: 'Cerveza', desc: 'Cervezas', tipo: 'BEBIDA', orden: 5 },
    { id: 6, nombre: 'Sodas y Energizantes', desc: 'Gaseosas y Energizantes', tipo: 'BEBIDA', orden: 6 },
    { id: 7, nombre: 'Aguas', desc: 'Aguas y Tónicas', tipo: 'BEBIDA', orden: 7 },
    { id: 8, nombre: 'Cigarrillos', desc: 'Cigarrillos', tipo: 'COMIDA', orden: 8 }
  ];

  // Limpiar y configurar categorías
  db.exec('DELETE FROM categoria_producto;');
  const stmtCat = db.prepare(`
    INSERT INTO categoria_producto (id_categoria, nombre, descripcion, tipo, activo, orden, creado_por_admin, fecha_creacion)
    VALUES (?, ?, ?, ?, 1, ?, 1, datetime('now', 'localtime'))
  `);

  for (const c of categoriasDef) {
    stmtCat.run(c.id, c.nombre, c.desc, c.tipo, c.orden);
  }
  console.log('✔ 8 categorías configuradas para el menú.');

  // -------------------------------------------------------------
  // 7. PRODUCTOS QUE CONSERVAN SU FOTO (COINCIDENTES CON EL MENÚ)
  // Actualizamos precio al del menú, nombre limpio y categoría.
  // -------------------------------------------------------------
  const productosConservados = [
    // BOTELLAS
    { id: 7, nombre: 'Singani Don Lucho de Oro', id_cat: 1, precio: 800 },
    { id: 32, nombre: "Whisky Jack Daniel's", id_cat: 1, precio: 700 },
    { id: 6, nombre: 'Singani Don Lucho Silver', id_cat: 1, precio: 580 },
    { id: 9, nombre: 'Ron Havana Club 7 Años', id_cat: 1, precio: 550 },
    { id: 5, nombre: 'Whisky Chivas 12 Años', id_cat: 1, precio: 850 },
    { id: 15, nombre: "Whisky Ballantine's Finest 8 Años", id_cat: 1, precio: 550 },
    { id: 23, nombre: 'Gin Beefeater Dry', id_cat: 1, precio: 650 },
    { id: 53, nombre: 'Gin Beefeater Pink', id_cat: 1, precio: 700 },
    { id: 3, nombre: 'Flamboyant Gin', id_cat: 1, precio: 420 },
    { id: 16, nombre: 'Singani Casa Real Et. Negra', id_cat: 1, precio: 400 },
    { id: 55, nombre: 'Vodka Stoli', id_cat: 1, precio: 550 },
    { id: 8, nombre: 'Ron Havana Club Reserva', id_cat: 1, precio: 450 },
    { id: 28, nombre: 'Ron Havana Club Especial', id_cat: 1, precio: 400 },
    { id: 51, nombre: 'Ron 37 Lenguas', id_cat: 1, precio: 380 },
    { id: 21, nombre: 'Fernet Branca', id_cat: 1, precio: 400 },
    { id: 20, nombre: 'Fernet Branca Menta RI', id_cat: 1, precio: 400 },
    { id: 33, nombre: 'Jägermeister', id_cat: 1, precio: 550 },
    { id: 58, nombre: 'Tequila Olmeca Reposado', id_cat: 1, precio: 450 },
    { id: 57, nombre: 'Tequila Olmeca Chocolate', id_cat: 1, precio: 450 },

    // VASOS
    { id: 43, nombre: 'Vaso Whisky Chivas 12 Años', id_cat: 2, precio: 50 },
    { id: 9024, nombre: "Vaso Whisky Ballantine's Finest 8 Años", id_cat: 2, precio: 35 },
    { id: 9010, nombre: 'Vaso Gin Flamboyant', id_cat: 2, precio: 40 },
    { id: 47, nombre: 'Vaso Singani Casa Real Et. Negra', id_cat: 2, precio: 30 },
    { id: 50, nombre: 'Vaso Vodka Stoli', id_cat: 2, precio: 40 },
    { id: 9013, nombre: 'Vaso Ron Havana Club Reserva', id_cat: 2, precio: 40 },
    { id: 48, nombre: 'Vaso Fernet Branca', id_cat: 2, precio: 30 },

    // SHOTS
    { id: 60, nombre: 'Shot Jägermeister', id_cat: 4, precio: 30 },
    { id: 49, nombre: 'Shot Olmeca Reposado', id_cat: 4, precio: 30 },
    { id: 9021, nombre: 'Shot Olmeca Chocolate', id_cat: 4, precio: 30 },

    // SODAS Y ENERGIZANTES
    { id: 59, nombre: 'Red Bull', id_cat: 6, precio: 30 },

    // AGUAS
    { id: 9016, nombre: 'Bot. de Agua 500ml', id_cat: 7, precio: 20 },
    { id: 11, nombre: 'Agua Tónica', id_cat: 7, precio: 30 },
    { id: 25, nombre: 'Ginger Ale', id_cat: 7, precio: 30 },

    // CIGARRILLOS
    { id: 71, nombre: 'Cigarrillos Pequeña', id_cat: 8, precio: 20 }
  ];

  const stmtUpdate = db.prepare(`
    UPDATE producto
    SET nombre = ?,
        id_categoria = ?,
        precio_venta = ?,
        stock_actual = 0,
        activo = 1
    WHERE id_producto = ?
  `);

  const idsConservados = [];
  for (const p of productosConservados) {
    stmtUpdate.run(p.nombre, p.id_cat, p.precio, p.id);
    idsConservados.push(p.id);
  }
  console.log(`✔ ${productosConservados.length} productos coincidentes conservados CON SUS FOTOS y precios actualizados.`);

  // -------------------------------------------------------------
  // 8. ELIMINAR PRODUCTOS QUE NO PERTENECEN AL MENÚ
  // -------------------------------------------------------------
  const placeholdersElim = idsConservados.map(id => `'${id}'`).join(', ');
  const resDel = db.prepare(`DELETE FROM producto WHERE id_producto NOT IN (${placeholdersElim})`).run();
  console.log(`✔ ${resDel.changes} productos ajenos al menú eliminados.`);

  // -------------------------------------------------------------
  // 9. INSERTAR PRODUCTOS NUEVOS DEL MENÚ (SIN FOTOS, FOTO = NULL)
  // Stock en 0 y precio según menú
  // -------------------------------------------------------------
  const productosNuevos = [
    // --- PRESTIGE (Botellas) ---
    { id_cat: 1, nombre: 'Whisky Royal Salute 21 Años', desc: 'Prestige Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 5000 },
    { id_cat: 1, nombre: 'Whisky Chivas 18 Años', desc: 'Prestige Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 2700 },
    { id_cat: 1, nombre: 'Gin Beefeater 24 Años', desc: 'Prestige Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 1000 },
    { id_cat: 1, nombre: 'Singani Don Lucho XO', desc: 'Prestige Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 1200 },
    { id_cat: 1, nombre: 'Havana Club Selección de Maestros', desc: 'Prestige Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 800 },

    // --- PRÉMIUM (Botellas) ---
    { id_cat: 1, nombre: 'Whisky Chivas Extra 13 Años', desc: 'Prémium Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 1000 },
    { id_cat: 1, nombre: "Whisky Jack Daniel's Honey", desc: 'Prémium Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 700 },
    { id_cat: 1, nombre: 'Tequila Olmeca Altos Plata', desc: 'Prémium Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 550 },
    { id_cat: 1, nombre: 'Tequila Olmeca Altos Reposado', desc: 'Prémium Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 550 },
    { id_cat: 1, nombre: 'Singani Don Lucho Café', desc: 'Prémium Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 550 },

    // --- ESPUMANTES (Botellas) ---
    { id_cat: 1, nombre: 'Ana de Codorniu Rose', desc: 'Espumantes Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 330 },
    { id_cat: 1, nombre: 'Maria Codorniu Brut Rose', desc: 'Espumantes Botella', tipo: 'BEBIDA_ALCOHOLICA', precio: 300 },

    // --- VASOS Y YARDAS ---
    { id_cat: 2, nombre: "Vaso Whisky Jack Daniel's", desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 2, nombre: "Vaso Whisky Jack Daniel's Honey", desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 2, nombre: 'Vaso Gin Beefeater Dry', desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 50 },
    { id_cat: 2, nombre: 'Vaso Gin Beefeater Pink', desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 50 },
    { id_cat: 2, nombre: 'Yarda Gin Beefeater Pink', desc: 'Yarda', tipo: 'BEBIDA_ALCOHOLICA', precio: 120 },
    { id_cat: 2, nombre: 'Yarda Gin Flamboyant', desc: 'Yarda', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },
    { id_cat: 2, nombre: 'Yarda Singani Casa Real Et. Negra', desc: 'Yarda', tipo: 'BEBIDA_ALCOHOLICA', precio: 70 },
    { id_cat: 2, nombre: 'Vaso Ron 37 Lenguas', desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },
    { id_cat: 2, nombre: 'Yarda Ron 37 Lenguas', desc: 'Yarda', tipo: 'BEBIDA_ALCOHOLICA', precio: 70 },
    { id_cat: 2, nombre: 'Yarda Fernet Branca', desc: 'Yarda', tipo: 'BEBIDA_ALCOHOLICA', precio: 70 },
    { id_cat: 2, nombre: 'Vaso Fernet Branca Menta RI', desc: 'Vaso', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },

    // --- COCKTAILS ---
    { id_cat: 3, nombre: 'Chuflay', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },
    { id_cat: 3, nombre: 'Mojito Cazador', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 3, nombre: 'Gin de Frutilla', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 3, nombre: 'Mojito Clasico', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },
    { id_cat: 3, nombre: 'Gin de Maracuya', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 3, nombre: 'Aperol Spritz', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },
    { id_cat: 3, nombre: 'Gin Campari', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 3, nombre: 'Tinto Verano', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 30 },
    { id_cat: 3, nombre: 'Moscow Mule', desc: 'Cocktail', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },

    // --- VERMOUTH ---
    { id_cat: 3, nombre: 'Carpano Orange', desc: 'Vermouth', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 3, nombre: 'Carpano Bianco Tonic', desc: 'Vermouth', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },

    // --- FISH BOWLS ---
    { id_cat: 3, nombre: 'Fish Bowl Cinderella 2 Lt', desc: 'Fish Bowl Kalix 2 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },
    { id_cat: 3, nombre: 'Fish Bowl Cinderella 1 Lt', desc: 'Fish Bowl Kalix 1 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 60 },
    { id_cat: 3, nombre: 'Fish Bowl Mojito 2 Lt', desc: 'Fish Bowl Kalix 2 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },
    { id_cat: 3, nombre: 'Fish Bowl Mojito 1 Lt', desc: 'Fish Bowl Kalix 1 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 60 },
    { id_cat: 3, nombre: 'Fish Bowl Microdosis 2 Lt', desc: 'Fish Bowl Kalix 2 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },
    { id_cat: 3, nombre: 'Fish Bowl Microdosis 1 Lt', desc: 'Fish Bowl Kalix 1 Lt', tipo: 'BEBIDA_ALCOHOLICA', precio: 60 },

    // --- SHOTS Y RONDAS ---
    { id_cat: 4, nombre: 'Shot Jägermeister + Energizante', desc: 'Shot + Energizante', tipo: 'BEBIDA_ALCOHOLICA', precio: 40 },
    { id_cat: 4, nombre: 'Ronda de Meister (4 Shots)', desc: 'Ronda de 4 Shots', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },
    { id_cat: 4, nombre: 'Ronda de Meister (6 Shots)', desc: 'Ronda de 6 Shots', tipo: 'BEBIDA_ALCOHOLICA', precio: 150 },
    { id_cat: 4, nombre: 'Shot Olmeca Reposado X6', desc: 'Ronda x6', tipo: 'BEBIDA_ALCOHOLICA', precio: 150 },
    { id_cat: 4, nombre: 'Shot Olmeca Chocolate X6', desc: 'Ronda x6', tipo: 'BEBIDA_ALCOHOLICA', precio: 150 },

    // --- CERVEZA ---
    { id_cat: 5, nombre: 'Cerveza Amstel', desc: 'Cerveza individual', tipo: 'BEBIDA_ALCOHOLICA', precio: 25 },
    { id_cat: 5, nombre: 'Cerveza Amstel X5', desc: 'Pack 5 cervezas', tipo: 'BEBIDA_ALCOHOLICA', precio: 100 },

    // --- SODAS Y ENERGIZANTES ---
    { id_cat: 6, nombre: 'Monster', desc: 'Lata Energizante', tipo: 'BEBIDA_NO_ALCOHOLICA', precio: 35 },
    { id_cat: 6, nombre: 'Jarra de Gaseosas', desc: 'Jarra', tipo: 'BEBIDA_NO_ALCOHOLICA', precio: 30 },
    { id_cat: 6, nombre: 'Vasos de Gaseosa', desc: 'Vaso', tipo: 'BEBIDA_NO_ALCOHOLICA', precio: 10 },
    { id_cat: 6, nombre: 'Elixir', desc: 'Bebida', tipo: 'BEBIDA_NO_ALCOHOLICA', precio: 30 },

    // --- AGUAS ---
    { id_cat: 7, nombre: 'Jarra de Agua', desc: 'Jarra', tipo: 'BEBIDA_NO_ALCOHOLICA', precio: 30 },

    // --- CIGARRILLOS ---
    { id_cat: 8, nombre: 'Cigarrillos Grande', desc: 'Cajetilla Grande', tipo: 'COMIDA', precio: 30 }
  ];

  const stmtInsert = db.prepare(`
    INSERT INTO producto (
      id_categoria, nombre, descripcion, tipo_producto,
      precio_venta, stock_actual, activo, foto,
      creado_por_admin, fecha_creacion
    ) VALUES (?, ?, ?, ?, ?, 0, 1, NULL, 1, datetime('now', 'localtime'))
  `);

  for (const n of productosNuevos) {
    stmtInsert.run(n.id_cat, n.nombre, n.desc, n.tipo, n.precio);
  }
  console.log(`✔ ${productosNuevos.length} productos nuevos del menú agregados (sin fotos, foto = NULL).`);

  // Asegurar que ningún producto tenga stock > 0
  db.prepare('UPDATE producto SET stock_actual = 0;').run();

  db.exec('COMMIT;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  console.log('\n✅ REINICIO Y CONFIGURACIÓN COMPLETADOS CON ÉXITO.');

} catch (err) {
  db.exec('ROLLBACK;');
  console.error('❌ Error durante el reinicio:', err);
  db.close();
  process.exit(1);
}

// -------------------------------------------------------------
// 10. REPORTE Y VERIFICACIÓN DEL RESULTADO
// -------------------------------------------------------------
console.log('\n======================================================');
console.log('                 ESTADO FINAL DE LA BD                ');
console.log('======================================================');
const totalProds = db.prepare('SELECT count(*) as c FROM producto').get().c;
const totalConFoto = db.prepare("SELECT count(*) as c FROM producto WHERE foto IS NOT NULL AND length(foto) > 50").get().c;
const totalSinFoto = db.prepare("SELECT count(*) as c FROM producto WHERE foto IS NULL OR length(foto) <= 50").get().c;
const totalStock = db.prepare('SELECT count(*) as c FROM producto WHERE stock_actual > 0').get().c;
const totalComandas = db.prepare('SELECT count(*) as c FROM comanda').get().c;
const totalMeseros = db.prepare('SELECT count(*) as c FROM mesero').get().c;
const totalCajeros = db.prepare('SELECT count(*) as c FROM cajero').get().c;
const adminUser = db.prepare('SELECT usuario, activo FROM administrador_evento').all();
const eventoInfo = db.prepare('SELECT nombre_evento FROM evento').get();

console.log('Evento:                    ', eventoInfo.nombre_evento);
console.log('Total productos:           ', totalProds);
console.log('Productos con foto (prev): ', totalConFoto);
console.log('Productos sin foto (nuevos):', totalSinFoto);
console.log('Productos con stock > 0:   ', totalStock);
console.log('Comandas / Ventas:         ', totalComandas);
console.log('Meseros:                   ', totalMeseros);
console.log('Cajeros:                   ', totalCajeros);
console.log('Administradores activos:   ', JSON.stringify(adminUser));

console.log('\n--- PRODUCTOS POR CATEGORÍA ---');
const cats = db.prepare('SELECT id_categoria, nombre FROM categoria_producto ORDER BY orden ASC').all();
for (const c of cats) {
  const prods = db.prepare("SELECT nombre, precio_venta, CASE WHEN foto IS NOT NULL AND length(foto) > 50 THEN '📸 CON FOTO' ELSE '⚪ Sin foto' END as foto_estado FROM producto WHERE id_categoria = ? ORDER BY id_producto ASC").all(c.id_categoria);
  console.log(`\n📂 [${c.id_categoria}] ${c.nombre} (${prods.length} productos):`);
  for (const p of prods) {
    console.log(`   - ${p.nombre.padEnd(40)} | ${String(p.precio_venta).padStart(4)} Bs | ${p.foto_estado}`);
  }
}

db.close();

// Copiar afiche si existe
try {
  const aficheDir = path.join(RAIZ, 'afiche');
  const sourceAfiche = path.join(__dirname, '..', '..', 'masterdrinks', 'masterdrinks', 'afiche', 'alice_park.jpg');
  if (fs.existsSync(sourceAfiche)) {
    fs.mkdirSync(aficheDir, { recursive: true });
    fs.copyFileSync(sourceAfiche, path.join(aficheDir, 'alice_park.jpg'));
    console.log('\n✔ Afiche de Alice Park copiado a afiche/alice_park.jpg');
  }
} catch (_) {}
