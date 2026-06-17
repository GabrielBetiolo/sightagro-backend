// ============================================================================
// ROTA: /colaboradores
// ============================================================================
// Gestão de equipe rural: colaboradores (funcionários), tarefas (kanban)
// e controle de ponto simplificado.
//
// Organização:
//   /colaboradores              → CRUD de colaboradores
//   /colaboradores/:id/ponto    → Registro de ponto do colaborador
//   /tarefas                    → CRUD de tarefas (todas as fazendas)
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

// Funções disponíveis no campo de trabalho (sugeridas no frontend)
export const FUNCOES = [
  'Gerente de fazenda',
  'Encarregado',
  'Tratorista',
  'Operador de máquinas',
  'Irrigador',
  'Aplicador de defensivos',
  'Colhedor',
  'Peão de gado',
  'Mecânico',
  'Outro'
] as const

export async function colaboradoresRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => {
    await app.authenticate(req, rep)
  }

  // ==========================================================================
  // COLABORADORES
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /colaboradores
  // Lista todos os colaboradores de todas as fazendas do usuário.
  // Query: ?fazendaId=1  (filtra por fazenda)
  //        ?status=ativo  (filtra por status: ativo | inativo)
  // --------------------------------------------------------------------
  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId, status } = request.query as { fazendaId?: string; status?: string }

    return prisma.colaborador.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) }),
        ...(status && { status })
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
        // Inclui contagem de tarefas pendentes do colaborador
        _count: { select: { tarefas: true, registrosPonto: true } }
      },
      orderBy: { nome: 'asc' }
    })
  })

  // --------------------------------------------------------------------
  // POST /colaboradores
  // Cadastra um novo colaborador
  // --------------------------------------------------------------------
  app.post('/', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
      funcao: z.string().min(1, 'Função é obrigatória'),
      telefone: z.string().optional(),
      email: z.string().email().optional().or(z.literal('')),
      dataAdmissao: z.string().datetime().optional().or(z.literal('')),
      salario: z.number().positive().optional(),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const data = result.data

    // Garante que a fazenda pertence ao usuário autenticado
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: data.fazendaId, userId: payload.id }
    })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const colaborador = await prisma.colaborador.create({
      data: {
        nome: data.nome,
        funcao: data.funcao,
        telefone: data.telefone || null,
        email: data.email || null,
        dataAdmissao: data.dataAdmissao ? new Date(data.dataAdmissao) : null,
        salario: data.salario ?? null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    return reply.status(201).send(colaborador)
  })

  // --------------------------------------------------------------------
  // PUT /colaboradores/:id
  // Atualiza dados de um colaborador (inclusive mudar para "inativo")
  // --------------------------------------------------------------------
  app.put('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(2).optional(),
      funcao: z.string().min(1).optional(),
      telefone: z.string().optional().or(z.null()),
      email: z.string().email().optional().or(z.literal('')).or(z.null()),
      dataAdmissao: z.string().datetime().optional().or(z.literal('')).or(z.null()),
      salario: z.number().positive().optional().or(z.null()),
      status: z.enum(['ativo', 'inativo']).optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const existente = await prisma.colaborador.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Colaborador não encontrado' })

    const d = result.data
    return prisma.colaborador.update({
      where: { id: Number(id) },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.funcao !== undefined && { funcao: d.funcao }),
        ...(d.telefone !== undefined && { telefone: d.telefone || null }),
        ...(d.email !== undefined && { email: d.email || null }),
        ...(d.dataAdmissao !== undefined && {
          dataAdmissao: d.dataAdmissao ? new Date(d.dataAdmissao) : null
        }),
        ...(d.salario !== undefined && { salario: d.salario }),
        ...(d.status !== undefined && { status: d.status })
      }
    })
  })

  // --------------------------------------------------------------------
  // DELETE /colaboradores/:id
  // Remove colaborador — também apaga registros de ponto e tarefas vinculadas
  // --------------------------------------------------------------------
  app.delete('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.colaborador.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Colaborador não encontrado' })

    // Remove dependentes primeiro para não violar constraints de FK
    await prisma.registroPonto.deleteMany({ where: { colaboradorId: Number(id) } })
    await prisma.tarefa.updateMany({
      where: { colaboradorId: Number(id) },
      data: { colaboradorId: null } // Mantém a tarefa, só desvincula o colaborador
    })
    await prisma.colaborador.delete({ where: { id: Number(id) } })

    return reply.status(204).send()
  })

  // ==========================================================================
  // REGISTRO DE PONTO
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /colaboradores/:id/ponto
  // Lista registros de ponto de um colaborador.
  // Query: ?mes=2026-06  → filtra por mês no formato YYYY-MM
  // Retorna também um resumo: total de dias, total de horas no período.
  // --------------------------------------------------------------------
  app.get('/:id/ponto', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }
    const { mes } = request.query as { mes?: string }

    // Garante que o colaborador pertence ao usuário
    const colaborador = await prisma.colaborador.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!colaborador) return reply.status(404).send({ message: 'Colaborador não encontrado' })

    // Monta filtro de datas se o mês foi informado
    let filtroData = {}
    if (mes) {
      const [ano, mesNum] = mes.split('-').map(Number)
      const inicio = new Date(ano, mesNum - 1, 1)
      const fim = new Date(ano, mesNum, 0, 23, 59, 59)
      filtroData = { data: { gte: inicio, lte: fim } }
    }

    const registros = await prisma.registroPonto.findMany({
      where: { colaboradorId: Number(id), ...filtroData },
      orderBy: { data: 'desc' }
    })

    // Calcula total de horas trabalhadas no período
    let totalMinutos = 0
    for (const r of registros) {
      if (r.entrada && r.saida) {
        totalMinutos += (r.saida.getTime() - r.entrada.getTime()) / 60000
      }
    }

    return {
      registros,
      resumo: {
        totalDias: registros.length,
        totalHoras: Math.floor(totalMinutos / 60),
        totalMinutos: totalMinutos % 60
      }
    }
  })

  // --------------------------------------------------------------------
  // POST /colaboradores/:id/ponto
  // Registra entrada e/ou saída de um colaborador em um dia.
  // Se já existe registro no dia, atualiza (upsert).
  // --------------------------------------------------------------------
  app.post('/:id/ponto', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      data: z.string().datetime(),        // dia de referência
      entrada: z.string().datetime().optional(),
      saida: z.string().datetime().optional(),
      observacao: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const colaborador = await prisma.colaborador.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!colaborador) return reply.status(404).send({ message: 'Colaborador não encontrado' })

    const d = result.data
    const dataRef = new Date(d.data)

    // Upsert: cria se não existe, atualiza se já existe no mesmo dia
    const registro = await prisma.registroPonto.upsert({
      where: {
        // Não temos um unique composto no schema, então buscamos manualmente
        id: (await prisma.registroPonto.findFirst({
          where: {
            colaboradorId: Number(id),
            data: {
              gte: new Date(dataRef.getFullYear(), dataRef.getMonth(), dataRef.getDate()),
              lt: new Date(dataRef.getFullYear(), dataRef.getMonth(), dataRef.getDate() + 1)
            }
          }
        }))?.id ?? 0 // 0 → forçará o create
      },
      update: {
        ...(d.entrada && { entrada: new Date(d.entrada) }),
        ...(d.saida && { saida: new Date(d.saida) }),
        ...(d.observacao !== undefined && { observacao: d.observacao })
      },
      create: {
        colaboradorId: Number(id),
        data: dataRef,
        entrada: d.entrada ? new Date(d.entrada) : null,
        saida: d.saida ? new Date(d.saida) : null,
        observacao: d.observacao || null
      }
    })

    return reply.status(201).send(registro)
  })

  // ==========================================================================
  // TAREFAS
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /colaboradores/tarefas
  // Lista todas as tarefas das fazendas do usuário.
  // Query: ?fazendaId=1 | ?status=pendente | ?colaboradorId=2
  // --------------------------------------------------------------------
  app.get('/tarefas', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId, status, colaboradorId } = request.query as {
      fazendaId?: string; status?: string; colaboradorId?: string
    }

    return prisma.tarefa.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) }),
        ...(status && { status }),
        ...(colaboradorId && { colaboradorId: Number(colaboradorId) })
      },
      include: {
        fazenda: { select: { id: true, nome: true } },
        colaborador: { select: { id: true, nome: true, funcao: true } }
      },
      orderBy: [
        // Ordena por prioridade (alta primeiro) e depois por prazo
        { prioridade: 'desc' },
        { dataPrazo: 'asc' }
      ]
    })
  })

  // --------------------------------------------------------------------
  // POST /colaboradores/tarefas
  // --------------------------------------------------------------------
  app.post('/tarefas', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      titulo: z.string().min(1),
      descricao: z.string().optional(),
      prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
      dataPrazo: z.string().datetime().optional().or(z.literal('')),
      colaboradorId: z.number().optional().or(z.null()),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const data = result.data

    const fazenda = await prisma.fazenda.findFirst({
      where: { id: data.fazendaId, userId: payload.id }
    })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const tarefa = await prisma.tarefa.create({
      data: {
        titulo: data.titulo,
        descricao: data.descricao || null,
        prioridade: data.prioridade,
        dataPrazo: data.dataPrazo ? new Date(data.dataPrazo) : null,
        colaboradorId: data.colaboradorId ?? null,
        fazenda: { connect: { id: data.fazendaId } }
      },
      include: {
        colaborador: { select: { id: true, nome: true } }
      }
    })

    return reply.status(201).send(tarefa)
  })

  // --------------------------------------------------------------------
  // PUT /colaboradores/tarefas/:id
  // Atualiza uma tarefa — inclusive mover de status (kanban)
  // --------------------------------------------------------------------
  app.put('/tarefas/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      titulo: z.string().min(1).optional(),
      descricao: z.string().optional().or(z.null()),
      status: z.enum(['pendente', 'em_andamento', 'concluida']).optional(),
      prioridade: z.enum(['baixa', 'media', 'alta']).optional(),
      dataPrazo: z.string().datetime().optional().or(z.literal('')).or(z.null()),
      colaboradorId: z.number().optional().or(z.null())
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.tarefa.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Tarefa não encontrada' })

    const d = result.data
    return prisma.tarefa.update({
      where: { id: Number(id) },
      data: {
        ...(d.titulo !== undefined && { titulo: d.titulo }),
        ...(d.descricao !== undefined && { descricao: d.descricao || null }),
        ...(d.status !== undefined && { status: d.status }),
        ...(d.prioridade !== undefined && { prioridade: d.prioridade }),
        ...(d.dataPrazo !== undefined && { dataPrazo: d.dataPrazo ? new Date(d.dataPrazo) : null }),
        ...(d.colaboradorId !== undefined && { colaboradorId: d.colaboradorId })
      },
      include: {
        colaborador: { select: { id: true, nome: true } }
      }
    })
  })

  // --------------------------------------------------------------------
  // DELETE /colaboradores/tarefas/:id
  // --------------------------------------------------------------------
  app.delete('/tarefas/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.tarefa.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Tarefa não encontrada' })

    await prisma.tarefa.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })
}
