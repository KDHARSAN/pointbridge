import { createBus } from './app.js';

const PORT = Number(process.env.PORT ?? 5002);
createBus().httpServer.listen(PORT, () => console.log(`Event Bus on http://localhost:${PORT}`));
