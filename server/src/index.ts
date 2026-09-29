import { createApp } from './app';
import { connectDb, disconnectDb, ensureIndexes } from './db/connect';
import { env, EnvError } from './env';
import { logger } from './logging';

/**
 * Server bootstrap.
 *
 * Order matters: the environment is validated first (so a missing secret fails
 * loudly at boot instead of at the first request), then the database, then the
 * indexes, and only then do we accept traffic.
 */

async function main(): Promise<void> {
  try {
    env();
  } catch (error) {
    if (error instanceof EnvError) {
      logger.fatal({ issues: error.issues }, 'Refusing to start: the environment is not valid');
    }
    throw error;
  }

  const config = env();
  await connectDb();
  if (config.NODE_ENV !== 'production') {
    // Index creation must not be able to take the service down: a pre-existing
    // collection can hold an index that conflicts with the current schema, and a
    // learner can still be served while an operator fixes it.
    try {
      const indexes = await ensureIndexes();
      logger.info({ indexCount: indexes.length }, 'Indexes ensured');
    } catch (error) {
      logger.error({ err: error }, 'Could not ensure indexes; continuing to serve');
    }
  }

  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(
      {
        host: config.HOST,
        port: config.PORT,
        env: config.NODE_ENV,
        stt: config.CHAIN_STT,
        tts: config.CHAIN_TTS,
        llm: config.CHAIN_LLM,
      },
      'API listening',
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectDb().then(() => process.exit(0));
    });
    // Do not hang forever if a connection refuses to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Server failed to start');
  process.exit(1);
});
