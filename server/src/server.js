import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { seedDemoData } from './data/seedDemo.js';

dotenv.config();

const START_PORT = Number(process.env.PORT || 5000);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/petcare';

async function startServer() {
  await connectDB(MONGODB_URI);

  if ((process.env.SEED_DEMO_DATA || 'true') === 'true') {
    await seedDemoData();
  }

  const app = createApp();
  const server = app.listen(START_PORT, () => {
    console.log(`Server running on port ${START_PORT}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${START_PORT} is already in use. Stop the existing process and restart the server.`);
      process.exit(1);
    }

    throw error;
  });
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
