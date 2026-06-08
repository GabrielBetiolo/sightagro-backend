import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import webpush from 'web-push'

const prisma = new PrismaClient()

webpush.setVapidDetails(
  'mailto:contato@agrosmart.com.br',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function notificacoesRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => { await app.authenticate(req, rep) }

  // Salvar subscription push
  app.post('/subscribe', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({
      endpoint: z.string(),
      keys: z.object({ p256dh: z.string(), auth: z.string() })
    })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })

    await prisma.pushSubscription.upsert({
      where: { endpoint: result.data.endpoint },
      update: { userId: payload.id, keys: JSON.stringify(result.data.keys) },
      create: { userId: payload.id, endpoint: result.data.endpoint, keys: JSON.stringify(result.data.keys) }
    })
    return { ok: true }
  })

  // Remover subscription
  app.delete('/subscribe', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    await prisma.pushSubscription.deleteMany({ where: { userId: payload.id } })
    return { ok: true }
  })

  // Enviar notificação push para um usuário (chamado internamente)
  app.post('/send', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({ title: z.string(), body: z.string(), url: z.string().optional() })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })

    await sendPushToUser(payload.id, result.data.title, result.data.body, result.data.url)
    return { ok: true }
  })

  // VAPID public key para o frontend
  app.get('/vapid-public-key', async () => {
    return { key: process.env.VAPID_PUBLIC_KEY }
  })
}

export async function sendPushToUser(userId: number, title: string, body: string, url?: string) {
  const subs = await new PrismaClient().pushSubscription.findMany({ where: { userId } })
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: JSON.parse(sub.keys) },
        JSON.stringify({ title, body, url: url || '/app/alertas', icon: '/icon-192.png' })
      )
    } catch (err) {
      console.error('Push failed:', err)
    }
  }
}
