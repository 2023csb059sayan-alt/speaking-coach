import mongoose from 'mongoose';
import { env } from '../env';
import { logger } from '../logging';

/**
 * Database connection.
 *
 * The target is MongoDB Atlas M0 on the free tier in production and a local
 * mongod in development. Connection handling is centralised so tests can point at
 * a throwaway database on the same server.
 */

mongoose.set('strictQuery', true);

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectDb(): Promise<typeof mongoose> {
  if (connectionPromise) return connectionPromise;
  const config = env();
  connectionPromise = mongoose
    .connect(config.MONGODB_URI, {
      dbName: config.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 8_000,
      maxPoolSize: 10,
      autoIndex: config.NODE_ENV !== 'production',
    })
    .then(async (m) => {
      logger.info({ db: config.MONGODB_DB_NAME }, 'Database connected');
      return m;
    })
    .catch((error: unknown) => {
      connectionPromise = null;
      logger.error({ err: error }, 'Database connection failed');
      throw error;
    });
  return connectionPromise;
}

export async function disconnectDb(): Promise<void> {
  connectionPromise = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('Database disconnected');
  }
}

export type DbState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

export function dbState(): DbState {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
}

/**
 * Create the indexes we rely on. Mongoose builds them automatically outside
 * production; this makes the step explicit so a fresh deployment can be checked.
 */
export async function ensureIndexes(): Promise<string[]> {
  await connectDb();
  const names: string[] = [];
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
    names.push(name);
  }
  return names;
}
