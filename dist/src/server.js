// src/server.ts
// Cole em: backend/src/server.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { authRoutes } from './routes/auth.js';
import { fazendasRoutes } from './routes/fazendas.js';
import { sensoresRoutes } from './routes/sensores.js';
import { alertasRoutes } from './routes/alertas.js';
import { irrigacaoRoutes } from './routes/irrigacao.js';
import { dashboardRoutes } from './routes/dashboard.js';
const app = Fastify({ logger: true });
// Plugins
app.register(cors, { origin: process.env.FRONTEND_URL || 'http://localhost:5173' });
app.register(jwt, { secret: process.env.JWT_SECRET || 'agrosmart-secret-key-change-in-production' });
// Decorador de autenticação
app.decorate('authenticate', async (request, reply) => {
    try {
        await request.jwtVerify();
    }
    catch {
        reply.status(401).send({ message: 'Token inválido ou expirado' });
    }
});
// Rotas
app.register(authRoutes, { prefix: '/auth' });
app.register(dashboardRoutes, { prefix: '/dashboard' });
app.register(fazendasRoutes, { prefix: '/fazendas' });
app.register(sensoresRoutes, { prefix: '/sensores' });
app.register(alertasRoutes, { prefix: '/alertas' });
app.register(irrigacaoRoutes, { prefix: '/irrigacao' });
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
const PORT = Number(process.env.PORT) || 3333;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
export { app };
