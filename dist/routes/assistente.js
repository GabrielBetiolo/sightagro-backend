"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assistenteRoutes = assistenteRoutes;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
async function assistenteRoutes(app) {
    const auth = async (req, rep) => { await app.authenticate(req, rep); };
    app.post('/chat', { preHandler: auth }, async (request, reply) => {
        const payload = request.user;
        const schema = zod_1.z.object({
            messages: zod_1.z.array(zod_1.z.object({ role: zod_1.z.enum(['user', 'assistant']), content: zod_1.z.string() }))
        });
        const result = schema.safeParse(request.body);
        if (!result.success)
            return reply.status(400).send({ message: 'Dados inválidos' });
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        const fazendas = await prisma.fazenda.findMany({
            where: { userId: payload.id },
            include: { sensores: { include: { leituras: { orderBy: { createdAt: 'desc' }, take: 1 } } } }
        });
        const alertas = await prisma.alerta.findMany({
            where: { fazenda: { userId: payload.id }, lido: false },
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { fazenda: { select: { nome: true } } }
        });
        const systemPrompt = `Você é o assistente agrícola do AgroSmart, especializado em agricultura brasileira.
Seja direto, prático e use linguagem simples para agricultores. Responda sempre em português do Brasil.
Quando não tiver dados suficientes, sugira que o usuário adicione fazendas ou sensores.

Dados atuais do usuário ${user?.name}:
Fazendas: ${JSON.stringify(fazendas.map(f => ({ nome: f.nome, localizacao: f.localizacao, cultura: f.cultura, area: f.area, sensores: f.sensores.map(s => ({ codigo: s.codigo, tipo: s.tipo, status: s.status, ultimaLeitura: s.leituras[0] })) })))}
Alertas não lidos: ${JSON.stringify(alertas.map(a => ({ tipo: a.tipo, titulo: a.titulo, fazenda: a.fazenda.nome })))}`;
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                max_tokens: 1024,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...result.data.messages
                ]
            })
        });
        if (!response.ok) {
            const err = await response.text();
            console.error('Groq error:', err);
            return reply.status(500).send({ message: 'Erro no assistente' });
        }
        const data = await response.json();
        return { content: data.choices[0].message.content };
    });
}
