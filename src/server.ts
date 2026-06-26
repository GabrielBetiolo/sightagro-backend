/**
 * server.ts — Servidor Fastify — SightAgro (versão completa)
 */

import Fastify from 'fastify'
import cors   from '@fastify/cors'
import jwt    from '@fastify/jwt'

import { authRoutes }          from './routes/auth'
import { fazendasRoutes }      from './routes/fazendas'
import { sensoresRoutes }      from './routes/sensores'
import { alertasRoutes }       from './routes/alertas'
import { irrigacaoRoutes }     from './routes/irrigacao'
import { dashboardRoutes }     from './routes/dashboard'
import { climaRoutes }         from './routes/clima'
import { notificacoesRoutes }  from './routes/notificacoes'
import { pagamentosRoutes }    from './routes/pagamentos'
import { assistenteRoutes }    from './routes/assistente'
import { documentosRoutes }    from './routes/documentos'
import { financeiroRoutes }    from './routes/financeiro'
import { colaboradoresRoutes } from './routes/colaboradores'
import { estoqueRoutes }       from './routes/estoque'
import { pecuariaRoutes }      from './routes/pecuaria'
import { aquiculturaRoutes }   from './routes/aquicultura'
import { pragasRoutes }        from './routes/pragas'
import { mapaRoutes }          from './routes/mapa'
import { relatoriosRoutes }    from './routes/relatorios'   // ← NOVO

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const app = Fastify({ logger: true })

app.register(cors, { origin: true, credentials: true })
app.register(jwt, {
  secret: process.env.JWT_SECRET || 'dev-secret-mude-em-producao',
})

app.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Token inválido ou expirado.' })
  }
})

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// ─── Todas as rotas ───────────────────────────────────────────────────────────
app.register(authRoutes)
app.register(fazendasRoutes)
app.register(sensoresRoutes)
app.register(alertasRoutes)
app.register(irrigacaoRoutes)
app.register(dashboardRoutes)
app.register(climaRoutes)
app.register(notificacoesRoutes)
app.register(pagamentosRoutes)
app.register(assistenteRoutes)
app.register(documentosRoutes)
app.register(financeiroRoutes)
app.register(colaboradoresRoutes)
app.register(estoqueRoutes)
app.register(pecuariaRoutes)
app.register(aquiculturaRoutes)
app.register(pragasRoutes)
app.register(mapaRoutes)
app.register(relatoriosRoutes)   // ← NOVO

const PORT = parseInt(process.env.PORT || '3333')
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1) }
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
})
