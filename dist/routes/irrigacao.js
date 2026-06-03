"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.irrigacaoRoutes = irrigacaoRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function irrigacaoRoutes(app) {
    const auth = async (request, reply) => {
        await app.authenticate(request, reply);
    };
    app.get('/', { preHandler: auth }, async (request) => {
        const payload = request.user;
        return prisma.irrigacao.findMany({
            where: { fazenda: { userId: payload.id } },
            include: { fazenda: { select: { nome: true } } }
        });
    });
    app.patch('/:id/toggle', { preHandler: auth }, async (request) => {
        const { id } = request.params;
        const current = await prisma.irrigacao.findUnique({ where: { id: Number(id) } });
        if (!current)
            throw new Error('Zona não encontrada');
        return prisma.irrigacao.update({
            where: { id: Number(id) },
            data: { ativa: !current.ativa, fluxo: !current.ativa ? 4.2 : 0 }
        });
    });
    app.post('/', { preHandler: auth }, async (request, reply) => {
        const schema = zod_1.z.object({
            zona: zod_1.z.string(),
            duracao: zod_1.z.number().int().positive(),
            fazendaId: zod_1.z.number()
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const irrigacao = await prisma.irrigacao.create({
            data: {
                zona: result.data.zona,
                duracao: result.data.duracao,
                fazenda: { connect: { id: result.data.fazendaId } }
            }
        });
        return reply.status(201).send(irrigacao);
    });
}
