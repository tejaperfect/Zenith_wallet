import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDB, testDBConnection, getDBStats } from './config/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import groupRoutes from './routes/groups.js';
import expenseRoutes from './routes/expenses.js';
import transactionRoutes from './routes/transactions.js';
import paymentRoutes from './routes/payments.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// CORS configuration
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:4200',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:4200',
  process.env.CLIENT_URL
].filter(Boolean); // Remove undefined values

// Development CORS configuration - more permissive for development
const corsOptions = {
  origin: function (origin, callback) {
    console.log(`🔍 CORS Check - Origin: ${origin}, NODE_ENV: ${process.env.NODE_ENV}`);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('✅ CORS allowed - No origin (likely server-to-server)');
      return callback(null, true);
    }
    
    // In development, allow any localhost or local network IP
    if (process.env.NODE_ENV === 'development') {
      // Allow localhost and 127.0.0.1
      const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
      
      // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      const isLocalNetwork = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(origin);
      
      // Check for reasonable port numbers (3000-9999 for development)
      const hasValidPort = /:([3-9]\d{3})$/.test(origin) || !origin.includes(':');
      
      if (isLocalhost) {
        console.log('✅ CORS allowed - Localhost origin');
        return callback(null, true);
      }
      
      if (isLocalNetwork && hasValidPort) {
        console.log('✅ CORS allowed - Local network IP with valid port');
        return callback(null, true);
      }
      
      console.log(`🔍 Local network check: ${isLocalNetwork}, Valid port: ${hasValidPort}`);
    }
    
    // Check against explicitly allowed origins
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('✅ CORS allowed - Explicitly allowed origin');
      return callback(null, true);
    }
    
    console.log(`❌ CORS blocked origin: ${origin}`);
    console.log(`📋 Allowed origins: ${allowedOrigins.join(', ')}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 200
};

// Debug CORS requests in development
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      console.log(`🔍 CORS Request from: ${origin} - Method: ${req.method} - Path: ${req.path}`);
    }
    next();
  });
}

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom middleware
app.use(logger);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbStatus = await testDBConnection();
  const dbStats = await getDBStats();
  
  res.status(200).json({
    success: true,
    message: 'Zenith Wallet Hub API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: {
      ...dbStatus,
      stats: dbStats
    },
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/payments', paymentRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

export default app;