"use strict";
// src/server.ts
// Cole em: backend/src/server.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const auth_1 = require("./routes/auth");
const fazendas_1 = require("./routes/fazendas");
const sensores_1 = require("./routes/sensores");
const alertas_1 = require("./routes/alertas");
const irrigacao_1 = require("./routes/irrigacao");
const dashboard_1 = require("./routes/dashboard");
const app = (0, fastify_1.default)({ logger: true });
exports.app = app;
// Plugins
app.register(cors_1.default, { origin: process.env.FRONTEND_URL || 'http://localhost:5173' });
app.register(jwt_1.default, { secret: process.env.JWT_SECRET || 'agrosmart-secret-key-change-in-production' });
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
app.register(auth_1.authRoutes, { prefix: '/auth' });
app.register(dashboard_1.dashboardRoutes, { prefix: '/dashboard' });
app.register(fazendas_1.fazendasRoutes, { prefix: '/fazendas' });
app.register(sensores_1.sensoresRoutes, { prefix: '/sensores' });
app.register(alertas_1.alertasRoutes, { prefix: '/alertas' });
app.register(irrigacao_1.irrigacaoRoutes, { prefix: '/irrigacao' });
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
const PORT = Number(process.env.PORT) || 3333;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
