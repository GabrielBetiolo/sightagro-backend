import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { Resend } from 'resend'
import { sendPushToUser } from './notificacoes'

const prisma = new PrismaClient()
const resend = new Resend(process.env.RESEND_API_KEY)

export async function alertasRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => { await app.authenticate(req, rep) }

  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    return prisma.alerta.findMany({
      where: { fazenda: { userId: payload.id } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { fazenda: { select: { nome: true } } }
    })
  })

  app.patch('/:id/lido', { preHandler: auth }, async (request) => {
    const { id } = request.params as { id: string }
    return prisma.alerta.update({ where: { id: Number(id) }, data: { lido: true } })
  })

  app.patch('/marcar-todos-lidos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    await prisma.alerta.updateMany({
      where: { fazenda: { userId: payload.id }, lido: false },
      data: { lido: true }
    })
    return { ok: true }
  })

  app.delete('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await prisma.alerta.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })
}

// Função para criar alerta e enviar notificações
export async function criarAlertaComNotificacao(
  fazendaId: number,
  tipo: string,
  titulo: string,
  descricao: string
) {
  const fazenda = await prisma.fazenda.findUnique({
    where: { id: fazendaId },
    include: { user: true }
  })
  if (!fazenda) return

  const alerta = await prisma.alerta.create({
    data: { tipo, titulo, descricao, fazendaId }
  })

  // Push notification
  await sendPushToUser(fazenda.userId, titulo, descricao, '/app/alertas')

  // E-mail para alertas críticos
  if (tipo === 'danger' || tipo === 'warning') {
    try {
      await resend.emails.send({
        from: 'AgroSmart <onboarding@resend.dev>',
        to: fazenda.user.email,
        subject: `⚠️ ${titulo} — ${fazenda.nome}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
            <h2 style="color:#4ade80">AgroSmart</h2>
            <div style="background:${tipo === 'danger' ? '#1a0a0a' : '#1a1500'};border:1px solid ${tipo === 'danger' ? '#7f1d1d' : '#854d0e'};border-radius:12px;padding:1.25rem;margin:1rem 0">
              <h3 style="color:${tipo === 'danger' ? '#f87171' : '#facc15'};margin:0 0 8px">${titulo}</h3>
              <p style="color:#d1d5db;margin:0">${descricao}</p>
            </div>
            <p style="color:#6b7280;font-size:0.85rem">Fazenda: <strong>${fazenda.nome}</strong></p>
            <a href="${process.env.FRONTEND_URL}/app/alertas" style="display:inline-block;background:#4ade80;color:#0a0f0d;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:1rem">
              Ver no painel
            </a>
          </div>
        `
      })
    } catch (err) {
      console.error('Email alert failed:', err)
    }
  }

  return alerta
}
