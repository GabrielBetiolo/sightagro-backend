/**
 * pragas.ts — Rota de Manejo de Pragas com IA
 *
 * Funcionalidades:
 *  - Registrar ocorrência de praga/doença com descrição e fotos
 *  - Diagnóstico automático via Groq (Llama 3.1)
 *  - Sugestão de defensivos e manejo integrado
 *  - Histórico de ocorrências por fazenda/cultura
 *  - Alertas automáticos ao sistema de notificações
 *
 * Rotas:
 *  GET  /pragas               → lista todas as ocorrências do usuário
 *  POST /pragas               → registra nova ocorrência + aciona IA
 *  GET  /pragas/:id           → detalhes de uma ocorrência
 *  PUT  /pragas/:id           → atualiza status/notas da ocorrência
 *  DELETE /pragas/:id         → remove ocorrência
 *  POST /pragas/:id/diagnostico → re-executa diagnóstico da IA
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Schemas de validação ─────────────────────────────────────────────────────

const criarPragaSchema = z.object({
  fazendaId: z.number().int().positive(),
  cultura:   z.string().min(1).max(100),          // ex: "Soja", "Milho", "Pastagem"
  tipoProblema: z.enum(['praga', 'doenca', 'deficiencia', 'outro']),
  descricao: z.string().min(10).max(2000),         // descrição detalhada dos sintomas
  areaAfetadaHa: z.number().positive().optional(), // área comprometida em hectares
  fotoUrl: z.string().url().optional(),            // foto enviada via Cloudinary
  urgencia: z.enum(['baixa', 'media', 'alta', 'critica']).default('media'),
})

const atualizarPragaSchema = z.object({
  status: z.enum(['aberta', 'em_tratamento', 'resolvida', 'monitorando']).optional(),
  notasAdicionais: z.string().max(2000).optional(),
  defensivoAplicado: z.string().max(200).optional(),
  dataAplicacao: z.string().optional(),
})

// ─── Helper: chamar Groq para diagnóstico ─────────────────────────────────────

async function diagnosticarComIA(dados: {
  cultura: string
  tipoProblema: string
  descricao: string
  urgencia: string
}): Promise<{ diagnostico: string; defensivos: string[]; manejo: string; prevencao: string }> {
  const groqApiKey = process.env.GROQ_API_KEY
  if (!groqApiKey) {
    return {
      diagnostico: 'Diagnóstico de IA indisponível (chave não configurada).',
      defensivos:  [],
      manejo:      'Configure a variável GROQ_API_KEY no Render para ativar o diagnóstico automático.',
      prevencao:   '',
    }
  }

  const prompt = `Você é um agrônomo especialista brasileiro. Um produtor reportou o seguinte problema:

Cultura: ${dados.cultura}
Tipo de problema: ${dados.tipoProblema}
Urgência: ${dados.urgencia}
Descrição dos sintomas: ${dados.descricao}

Responda APENAS em JSON válido, sem texto extra, com esta estrutura exata:
{
  "diagnostico": "nome provável do problema (praga, doença ou deficiência)",
  "defensivos": ["nome comercial 1 (princípio ativo)", "nome comercial 2 (princípio ativo)"],
  "manejo": "orientações práticas de manejo e aplicação em 2-3 parágrafos",
  "prevencao": "medidas preventivas para o próximo ciclo em 1-2 parágrafos"
}`

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       'llama-3.1-8b-instant',
        max_tokens:  1024,
        temperature: 0.3, // baixo para respostas mais precisas/técnicas
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    })

    const data: any = await response.json()
    const text = data.choices?.[0]?.message?.content || ''

    // Remove possíveis blocos de código markdown antes de parsear
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed  = JSON.parse(cleaned)

    return {
      diagnostico: parsed.diagnostico || 'Não identificado',
      defensivos:  Array.isArray(parsed.defensivos) ? parsed.defensivos : [],
      manejo:      parsed.manejo      || '',
      prevencao:   parsed.prevencao   || '',
    }
  } catch (err) {
    console.error('[Pragas] Erro no diagnóstico IA:', err)
    return {
      diagnostico: 'Erro ao processar diagnóstico automático.',
      defensivos:  [],
      manejo:      'Consulte um agrônomo local para avaliação presencial.',
      prevencao:   '',
    }
  }
}

// ─── Plugin Fastify ───────────────────────────────────────────────────────────

export async function pragasRoutes(app: FastifyInstance) {

  // ── GET /pragas ─────────────────────────────────────────────────────────────
  // Lista todas as ocorrências do usuário autenticado, com filtros opcionais
  app.get('/pragas', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }

    const { fazendaId, status, urgencia } = request.query as {
      fazendaId?: string
      status?:    string
      urgencia?:  string
    }

    const where: any = {
      fazenda: { userId: payload.id }, // garante isolamento por usuário
    }
    if (fazendaId) where.fazendaId = parseInt(fazendaId)
    if (status)    where.status    = status
    if (urgencia)  where.urgencia  = urgencia

    const ocorrencias = await prisma.praga.findMany({
      where,
      include: {
        fazenda: { select: { id: true, nome: true } },
      },
      orderBy: [
        { urgencia: 'desc' }, // críticas primeiro
        { createdAt: 'desc' },
      ],
    })

    return reply.send(ocorrencias)
  })

  // ── POST /pragas ─────────────────────────────────────────────────────────────
  // Cria nova ocorrência e dispara diagnóstico IA automaticamente
  app.post('/pragas', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const result  = criarPragaSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    const dados = result.data

    // Verifica se a fazenda pertence ao usuário
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: dados.fazendaId, userId: payload.id },
    })
    if (!fazenda) {
      return reply.status(404).send({ error: 'Fazenda não encontrada.' })
    }

    // Diagnóstico IA (roda em paralelo com a criação)
    const ia = await diagnosticarComIA({
      cultura:       dados.cultura,
      tipoProblema:  dados.tipoProblema,
      descricao:     dados.descricao,
      urgencia:      dados.urgencia,
    })

    // Persiste a ocorrência com o resultado da IA
    const praga = await prisma.praga.create({
      data: {
        fazendaId:       dados.fazendaId,
        cultura:         dados.cultura,
        tipoProblema:    dados.tipoProblema,
        descricao:       dados.descricao,
        areaAfetadaHa:   dados.areaAfetadaHa,
        fotoUrl:         dados.fotoUrl,
        urgencia:        dados.urgencia,
        status:          'aberta',
        // Campos preenchidos pela IA
        diagnosticoIA:   ia.diagnostico,
        defensivosIA:    JSON.stringify(ia.defensivos),
        manejoIA:        ia.manejo,
        prevencaoIA:     ia.prevencao,
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
      },
    })

    // Cria alerta automático para ocorrências de urgência alta/crítica
    if (dados.urgencia === 'alta' || dados.urgencia === 'critica') {
      await prisma.alerta.create({
        data: {
          fazendaId: dados.fazendaId,
          tipo:      'praga',
          titulo:    `⚠️ ${dados.urgencia === 'critica' ? 'CRÍTICO' : 'ALERTA'}: Praga em ${dados.cultura}`,
          mensagem:  `${ia.diagnostico} detectado(a) na fazenda ${fazenda.nome}. Área afetada: ${dados.areaAfetadaHa ? dados.areaAfetadaHa + ' ha' : 'não informada'}.`,
          nivel:     dados.urgencia === 'critica' ? 'critico' : 'alto',
          lido:      false,
        },
      })
    }

    return reply.status(201).send(praga)
  })

  // ── GET /pragas/:id ──────────────────────────────────────────────────────────
  app.get('/pragas/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const praga = await prisma.praga.findFirst({
      where: {
        id:      parseInt(id),
        fazenda: { userId: payload.id },
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
      },
    })

    if (!praga) return reply.status(404).send({ error: 'Ocorrência não encontrada.' })
    return reply.send(praga)
  })

  // ── PUT /pragas/:id ──────────────────────────────────────────────────────────
  // Atualiza status e notas da ocorrência
  app.put('/pragas/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }
    const result  = atualizarPragaSchema.safeParse(request.body)

    if (!result.success) {
      return reply.status(400).send({ error: result.error.flatten() })
    }

    // Garante que pertence ao usuário antes de atualizar
    const existente = await prisma.praga.findFirst({
      where: { id: parseInt(id), fazenda: { userId: payload.id } },
    })
    if (!existente) return reply.status(404).send({ error: 'Ocorrência não encontrada.' })

    const atualizado = await prisma.praga.update({
      where: { id: parseInt(id) },
      data:  result.data,
    })

    return reply.send(atualizado)
  })

  // ── DELETE /pragas/:id ───────────────────────────────────────────────────────
  app.delete('/pragas/:id', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const existente = await prisma.praga.findFirst({
      where: { id: parseInt(id), fazenda: { userId: payload.id } },
    })
    if (!existente) return reply.status(404).send({ error: 'Ocorrência não encontrada.' })

    await prisma.praga.delete({ where: { id: parseInt(id) } })
    return reply.status(204).send()
  })

  // ── POST /pragas/:id/diagnostico ─────────────────────────────────────────────
  // Re-executa o diagnóstico IA (útil se a chave não estava configurada antes)
  app.post('/pragas/:id/diagnostico', {
    preHandler: async (req, reply) => { await app.authenticate(req, reply) },
  }, async (request, reply) => {
    const payload = request.user as { id: number }
    const { id }  = request.params as { id: string }

    const praga = await prisma.praga.findFirst({
      where: { id: parseInt(id), fazenda: { userId: payload.id } },
    })
    if (!praga) return reply.status(404).send({ error: 'Ocorrência não encontrada.' })

    const ia = await diagnosticarComIA({
      cultura:      praga.cultura,
      tipoProblema: praga.tipoProblema,
      descricao:    praga.descricao,
      urgencia:     praga.urgencia,
    })

    const atualizado = await prisma.praga.update({
      where: { id: parseInt(id) },
      data: {
        diagnosticoIA: ia.diagnostico,
        defensivosIA:  JSON.stringify(ia.defensivos),
        manejoIA:      ia.manejo,
        prevencaoIA:   ia.prevencao,
      },
    })

    return reply.send(atualizado)
  })
}
