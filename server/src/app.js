
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./config/db");
const productRoutes = require("./routes/productRoutes");
const inventoryRoutes = require('./routes/inventoryRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const errorHandler = require("./middleware/errorHandler");
const { readAuthConfig } = require('./config/auth');
const { createAuthRouter } = require('./routes/authRoutes');
const { createSessionContext } = require('./middleware/authSession');
const requireAuth = require('./middleware/requireAuth');
const authOrigin = require('./middleware/authOrigin');

function createApp(options = {}) {
  const app = express();
  const sessions = createSessionContext(options);

  // Middleware
  app.use(
    cors({
      origin: options.config?.clientUrl || process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
    })
  );

  app.use('/api/auth', express.json({ limit: '16kb' }));
  app.use(express.json());

  // Basic server health check
  app.get("/", (req, res) => {
    res.status(200).json({
      message: "Inventra API is running",
    });
  });

  // Database connection health check
  app.get("/api/health", async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT NOW() AS server_time, current_database() AS database_name"
      );

      res.status(200).json({
        success: true,
        message: "PostgreSQL connected successfully",
        database: result.rows[0].database_name,
        serverTime: result.rows[0].server_time,
      });
    } catch (error) {
      console.error("Database connection error:", error.message);

      res.status(503).json({
        success: false,
        message: "Database connection failed",
      });
    }
  });

  app.use('/api/auth', createAuthRouter({ sessionContext: sessions, googleProvider: options.googleProvider }));

  // Every business endpoint passes this boundary before validation or controller
  // execution. Authentication precedes Origin checks so anonymous writes get 401.
  const protectedApi = express.Router();
  protectedApi.use(['/products', '/inventory', '/orders', '/dashboard'],
    sessions.middleware, requireAuth,
    (req, res, next) => authOrigin(sessions.getConfig().clientUrl)(req, res, next));
  protectedApi.use('/products', productRoutes);
  protectedApi.use('/inventory', inventoryRoutes);
  protectedApi.use('/orders', orderRoutes);
  protectedApi.use('/dashboard', dashboardRoutes);
  app.use('/api', protectedApi);

  // Handle unknown routes
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      message: "Route not found",
    });
  });

  // Centralized error handler
  app.use(errorHandler);
  return app;
}

const app = createApp();
const PORT = process.env.PORT || 5000;

// Start server only after confirming DB connection
async function startServer() {
  try {
    const authConfig = readAuthConfig();
    if (authConfig.trustProxy) app.set('trust proxy', authConfig.trustProxy);
    await pool.query("SELECT 1");

    console.log("PostgreSQL connected successfully");

    const server = app.listen(PORT, () => {
      console.log(`Inventra API running at http://localhost:${PORT}`);
    });

    async function shutdown() {
      console.log("Shutting down Inventra API...");

      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error('Server startup failed:', error.configuration ? error.message : error.code || error.name);
    process.exit(1);
  }
}

if (require.main === module) startServer();
module.exports = app;
module.exports.createApp = createApp;
