"use strict";
// ============================================================================
// SERVIDOR PRINCIPAL - AGROSMART BACKEND
// ============================================================================
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
const pagamentos_1 = require("./routes/pagamentos");
const clima_1 = require("./routes/clima");
const notificacoes_1 = require("./routes/notificacoes");
const assistente_1 = require("./routes/assistente");
const documentos_1 = require("./routes/documentos");
const financeiro_1 = require("./routes/financeiro");
const colaboradores_1 = require("./routes/colaboradores");
const estoque_1 = require("./routes/estoque");
const pecuaria_1 = require("./routes/pecuaria"); // NOVO
const app = (0, fastify_1.default)({ logger: true });
exports.app = app;
app.register(cors_1.default, { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
app.register(jwt_1.default, { secret: process.env.JWT_SECRET || 'agrosmart-secret' });
app.decorate('authenticate', async function (request, reply) {
    try {
        await request.jwtVerify();
    }
    catch {
        reply.status(401).send({ message: 'Token inválido ou expirado' });
    }
});
app.register(auth_1.authRoutes, { prefix: '/auth' });
app.register(dashboard_1.dashboardRoutes, { prefix: '/dashboard' });
app.register(fazendas_1.fazendasRoutes, { prefix: '/fazendas' });
app.register(sensores_1.sensoresRoutes, { prefix: '/sensores' });
app.register(alertas_1.alertasRoutes, { prefix: '/alertas' });
app.register(irrigacao_1.irrigacaoRoutes, { prefix: '/irrigacao' });
app.register(pagamentos_1.pagamentosRoutes, { prefix: '/pagamentos' });
app.register(clima_1.climaRoutes, { prefix: '/clima' });
app.register(notificacoes_1.notificacoesRoutes, { prefix: '/notificacoes' });
app.register(assistente_1.assistenteRoutes, { prefix: '/assistente' });
app.register(documentos_1.documentosRoutes, { prefix: '/documentos' });
app.register(financeiro_1.financeiroRoutes, { prefix: '/financeiro' });
app.register(colaboradores_1.colaboradoresRoutes, { prefix: '/colaboradores' });
app.register(estoque_1.estoqueRoutes, { prefix: '/estoque' });
app.register(pecuaria_1.pecuariaRoutes, { prefix: '/pecuaria' }); // NOVO
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }));
const PORT = Number(process.env.PORT) || 3333;
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) {
        app.log.error(err);
        process.exit(1);
    }
    console.log(`Servidor rodando na porta ${PORT}`);
});
