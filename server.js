const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME   = process.env.DB_NAME || 'practicokoki0';

let db;

async function conectarMongo() {
  if (db) return db;
  const client = await MongoClient.connect(MONGO_URI);
  db = client.db(DB_NAME);
  console.log('MongoDB conectado');
  return db;
}

// ── POST /api/opiniones — Guardar opinión ────────────────────
app.post('/api/opiniones', async (req, res) => {
  try {
    const { id_curso, opiniones } = req.body;
    if (!id_curso || !Array.isArray(opiniones) || opiniones.length === 0) {
      return res.json({ success: false, error: 'Datos inválidos' });
    }
    const database = await conectarMongo();
    const coleccion = database.collection('opiniones_cursos');
    const doc = {
      id_curso: parseInt(id_curso),
      fecha: new Date().toISOString().split('T')[0],
      opiniones: opiniones.map(o => ({
        caracteristica: o.caracteristica,
        valoracion: parseFloat(o.valoracion)
      }))
    };
    await coleccion.insertOne(doc);
    res.json({ success: true, message: 'Opinión guardada' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── GET /api/integrado/:id — Consulta integrada ──────────────
app.get('/api/integrado/:id', async (req, res) => {
  try {
    const id_curso = parseInt(req.params.id);
    const database = await conectarMongo();
    const coleccion = database.collection('opiniones_cursos');
    const opiniones = await coleccion
      .find({ id_curso }, { projection: { _id: 0 } })
      .toArray();
    res.json({
      success: true,
      data: {
        total_registros: opiniones.length,
        opiniones
      }
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── GET /api/reporte/:id — Promedio por característica ───────
app.get('/api/reporte/:id', async (req, res) => {
  try {
    const id_curso = parseInt(req.params.id);
    const database = await conectarMongo();
    const coleccion = database.collection('opiniones_cursos');

    // Aggregation pipeline: desagrupa opiniones y calcula promedio por característica
    const pipeline = [
      { $match: { id_curso } },
      { $unwind: '$opiniones' },
      {
        $group: {
          _id: '$opiniones.caracteristica',
          promedio: { $avg: '$opiniones.valoracion' },
          cantidad_opiniones: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          caracteristica: '$_id',
          promedio: { $round: ['$promedio', 1] },
          cantidad_opiniones: 1
        }
      },
      { $sort: { caracteristica: 1 } }
    ];

    const promedios = await coleccion.aggregate(pipeline).toArray();
    res.json({ success: true, data: { promedios } });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
