// backend/server.js

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// Importamos los Modelos
const Camion = require("./models/Camion");
const Notificacion = require("./models/Notificacion");

// Importamos las rutas
const authRoutes = require("./routes/auth");
const camionRoutes = require("./routes/camiones");
const rutaRoutes = require("./routes/rutas");
const horarioRoutes = require("./routes/horarios");
const userRoutes = require("./routes/users");
const notificacionRoutes = require("./routes/notificaciones");
const historialRoutes = require("./routes/historial");
const { startAnalyticsJobs } = require("./analytics/cronJobs");

// 2. Inicializar la aplicación
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexiones desde cualquier IP (importante para el celular)
    methods: ["GET", "POST"],
  },
});

// Compartir io con las rutas
app.set("io", io);

const PORT = process.env.PORT || 5000;

// 3. Middlewares
app.use(cors());
app.use(express.json());

const path = require("path");

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

// Servir archivos estáticos del FrontEnd
app.use(express.static(path.join(__dirname, "../FrontEnd")));

// 5. Rutas
// (Comentamos la ruta raíz para que express.static sirva el index.html por defecto)
// app.get("/", (req, res) => res.send("¡Servidor TecBus Activo!"));
app.use("/api/auth", authRoutes);
app.use("/api/camiones", camionRoutes);
app.use("/api/rutas", rutaRoutes);
app.use("/api/horarios", horarioRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notificaciones", notificacionRoutes);
app.use('/api/historial', historialRoutes);

// 6. LÓGICA DE SOCKET.IO (TIEMPO REAL)
io.on("connection", (socket) => {
  console.log(`🔌 Nuevo cliente conectado: ${socket.id}`);

  // --- A. Actualización de Ubicación (Conductor -> Mapa) ---
  socket.on("driverLocationUpdate", async (data) => {
    try {
      let idParaActualizar = null;

      if (mongoose.Types.ObjectId.isValid(data.camionId)) {
        idParaActualizar = data.camionId;
      } else {
        const camionEncontrado = await Camion.findOne({ numeroUnidad: data.camionId });
        if (camionEncontrado) idParaActualizar = camionEncontrado._id;
      }

      if (idParaActualizar) {
        // 1. GUARDAR EN BD
        const camion = await Camion.findByIdAndUpdate(
          idParaActualizar,
          {
            ubicacionActual: {
              type: "Point",
              coordinates: [data.location.lng, data.location.lat],
            },
            ultimaActualizacion: Date.now(),
            estado: "activo"
          },
          { new: true } // Importante: devuelve el documento actualizado
        );

        // 2. ENVIAR AL MAPA (Solo si se guardó)
        if (camion && camion.ubicacionActual && camion.ubicacionActual.coordinates) {
          
          // Extraemos coordenadas EXCLUSIVAMENTE de la base de datos
          const [lngBD, latBD] = camion.ubicacionActual.coordinates;

          io.emit("locationUpdate", {
            camionId: camion._id,
            numeroUnidad: camion.numeroUnidad,
            location: { 
                lat: latBD, 
                lng: lngBD 
            },
            heading: data.heading || 0
          });
          
          console.log(`📡 Ubicación actualizada desde BD para ${camion.numeroUnidad}: [${latBD}, ${lngBD}]`);
        }
      }
    } catch (error) {
      console.error("❌ Error actualizando ubicación:", error.message);
    }
  });

  // --- B. Reporte de Incidente (Conductor -> Admin) ---
  // ESTA ES LA PARTE CRÍTICA QUE CORREGIMOS
  socket.on("incidentReport", async (data) => {
    console.log("🔍 [DEBUG] Procesando incidente:", data);

    try {
      let camionEncontrado = null;
      let idParaGuardar = null;
      let nombreParaMostrar = data.camionId; // Por defecto usamos lo que manden

      // PASO 1: Intentar identificar el camión
      if (mongoose.Types.ObjectId.isValid(data.camionId)) {
        // Si nos mandaron un ID de Mongo, buscamos por ID
        camionEncontrado = await Camion.findById(data.camionId);
      } else {
        // Si nos mandaron texto (ej: "TEC-01"), buscamos por número o placa
        camionEncontrado = await Camion.findOne({ 
            $or: [{ numeroUnidad: data.camionId }, { placa: data.camionId }] 
        });
      }

      // PASO 2: Preparar datos según lo encontrado
      if (camionEncontrado) {
          console.log("✅ [DEBUG] Camión identificado:", camionEncontrado.numeroUnidad);
          idParaGuardar = camionEncontrado._id; // El ID hexadecimal para la BD
          nombreParaMostrar = camionEncontrado.numeroUnidad; // El nombre corto para la Alerta
      } else {
          console.warn("⚠️ [DEBUG] Camión no encontrado en BD. Se guardará sin vínculo.");
          // No asignamos idParaGuardar para evitar el CastError
      }

      // PASO 3: Guardar en Base de Datos
      await Notificacion.create({
        tipo: "incidente",
        titulo: `Incidente: ${data.tipo}`,
        mensaje: data.detalles || "Sin detalles adicionales",
        prioridad: "alta",
        camionId: idParaGuardar, // Puede ser el ID o null (nunca un string inválido)
        fecha: new Date()
      });
      console.log("💾 [DEBUG] Notificación guardada en MongoDB");

      // PASO 4: Emitir Alerta al Admin (Inmediata)
      io.emit("newIncidentAlert", {
        tipo: data.tipo,
        detalles: data.detalles,
        camionId: nombreParaMostrar, // Aquí mandamos el texto legible (ej: "TEC-01")
        hora: new Date()
      });
      console.log("📡 [DEBUG] Alerta emitida a los administradores");

    } catch (error) {
      console.error("❌ [ERROR CRÍTICO] Fallo al procesar incidente:", error);
    }
  });

  socket.on("studentAtStop", (data) => {
    console.log("📍 Estudiante esperando:", data);
    
    // IMPORTANTE: Usar io.emit para que le llegue a TODOS (Conductores, Admins y el mismo estudiante)
    // O socket.broadcast.emit para que le llegue a todos MENOS al que lo envió.
      io.emit("studentWaiting", {
          userId: data.userId,
          rutaId: data.rutaId,
          location: data.location,
          timestamp: new Date()
      });
  });

  socket.on("disconnect", () => {
    // console.log(`🔌 Desconectado: ${socket.id}`);
  });
});



// 7. Arrancar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});