const express = require('express');
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// CONFIGURACIÓN — reemplazá con tus credenciales reales
// ============================================================
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST || 'sql.infinityfree.com',
  user: process.env.MYSQL_USER || 'tu_usuario_mysql',
  password: process.env.MYSQL_PASSWORD || 'tu_password_mysql',
  database: process.env.MYSQL_DATABASE || 'tu_base_de_datos',
  port: process.env.MYSQL_PORT || 3306,
};

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://usuario:password@cluster.mongodb.net/capacitacion?retryWrites=true&w=majority';

// ============================================================
// CONEXIÓN A MONGODB
// ============================================================
let mongoClient;
async function getMongo() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
  }
  return mongoClient.db('capacitacion');
}

// ============================================================
// RUTA: Inicializar tabla MySQL (correr una sola vez)
// ============================================================
app.get('/api/setup', async (req, res) => {
  try {
    const conn = await mysql.createConnection(MYSQL_CONFIG);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cursos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        instructor VARCHAR(100) NOT NULL,
        duracion_horas INT NOT NULL,
        modalidad VARCHAR(50) NOT NULL
      )
    `);

    // Verificar si ya hay datos
    const [rows] = await conn.execute('SELECT COUNT(*) as total FROM cursos');
    if (rows[0].total === 0) {
      await conn.execute(`
        INSERT INTO cursos (nombre, instructor, duracion_horas, modalidad) VALUES
        ('Python Básico', 'Juan Pérez', 40, 'Virtual'),
        ('MongoDB Avanzado', 'María Gómez', 30, 'Virtual'),
        ('Desarrollo Web Full Stack', 'Carlos López', 60, 'Presencial'),
        ('Machine Learning con Python', 'Ana Martínez', 50, 'Virtual'),
        ('Base de Datos Relacionales', 'Roberto Silva', 35, 'Híbrida')
      `);
    }

    await conn.end();
    res.json({ success: true, message: 'Tabla creada e inicializada correctamente' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RUTA: Obtener todos los cursos desde MySQL
// ============================================================
app.get('/api/cursos', async (req, res) => {
  try {
    const conn = await mysql.createConnection(MYSQL_CONFIG);
    const [rows] = await conn.execute('SELECT * FROM cursos ORDER BY nombre');
    await conn.end();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RUTA: Obtener un curso por ID desde MySQL
// ============================================================
app.get('/api/cursos/:id', async (req, res) => {
  try {
    const conn = await mysql.createConnection(MYSQL_CONFIG);
    const [rows] = await conn.execute('SELECT * FROM cursos WHERE id = ?', [req.params.id]);
    await conn.end();
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Curso no encontrado' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RUTA: Guardar opinión en MongoDB
// ============================================================
app.post('/api/opiniones', async (req, res) => {
  try {
    const { id_curso, opiniones } = req.body;

    if (!id_curso || !Array.isArray(opiniones) || opiniones.length === 0) {
      return res.status(400).json({ success: false, error: 'Datos inválidos' });
    }

    const db = await getMongo();
    const col = db.collection('opiniones_cursos');

    const doc = {
      id_curso: parseInt(id_curso),
      fecha: new Date().toISOString().split('T')[0],
      opiniones: opiniones.map(o => ({
        caracteristica: o.caracteristica,
        valoracion: parseFloat(o.valoracion)
      }))
    };

    const result = await col.insertOne(doc);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RUTA: Consulta integrada MySQL + MongoDB por id_curso
// ============================================================
app.get('/api/integrado/:id_curso', async (req, res) => {
  try {
    const id = parseInt(req.params.id_curso);

    // MySQL
    const conn = await mysql.createConnection(MYSQL_CONFIG);
    const [rows] = await conn.execute('SELECT * FROM cursos WHERE id = ?', [id]);
    await conn.end();
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Curso no encontrado' });
    const curso = rows[0];

    // MongoDB
    const db = await getMongo();
    const col = db.collection('opiniones_cursos');
    const opiniones = await col.find({ id_curso: id }).sort({ fecha: -1 }).toArray();

    res.json({
      success: true,
      data: {
        curso: {
          id: curso.id,
          nombre: curso.nombre,
          instructor: curso.instructor,
          duracion_horas: curso.duracion_horas,
          modalidad: curso.modalidad
        },
        total_registros: opiniones.length,
        opiniones: opiniones
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RUTA BONUS: Promedio de valoraciones por curso
// ============================================================
app.get('/api/reporte/:id_curso', async (req, res) => {
  try {
    const id = parseInt(req.params.id_curso);

    // MySQL
    const conn = await mysql.createConnection(MYSQL_CONFIG);
    const [rows] = await conn.execute('SELECT * FROM cursos WHERE id = ?', [id]);
    await conn.end();
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Curso no encontrado' });

    // MongoDB - Agregación para calcular promedios
    const db = await getMongo();
    const col = db.collection('opiniones_cursos');

    const pipeline = [
      { $match: { id_curso: id } },
      { $unwind: '$opiniones' },
      {
        $group: {
          _id: '$opiniones.caracteristica',
          promedio: { $avg: '$opiniones.valoracion' },
          cantidad: { $sum: 1 }
        }
      },
      { $sort: { promedio: -1 } }
    ];

    const promedios = await col.aggregate(pipeline).toArray();

    res.json({
      success: true,
      data: {
        curso: rows[0].nombre,
        instructor: rows[0].instructor,
        promedios: promedios.map(p => ({
          caracteristica: p._id,
          promedio: Math.round(p.promedio * 10) / 10,
          cantidad_opiniones: p.cantidad
        }))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// SERVIDOR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
