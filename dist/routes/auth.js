"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const zod_1 = require("zod");
const resend_1 = require("resend");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
async function authRoutes(app) {
    app.post('/register', async (request, reply) => {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2),
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(6)
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: result.error.errors[0].message });
        const { name, email, password } = result.data;
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing)
            return reply.status(400).send({ message: 'E-mail já cadastrado' });
        const hashed = await bcryptjs_1.default.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, email, password: hashed },
            select: { id: true, name: true, email: true, role: true }
        });
        const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' });
        return reply.status(201).send({ token, user });
    });
    app.post('/login', async (request, reply) => {
        const schema = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const { email, password } = result.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user)
            return reply.status(401).send({ message: 'E-mail ou senha incorretos' });
        const valid = await bcryptjs_1.default.compare(password, user.password);
        if (!valid)
            return reply.status(401).send({ message: 'E-mail ou senha incorretos' });
        const token = app.jwt.sign({ id: user.id, email: user.email }, { expiresIn: '7d' });
        return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } };
    });
    app.get('/me', { preHandler: async (req, rep) => { await app.authenticate(req, rep); } }, async (request) => {
        const payload = request.user;
        return prisma.user.findUnique({
            where: { id: payload.id },
            select: { id: true, name: true, email: true, role: true, avatar: true, phone: true, timezone: true, language: true, createdAt: true }
        });
    });
    app.put('/me', { preHandler: async (req, rep) => { await app.authenticate(req, rep); } }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            email: zod_1.z.string().email().optional(),
            phone: zod_1.z.string().optional(),
            timezone: zod_1.z.string().optional(),
            language: zod_1.z.string().optional(),
            avatar: zod_1.z.string().optional(),
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        return prisma.user.update({
            where: { id: payload.id },
            data: result.data,
            select: { id: true, name: true, email: true, role: true, avatar: true, phone: true, timezone: true, language: true }
        });
    });
    app.post('/forgot-password', async (request, reply) => {
        const schema = zod_1.z.object({ email: zod_1.z.string().email() });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'E-mail inválido' });
        const { email } = result.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user)
            return { ok: true }; // Não revelar se o e-mail existe
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hora
        await prisma.user.update({ where: { email }, data: { resetToken: token, resetTokenExpires: expires } });
        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
        await resend.emails.send({
            from: 'AgroSmart <onboarding@resend.dev>',
            to: email,
            subject: 'Redefinir senha — AgroSmart',
            html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
          <h2 style="color:#4ade80">AgroSmart</h2>
          <h3>Redefinir sua senha</h3>
          <p>Você solicitou a redefinição de senha. Clique no botão abaixo para continuar:</p>
          <a href="${resetUrl}" style="display:inline-block;background:#4ade80;color:#0a0f0d;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:1rem 0">
            Redefinir senha
          </a>
          <p style="color:#6b7280;font-size:0.85rem">Este link expira em 1 hora. Se você não solicitou isso, ignore este e-mail.</p>
        </div>
      `
        });
        return { ok: true };
    });
    app.post('/reset-password', async (request, reply) => {
        const schema = zod_1.z.object({ token: zod_1.z.string(), password: zod_1.z.string().min(6) });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const { token, password } = result.data;
        const user = await prisma.user.findFirst({
            where: { resetToken: token, resetTokenExpires: { gt: new Date() } }
        });
        if (!user)
            return reply.status(400).send({ message: 'Link inválido ou expirado' });
        const hashed = await bcryptjs_1.default.hash(password, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashed, resetToken: null, resetTokenExpires: null }
        });
        return { ok: true };
    });
}
