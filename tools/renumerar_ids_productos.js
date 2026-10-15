'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const BASE = path.join(__dirname, '..', 'pos_evento.db');

if (!fs.existsSync(BASE)) {
  console.error('❌ No se encontró la base de datos:', BASE);
  process.exit(1);
}

const db = new DatabaseSync(BASE);
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN IMMEDIATE;');

try {
  // 1. Obtener productos con ID >= 9000 ordenados
  const prodsAltos = db.prepare('SELECT id_producto, nombre FROM producto WHERE id_producto >= 9000 ORDER BY id_producto ASC').all();
  console.log(`Encontrados ${prodsAltos.length} productos con ID >= 9000.`);

  // El último ID antes de 9000 es 71 (Cigarrillos Pequeña)
  let nuevoId = 72;
  const mapeoIds = {};

  const stmtUpdate = db.prepare('UPDATE producto SET id_producto = ? WHERE id_producto = ?');

  for (const p of prodsAltos) {
    mapeoIds[p.id_producto] = nuevoId;
    stmtUpdate.run(nuevoId, p.id_producto);
    console.log(`  - [${p.id_producto} -> ${nuevoId}] ${p.nombre}`);
    nuevoId++;
  }

  const maxId = nuevoId - 1;

  // 2. Actualizar sqlite_sequence para producto para que el siguiente ID sea maxId + 1
  db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'producto'").run(maxId);
  console.log(`✔ Secuencia autoincremental de 'producto' actualizada a ${maxId}.`);

  db.exec('COMMIT;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

  console.log('\n✅ Renumeración completada con éxito.');
  console.log(`Rango de IDs de productos: 3 a ${maxId}. Ningún ID superior a 9000.`);

} catch (err) {
  db.exec('ROLLBACK;');
  console.error('❌ Error durante la renumeración:', err);
  db.close();
  process.exit(1);
}

// Comprobación final
console.log('\n--- VERIFICACIÓN FINAL ---');
const todos = db.prepare('SELECT id_producto, nombre, precio_venta, (foto IS NOT NULL AND length(foto) > 50) as con_foto FROM producto ORDER BY id_producto ASC').all();
for (const p of todos) {
  console.log(`ID ${String(p.id_producto).padStart(3)}: ${(p.con_foto ? '📸' : '⚪')} ${p.nombre.padEnd(42)} (${p.precio_venta} Bs)`);
}
console.log(`\nTotal productos activos: ${todos.length}`);
console.log('Secuencia producto en sqlite_sequence:', db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'producto'").get().seq);

db.close();
