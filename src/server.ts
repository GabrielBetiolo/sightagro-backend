// ============================================================================
// SERVIDOR PRINCIPAL - AGROSMART BACKEND
// ============================================================================
// Configura o Fastify, registra plugins (CORS, JWT) e todas as rotas da API.
// ============================================================================

import Fastify, { FastifyRequest, FastifyReply } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'

import { authRoutes } from './routes/auth'
import { fazendasRoutes } from './routes/fazendas'
import { sensoresRoutes } from './routes/sensores'
import { alertasRoutes } from './routes/alertas'
import { irrigacaoRoutes } from './routes/irrigacao'
import { dashboardRoutes } from './routes/dashboard'
import { pagamentosRoutes } from './routes/pagamentos'
import { climaRoutes } from './routes/clima'
import { notificacoesRoutes } from './routes/notificacoes'
import { assistenteRoutes } from './routes/assistente'
import { documentosRoutes } from './routes/documentos' // NOVO: documentos da terra

// Tipagem extra para o Fastify reconhecer o decorator "authenticate"
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const app = Fastify({ logger: true })

// CORS liberado para o frontend (Vercel) acessar a API
app.register(cors, { origin: true, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'] })

// Plugin de JWT - usado para autenticação via Bearer token
app.register(jwt, { secret: process.env.JWT_SECRET || 'agrosmart-secret' })

// Decorator "authenticate": usado como preHandler nas rotas privadas
app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ message: 'Token inválido ou expirado' })
  }
})

// ----------------------------------------------------------------------------
// REGISTRO DE ROTAS
// Cada módulo de rota recebe um prefixo, ex: /auth/login, /fazendas, etc.
// ----------------------------------------------------------------------------
app.register(authRoutes, { prefix: '/auth' })
app.register(dashboardRoutes, { prefix: '/dashboard' })
app.register(fazendasRoutes, { prefix: '/fazendas' })
app.register(sensoresRoutes, { prefix: '/sensores' })
app.register(alertasRoutes, { prefix: '/alertas' })
app.register(irrigacaoRoutes, { prefix: '/irrigacao' })
app.register(pagamentosRoutes, { prefix: '/pagamentos' })
app.register(climaRoutes, { prefix: '/clima' })
app.register(notificacoesRoutes, { prefix: '/notificacoes' })
app.register(assistenteRoutes, { prefix: '/assistente' })
app.register(documentosRoutes, { prefix: '/documentos' }) // NOVO

// Health check - usado para "despertar" o backend no Render (plano free)
app.get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

const PORT = Number(process.env.PORT) || 3333
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  console.log(`Servidor rodando na porta ${PORT}`)
})

export { app }
