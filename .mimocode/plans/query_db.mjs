import { readFileSync } from 'fs';
import initSqlJs from 'sql.js';

const SQL = await initSqlJs();
const buf = readFileSync('C:\\Users\\thanx\\.local\\share\\mimocode\\mimocode.db');
const db = new SQL.Database(buf);

// List tables
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
console.log("=== TABLES ===");
if (tables.length > 0) {
  tables[0].values.forEach(r => console.log(r[0]));
}

// Schema
const schema = db.exec("SELECT sql FROM sqlite_master WHERE type='table'");
console.log("\n=== SCHEMA ===");
if (schema.length > 0) {
  schema[0].values.forEach(r => console.log(r[0]));
}

db.close();
