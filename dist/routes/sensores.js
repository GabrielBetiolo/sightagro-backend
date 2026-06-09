"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sensoresRoutes = sensoresRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
async function sensoresRoutes(app) {
    const auth = async (req, rep) => { await app.authenticate(req, rep); };
    // Listar sensores do usuário
    app.get('/', { preHandler: auth }, async (request) => {
        const payload = request.user;
        return prisma.sensor.findMany({
            where: { fazenda: { userId: payload.id } },
            include: {
                fazenda: { select: { nome: true } },
                leituras: { orderBy: { createdAt: 'desc' }, take: 1 }
            },
            orderBy: { createdAt: 'desc' }
        });
    });
    // Criar sensor com token único
    app.post('/', { preHandler: auth }, async (request, reply) => {
        const schema = zod_1.z.object({
            codigo: zod_1.z.string().min(1),
            tipo: zod_1.z.string().min(1),
            fazendaId: zod_1.z.number()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: result.error.errors[0].message });
        const token = crypto_1.default.randomBytes(24).toString('hex');
        const sensor = await prisma.sensor.create({
            data: {
                codigo: result.data.codigo,
                tipo: result.data.tipo,
                token,
                fazenda: { connect: { id: result.data.fazendaId } }
            }
        });
        return reply.status(201).send(sensor);
    });
    // Atualizar sensor
    app.put('/:id', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        const schema = zod_1.z.object({ codigo: zod_1.z.string().optional(), tipo: zod_1.z.string().optional() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return prisma.sensor.update({ where: { id: Number(id) }, data: result.data });
    });
    // Deletar sensor
    app.delete('/:id', { preHandler: auth }, async (request, reply) => {
        const { id } = request.params;
        await prisma.leitura.deleteMany({ where: { sensorId: Number(id) } });
        await prisma.sensor.delete({ where: { id: Number(id) } });
        return reply.status(204).send();
    });
    // Histórico de leituras
    app.get('/:id/leituras', { preHandler: auth }, async (request) => {
        const { id } = request.params;
        const { limit } = request.query;
        return prisma.leitura.findMany({
            where: { sensorId: Number(id) },
            orderBy: { createdAt: 'desc' },
            take: Number(limit) || 50
        });
    });
    // Endpoint público para hardware enviar leitura (usa token do sensor)
    app.post('/data', async (request, reply) => {
        const schema = zod_1.z.object({
            token: zod_1.z.string(),
            valor: zod_1.z.number(),
            unidade: zod_1.z.string(),
            bateria: zod_1.z.number().optional()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const sensor = await prisma.sensor.findFirst({ where: { token: result.data.token } });
        if (!sensor)
            return reply.status(401).send({ message: 'Token inválido' });
        const leitura = await prisma.leitura.create({
            data: {
                valor: result.data.valor,
                unidade: result.data.unidade,
                sensor: { connect: { id: sensor.id } }
            }
        });
        // Atualiza bateria e status
        await prisma.sensor.update({
            where: { id: sensor.id },
            data: {
                status: 'online',
                bateria: result.data.bateria ?? sensor.bateria,
                ultimaLeitura: new Date()
            }
        });
        // Gerar alertas automáticos baseados na leitura
        const alertas = [];
        if (sensor.tipo === 'Temperatura' && result.data.valor > 38) {
            alertas.push({ tipo: 'danger', titulo: 'Temperatura crítica', descricao: `Sensor ${sensor.codigo}: ${result.data.valor}${result.data.unidade}` });
        }
        if (sensor.tipo === 'Umidade' && result.data.valor < 30) {
            alertas.push({ tipo: 'warning', titulo: 'Umidade baixa', descricao: `Sensor ${sensor.codigo}: ${result.data.valor}${result.data.unidade}` });
        }
        if ((result.data.bateria ?? 100) < 15) {
            alertas.push({ tipo: 'warning', titulo: `Bateria baixa — ${sensor.codigo}`, descricao: `Bateria em ${result.data.bateria}%. Substitua em breve.` });
        }
        for (const alerta of alertas) {
            const existe = await prisma.alerta.findFirst({
                where: { fazendaId: sensor.fazendaId, titulo: alerta.titulo, createdAt: { gte: new Date(Date.now() - 3600000) } }
            });
            if (!existe)
                await prisma.alerta.create({ data: { ...alerta, fazendaId: sensor.fazendaId } });
        }
        return { ok: true, leituraId: leitura.id };
    });
    // Regenerar token do sensor
    app.post('/:id/regenerar-token', { preHandler: auth }, async (request) => {
        const { id } = request.params;
        const token = crypto_1.default.randomBytes(24).toString('hex');
        return prisma.sensor.update({ where: { id: Number(id) }, data: { token } });
    });
}
