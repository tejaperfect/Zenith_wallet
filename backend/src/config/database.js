import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    // Validate required environment variables
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is not defined');
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: 'zenith-wallet-hub',
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      heartbeatFrequencyMS: 2000, // Check connection every 2s
      maxPoolSize: 10, // Maintain up to 10 socket connections
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      bufferCommands: false, // Disable mongoose buffering
      retryWrites: true, // Retry failed writes
      authSource: 'admin' // Use admin database for authentication if needed
    });

    console.log(`🗄️  MongoDB connected: ${conn.connection.host}`);
    
    // Handle connection events
    mongoose.connection.on('connected', () => {
      console.log('✅ MongoDB connected successfully');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('🛑 MongoDB connection closed through app termination');
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

// Test database connection
export const testDBConnection = async () => {
  try {
    const state = mongoose.connection.readyState;
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return {
      status: states[state],
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      readyState: state
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
};

// Get database statistics
export const getDBStats = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    
    const stats = await mongoose.connection.db.stats();
    return {
      collections: stats.collections,
      dataSize: stats.dataSize,
      indexSize: stats.indexSize,
      objects: stats.objects
    };
  } catch (error) {
    return {
      error: error.message
    };
  }
};