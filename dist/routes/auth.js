"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
async function authRoutes(app) {
    // POST /auth/register
    app.post('/register', async (request, reply) => {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2, 'Nome muito curto'),
            email: zod_1.z.string().email('E-mail inválido'),
            password: zod_1.z.string().min(6, 'Senha deve ter mínimo 6 caracteres')
        });
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(400).send({ message: result.error.errors[0].message });
        }
        const { name, email, password } = result.data;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return reply.status(400).send({ message: 'E-mail já cadastrado' });
        }
        const hashed = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, email, password: hashed },
            select: { id: true, name: true, email: true, role: true }
        });
        const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' });
        return reply.status(201).send({ token, user });
    });
    // POST /auth/login
    app.post('/login', async (request, reply) => {
        const schema = zod_1.z.object({
            email: zod_1.z.string().email(),
            password: zod_1.z.string()
        });
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(400).send({ message: 'Dados inválidos' });
        }
        const { email, password } = result.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return reply.status(401).send({ message: 'E-mail ou senha incorretos' });
        }
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid) {
            return reply.status(401).send({ message: 'E-mail ou senha incorretos' });
        }
        const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' });
        return {
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        };
    });
    // GET /auth/me
    app.get('/me', { preHandler: [app.authenticate] }, async (request) => {
        const payload = request.user;
        const user = await prisma.user.findUnique({
            where: { id: payload.id },
            select: { id: true, name: true, email: true, role: true, createdAt: true }
        });
        return user;
    });
    // PUT /auth/me
    app.put('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            email: zod_1.z.string().email().optional()
        });
        const result = schema.safeParse(request.body);
        if (!result.success) {
            return reply.status(400).send({ message: 'Dados inválidos' });
        }
        const user = await prisma.user.update({
            where: { id: payload.id },
            data: result.data,
            select: { id: true, name: true, email: true, role: true }
        });
        return user;
    });
}
