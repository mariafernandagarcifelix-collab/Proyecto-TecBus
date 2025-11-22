// backend/server.js

// 1. Importar las herramientas
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// Importamos los Modelos que usaremos
const Camion = require("./models/Camion");
const Notificacion = require("./models/Notificacion");

// Importamos las rutas
const authRoutes = require("./routes/auth");
const camionRoutes = require("./routes/camiones");
const rutaRoutes = require("./routes/rutas");
const horarioRoutes = require("./routes/horarios");
const userRoutes = require("./routes/users");
const { startAnalyticsJobs } = require("./analytics/cronJobs");
const notificacionRoutes = require("./routes/notificaciones"); // <-- ¡LÍNEA NUEVA!

// 2. Inicializar la aplicación
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const PORT = process.env.PORT || 5000;

// 3. Middlewares
app.use(cors());
app.use(express.json());

// 4. Conectar a la Base de Datos
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ Conectado a MongoDB Atlas");
    startAnalyticsJobs();
  })
  .catch((err) => {
    console.error("❌ Error al conectar a MongoDB:", err.message);
  });

// 5. Rutas de prueba y API
app.get("/", (req, res) => {
  res.send("¡El backend de TecBus está funcionando!");
});

app.use("/api/auth", authRoutes);
app.use("/api/camiones", camionRoutes);
app.use("/api/rutas", rutaRoutes);
app.use("/api/horarios", horarioRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notificaciones", notificacionRoutes);

// 6. LÓGICA DE SOCKET.IO
io.on("connection", (socket) => {
  console.log(`🔌 Un usuario se ha conectado: ${socket.id}`);

  socket.on("driverLocationUpdate", async (data) => {
    try {
      const camion = await Camion.findByIdAndUpdate(
        data.camionId,
        {
          ubicacionActual: {
            type: "Point",
            coordinates: [data.location.lng, data.location.lat],
          },
          ultimaActualizacion: Date.now(),
        },
        { new: true }
      );

      if (camion) {
        io.emit("locationUpdate", {
          camionId: camion._id,
          numeroUnidad: camion.numeroUnidad,
          location: data.location,
        });
      }
    } catch (error) {
      console.error("Error al actualizar ubicación:", error);
    }
  });

  // --- ¡SECCIÓN ACTUALIZADA! ---
  // Evento: El conductor reporta un incidente
  socket.on("incidentReport", async (data) => {
    // ¡NUEVO! Añadido 'async'
    // data = { camionId: '...', tipo: 'Tráfico', detalles: '...' }
    console.log(`🚨 Incidente reportado: ${data.tipo}`);

    try {
      // --- ¡NUEVO! Guardamos la alerta en la DB ---
      // (Basado en tu Notificacion.pdf)
      const nuevaNotificacion = new Notificacion({
        tipo: "incidente",
        titulo: `Incidente: ${data.tipo}`,
        mensaje: data.detalles || "Sin detalles.",
        prioridad: "alta", // Los incidentes son de alta prioridad
        relacionCon: {
          tipo: "camion",
          id: new mongoose.Types.ObjectId(data.camionId),
        },
      });
      await nuevaNotificacion.save();
      

      // Transmitimos la alerta a TODOS (Estudiantes y Admins)
      // (Esta línea ya la tenías, la dejamos igual)
      io.emit("newIncidentAlert", data);
    } catch (error) {
      console.error("Error al guardar incidente:", error);
    }
  });

  socket.on("studentAtStop", (data) => {
    console.log(`🙋 Estudiante esperando en: ${data.rutaId}`);
    io.emit("studentWaiting", data);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Usuario desconectado: ${socket.id}`);
  });
});

// 7. ¡CAMBIO! Arrancamos el 'server' (que incluye Express y Socket.IO)
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
