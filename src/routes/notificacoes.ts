import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import webpush from 'web-push'

const prisma = new PrismaClient()

function getWebPush() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (pub && priv) {
    webpush.setVapidDetails('mailto:contato@agrosmart.com.br', pub, priv)
  }
  return webpush
}

export async function notificacoesRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => { await app.authenticate(req, rep) }

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

  app.delete('/subscribe', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    await prisma.pushSubscription.deleteMany({ where: { userId: payload.id } })
    return { ok: true }
  })

  app.get('/vapid-public-key', async () => {
    return { key: process.env.VAPID_PUBLIC_KEY }
  })
}

export async function sendPushToUser(userId: number, title: string, body: string, url?: string) {
  try {
    const wp = getWebPush()
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    for (const sub of subs) {
      try {
        await wp.sendNotification(
          { endpoint: sub.endpoint, keys: JSON.parse(sub.keys) },
          JSON.stringify({ title, body, url: url || '/app/alertas', icon: '/icon-192.png' })
        )
      } catch (err) {
        console.error('Push failed for sub:', sub.endpoint, err)
      }
    }
  } catch (err) {
    console.error('sendPushToUser error:', err)
  }
}
