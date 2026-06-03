"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fazendasRoutes = fazendasRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function fazendasRoutes(app) {
    const auth = { preHandler: [app] };
    app.get('/', auth, async (request) => {
        const { id } = request.user;
        return prisma.fazenda.findMany({
            where: { userId: id },
            include: { sensores: { select: { id: true, status: true } }, _count: { select: { alertas: true } } }
        });
    });
    app.get('/:id', auth, async (request, reply) => {
        const { id } = request.params;
        const { id: userId } = request.user;
        const fazenda = await prisma.fazenda.findFirst({
            where: { id: Number(id), userId },
            include: { sensores: true, alertas: true, irrigacoes: true }
        });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        return fazenda;
    });
    app.post('/', auth, async (request, reply) => {
        const { id: userId } = request.user;
        const schema = zod_1.z.object({
            nome: zod_1.z.string().min(2),
            localizacao: zod_1.z.string().min(2),
            area: zod_1.z.number().positive(),
            cultura: zod_1.z.string().min(2)
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: result.error.errors[0].message });
        return reply.status(201).send(await prisma.fazenda.create({ data: { ...result.data, userId } }));
    });
    app.put('/:id', auth, async (request, reply) => {
        const { id } = request.params;
        const { id: userId } = request.user;
        const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId } });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        return prisma.fazenda.update({ where: { id: Number(id) }, data: request.body });
    });
    app.delete('/:id', auth, async (request, reply) => {
        const { id } = request.params;
        const { id: userId } = request.user;
        const fazenda = await prisma.fazenda.findFirst({ where: { id: Number(id), userId } });
        if (!fazenda)
            return reply.status(404).send({ message: 'Fazenda não encontrada' });
        await prisma.fazenda.delete({ where: { id: Number(id) } });
        return reply.status(204).send();
    });
}
