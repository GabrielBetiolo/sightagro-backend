import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { MercadoPagoConfig, Payment, PreApproval, PreApprovalPlan } from 'mercadopago'

const prisma = new PrismaClient()
const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN! })

const PLANS = {
  pro: {
    name: 'Pro',
    price: 49.90,
    interval: 'months' as const,
    frequency: 1,
    features: ['5 fazendas', 'Sensores ilimitados', 'Relatórios completos']
  },
  enterprise: {
    name: 'Enterprise',
    price: 149.90,
    interval: 'months' as const,
    frequency: 1,
    features: ['Fazendas ilimitadas', 'API de integração', 'Suporte 24/7']
  }
}

export async function pagamentosRoutes(app: FastifyInstance) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply)
  }

  // GET /pagamentos/planos
  app.get('/planos', async () => {
    return Object.entries(PLANS).map(([key, plan]) => ({ id: key, ...plan }))
  })

  // GET /pagamentos/meu-plano
  app.get('/meu-plano', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { plan: true, planExpiresAt: true, mpSubscriptionId: true }
    })
    return user
  })

  // POST /pagamentos/assinar — assinatura recorrente
  app.post('/assinar', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({ planId: z.enum(['pro', 'enterprise']) })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Plano inválido' })

    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user) return reply.status(404).send({ message: 'Usuário não encontrado' })

    const plan = PLANS[result.data.planId]

    const preApproval = new PreApproval(mp)
    const subscription = await preApproval.create({
      body: {
        preapproval_plan_id: undefined,
        reason: `AgroSmart ${plan.name}`,
        payer_email: user.email,
        auto_recurring: {
          frequency: plan.frequency,
          frequency_type: plan.interval,
          transaction_amount: plan.price,
          currency_id: 'BRL'
        },
        back_url: `${process.env.FRONTEND_URL}/app/planos?status=success`,
        status: 'pending'
      }
    })

    return { init_point: subscription.init_point, id: subscription.id }
  })

  // POST /pagamentos/unico — pagamento único
  app.post('/unico', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }
    const schema = z.object({
      planId: z.enum(['pro', 'enterprise']),
      token: z.string(),
      installments: z.number().default(1),
      paymentMethodId: z.string(),
      email: z.string().email()
    })
    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: 'Dados inválidos' })

    const plan = PLANS[result.data.planId]
    const payment = new Payment(mp)

    const resp = await payment.create({
      body: {
        transaction_amount: plan.price,
        token: result.data.token,
        description: `AgroSmart ${plan.name}`,
        installments: result.data.installments,
        payment_method_id: result.data.paymentMethodId,
        payer: { email: result.data.email }
      }
    })

    if (resp.status === 'approved') {
      const expiresAt = new Date()
      expiresAt.setMonth(expiresAt.getMonth() + 1)
      await prisma.user.update({
        where: { id: payload.id },
        data: { plan: result.data.planId, planExpiresAt: expiresAt }
      })
    }

    return { status: resp.status, id: resp.id }
  })

  // POST /pagamentos/webhook
  app.post('/webhook', async (request, reply) => {
    const body = request.body as any
    if (body.type === 'subscription_preapproval') {
      const preApproval = new PreApproval(mp)
      const sub = await preApproval.get({ id: body.data.id })
      if (sub.status === 'authorized') {
        const user = await prisma.user.findFirst({ where: { email: sub.payer_email } })
        if (user) {
          const expiresAt = new Date()
          expiresAt.setMonth(expiresAt.getMonth() + 1)
          const planId = sub.reason?.toLowerCase().includes('enterprise') ? 'enterprise' : 'pro'
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: planId, planExpiresAt: expiresAt, mpSubscriptionId: body.data.id }
          })
        }
      }
    }
    return reply.status(200).send({ ok: true })
  })

  // POST /pagamentos/cancelar
  app.post('/cancelar', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }
    const user = await prisma.user.findUnique({ where: { id: payload.id } })
    if (!user?.mpSubscriptionId) return reply.status(400).send({ message: 'Nenhuma assinatura ativa' })
    const preApproval = new PreApproval(mp)
    await preApproval.update({ id: user.mpSubscriptionId, body: { status: 'cancelled' } })
    await prisma.user.update({ where: { id: payload.id }, data: { plan: 'free', mpSubscriptionId: null } })
    return { ok: true }
  })
}
