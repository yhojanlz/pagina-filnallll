const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Asegurar que la carpeta uploads existe
if (!fs.existsSync("./uploads")) {
  fs.mkdirSync("./uploads");
}

// Configuración de Multer para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// Configuración de Base de Datos (PostgreSQL para producción, SQLite para desarrollo local)
const isProduction = process.env.NODE_ENV === "production" || process.env.DATABASE_URL;
let db;
let pgPool;

if (isProduction) {
  console.log("Iniciando en modo PRODUCCIÓN con PostgreSQL...");
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  // Escuchar errores en el pool para evitar que la app se caiga
  pgPool.on('error', (err) => {
    console.error('Error inesperado en el cliente de PostgreSQL:', err);
  });
  initPostgresDatabase();
} else {
  console.log("Iniciando en modo DESARROLLO con SQLite local...");
  const dbPath = path.join(__dirname, "athenea.db");
  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error("Error al conectar con SQLite:", err.message);
    } else {
      console.log("Conectado con éxito a la base de datos SQLite (athenea.db)");
      initDatabase();
    }
  });
}

// Función para ejecutar consultas de forma universal (SQLite o Postgres)
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    if (isProduction) {
      // Convertir placeholders de SQLite (?) a PostgreSQL ($1, $2...)
      let pgQuery = query;
      let index = 1;
      while (pgQuery.includes("?")) {
        pgQuery = pgQuery.replace("?", `$${index++}`);
      }
      pgPool.query(pgQuery, params, (err, res) => {
        if (err) reject(err);
        else resolve(res.rows);
      });
    } else {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    }
  });
}

function runCommand(query, params = []) {
  return new Promise((resolve, reject) => {
    if (isProduction) {
      let pgQuery = query;
      let index = 1;
      while (pgQuery.includes("?")) {
        pgQuery = pgQuery.replace("?", `$${index++}`);
      }
      pgPool.query(pgQuery, params, (err, res) => {
        if (err) reject(err);
        else resolve({ lastID: null, changes: res.rowCount });
      });
    } else {
      db.run(query, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }
  });
}

async function initPostgresDatabase() {
  try {
    // Tabla de Categorías
    await pgPool.query(`CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      department TEXT NOT NULL
    )`);

    // Tabla de Productos
    await pgPool.query(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      categoryId TEXT,
      image TEXT,
      description TEXT,
      sizes TEXT
    )`);

    // Tabla de Carrito (Items)
    await pgPool.query(`CREATE TABLE IF NOT EXISTS cart_items (
      sessionId TEXT,
      productId TEXT,
      size TEXT,
      quantity INTEGER,
      PRIMARY KEY (sessionId, productId, size)
    )`);

    // Tabla de Métodos de Pago
    await pgPool.query(`CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      instructions TEXT,
      enabled INTEGER DEFAULT 1
    )`);

    // Tabla de Campos de Métodos de Pago
    await pgPool.query(`CREATE TABLE IF NOT EXISTS payment_fields (
      methodId TEXT,
      key TEXT,
      label TEXT,
      value TEXT,
      PRIMARY KEY (methodId, key)
    )`);

    // Tabla de Ajustes (WhatsApp, etc.)
    await pgPool.query(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`);

    // Tabla de Pedidos
    await pgPool.query(`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      sessionId TEXT,
      total REAL,
      paymentMethod TEXT,
      items TEXT,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insertar datos iniciales si está vacío
    const catCount = await pgPool.query("SELECT COUNT(*) FROM categories");
    if (parseInt(catCount.rows[0].count) === 0) {
      await pgPool.query(`INSERT INTO categories (id, name, department) VALUES
        ('c1', 'Vestidos', 'mujer'),
        ('c2', 'Deportivo', 'mujer'),
        ('c3', 'Camisas', 'hombre'),
        ('c4', 'Pantalones', 'hombre'),
        ('c5', 'Niños Todo', 'ninos')`);
    }

    const prodCount = await pgPool.query("SELECT COUNT(*) FROM products");
    if (parseInt(prodCount.rows[0].count) === 0) {
      await pgPool.query(`INSERT INTO products (id, name, price, categoryId, image, description, sizes) VALUES
        ('p1', 'Vestido de Gala Atenas', 89.99, 'c1', 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600', 'Vestido largo de seda con caída elegante, ideal para eventos formales.', '["S", "M", "L"]'),
        ('p2', 'Conjunto Deportivo Aura', 45.0, 'c2', 'https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=600', 'Top y legging de alta compresión, transpirable y cómodo.', '["S", "M"]'),
        ('p3', 'Camisa Lino Premium', 39.99, 'c3', 'https://images.unsplash.com/photo-1617137968427-85924c800a22?w=600', 'Camisa de lino 100% orgánico, fresca y de corte moderno.', '["M", "L", "XL"]')`);
    }

    const payCount = await pgPool.query("SELECT COUNT(*) FROM payment_methods");
    if (parseInt(payCount.rows[0].count) === 0) {
      await pgPool.query(`INSERT INTO payment_methods (id, label, instructions, enabled) VALUES
        ('pago_movil', 'Pago Móvil', 'Realiza tu pago móvil a los siguientes datos y envíanos el capture.', 1),
        ('transferencia', 'Transferencia Bancaria', 'Transfiere a nuestra cuenta corriente y adjunta el comprobante.', 1),
        ('zelle', 'Zelle', 'Envía tu pago por Zelle al correo indicado.', 1)`);

      await pgPool.query(`INSERT INTO payment_fields (methodId, key, label, value) VALUES
        ('pago_movil', 'banco', 'Banco', 'Banco de Venezuela'),
        ('pago_movil', 'telefono', 'Teléfono', '04120000000'),
        ('pago_movil', 'cedula', 'Cédula', 'V-12345678'),
        ('transferencia', 'banco', 'Banco', 'Banesco'),
        ('transferencia', 'cuenta', 'Nro. Cuenta', '0134-0000-00-0000000000'),
        ('transferencia', 'rif', 'RIF', 'J-12345678-9'),
        ('zelle', 'correo', 'Correo Zelle', 'pagos@atheneastore.com'),
        ('zelle', 'titular', 'Titular', 'Athenea Store C.A.')`);
    }

    const setCount = await pgPool.query("SELECT COUNT(*) FROM settings");
    if (parseInt(setCount.rows[0].count) === 0) {
      await pgPool.query("INSERT INTO settings (key, value) VALUES ('whatsapp', '584120000000')");
    }

    console.log("Base de datos PostgreSQL inicializada correctamente.");
  } catch (err) {
    console.error("Error inicializando PostgreSQL:", err);
  }
}


// Iniciar el servidor Express
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
