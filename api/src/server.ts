
import { buildApp } from './app.js';
import { isValidPort } from './utils/validation.js';

const app = buildApp();

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';

if (!isValidPort(port)) {
  throw new Error('Invalid PORT configuration');
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down API');

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Error during API shutdown');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ port, host });

  app.log.info(
    { host, port },
    'Finanzas API is running'
  );
} catch (error) {
  app.log.error({ err: error }, 'Failed to start API');
  process.exitCode = 1;
}
