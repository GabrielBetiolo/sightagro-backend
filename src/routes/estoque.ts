// ============================================================================
// ROTA: /estoque
// ============================================================================
// Controle de estoque de insumos rurais: sementes, fertilizantes,
// defensivos, combustível, etc.
//
// REGRA IMPORTANTE: a quantidade de um Insumo NUNCA é editada diretamente.
// Toda alteração de quantidade passa por uma MovimentacaoEstoque (entrada
// ou saída), garantindo histórico completo e rastreabilidade.
//
// Quando uma saída faz o estoque cair para igual ou abaixo do
// "estoqueMinimo" definido, um alerta é gerado automaticamente.
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

export const CATEGORIAS_INSUMO = ['Semente', 'Fertilizante', 'Defensivo', 'Combustível', 'Outro'] as const
export const UNIDADES_INSUMO = ['kg', 'L', 'sc', 'ton', 'un'] as const

export async function estoqueRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest, rep: FastifyReply) => {
    await app.authenticate(req, rep)
  }

  // ==========================================================================
  // INSUMOS (itens de estoque)
  // ==========================================================================

  // --------------------------------------------------------------------
  // GET /estoque
  // Lista insumos do usuário com flag "estoqueBaixo" calculada.
  // Query: ?fazendaId= | ?categoria= | ?estoqueBaixo=true
  // --------------------------------------------------------------------
  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId, categoria, estoqueBaixo } = request.query as {
      fazendaId?: string; categoria?: string; estoqueBaixo?: string
    }

    const insumos = await prisma.insumo.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) }),
        ...(categoria && { categoria })
      },
      include: { fazenda: { select: { id: true, nome: true } } },
      orderBy: { nome: 'asc' }
    })

    // Adiciona flag calculada e filtra se solicitado
    const comFlag = insumos.map((i) => ({ ...i, estoqueBaixo: i.quantidade <= i.estoqueMinimo }))

    if (estoqueBaixo === 'true') {
      return comFlag.filter((i) => i.estoqueBaixo)
    }
    return comFlag
  })

  // --------------------------------------------------------------------
  // POST /estoque
  // Cria um novo insumo. A quantidade inicial é registrada também como
  // uma MovimentacaoEstoque do tipo "entrada" (motivo: "Cadastro inicial"),
  // para manter o histórico consistente desde o início.
  // --------------------------------------------------------------------
  app.post('/', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1),
      categoria: z.enum(CATEGORIAS_INSUMO),
      unidade: z.enum(UNIDADES_INSUMO),
      quantidade: z.number().min(0).default(0),
      estoqueMinimo: z.number().min(0).default(0),
      precoUnitario: z.number().positive().optional(),
      fornecedor: z.string().optional(),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const data = result.data

    const fazenda = await prisma.fazenda.findFirst({ where: { id: data.fazendaId, userId: payload.id } })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    // Cria o insumo e, se houver quantidade inicial, registra a movimentação
    const insumo = await prisma.insumo.create({
      data: {
        nome: data.nome,
        categoria: data.categoria,
        unidade: data.unidade,
        quantidade: data.quantidade,
        estoqueMinimo: data.estoqueMinimo,
        precoUnitario: data.precoUnitario ?? null,
        fornecedor: data.fornecedor || null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    if (data.quantidade > 0) {
      await prisma.movimentacaoEstoque.create({
        data: {
          tipo: 'entrada',
          quantidade: data.quantidade,
          motivo: 'Cadastro inicial',
          insumo: { connect: { id: insumo.id } },
          fazenda: { connect: { id: data.fazendaId } }
        }
      })
    }

    return reply.status(201).send({ ...insumo, estoqueBaixo: insumo.quantidade <= insumo.estoqueMinimo })
  })

  // --------------------------------------------------------------------
  // PUT /estoque/:id
  // Atualiza metadados do insumo (NÃO altera quantidade - isso é feito
  // exclusivamente via /estoque/:id/movimentacao)
  // --------------------------------------------------------------------
  app.put('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1).optional(),
      categoria: z.enum(CATEGORIAS_INSUMO).optional(),
      unidade: z.enum(UNIDADES_INSUMO).optional(),
      estoqueMinimo: z.number().min(0).optional(),
      precoUnitario: z.number().positive().optional().or(z.null()),
      fornecedor: z.string().optional().or(z.null())
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const existente = await prisma.insumo.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Insumo não encontrado' })

    const d = result.data
    const insumo = await prisma.insumo.update({
      where: { id: Number(id) },
      data: {
        ...(d.nome !== undefined && { nome: d.nome }),
        ...(d.categoria !== undefined && { categoria: d.categoria }),
        ...(d.unidade !== undefined && { unidade: d.unidade }),
        ...(d.estoqueMinimo !== undefined && { estoqueMinimo: d.estoqueMinimo }),
        ...(d.precoUnitario !== undefined && { precoUnitario: d.precoUnitario }),
        ...(d.fornecedor !== undefined && { fornecedor: d.fornecedor })
      }
    })

    return { ...insumo, estoqueBaixo: insumo.quantidade <= insumo.estoqueMinimo }
  })

  // --------------------------------------------------------------------
  // DELETE /estoque/:id
  // Remove o insumo e todo o histórico de movimentações associado
  // --------------------------------------------------------------------
  app.delete('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.insumo.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!existente) return reply.status(404).send({ message: 'Insumo não encontrado' })

    await prisma.movimentacaoEstoque.deleteMany({ where: { insumoId: Number(id) } })
    await prisma.insumo.delete({ where: { id: Number(id) } })

    return reply.status(204).send()
  })

  // ==========================================================================
  // MOVIMENTAÇÕES (entrada / saída de estoque)
  // ==========================================================================

  // --------------------------------------------------------------------
  // POST /estoque/:id/movimentacao
  // Registra uma entrada ou saída e atualiza a quantidade do insumo
  // de forma ATÔMICA (usando transação do Prisma) para evitar
  // inconsistências em caso de concorrência.
  //
  // Se o tipo for "saida" e a quantidade solicitada for maior que o
  // estoque atual, a operação é REJEITADA (não permite estoque negativo).
  // --------------------------------------------------------------------
  app.post('/:id/movimentacao', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      tipo: z.enum(['entrada', 'saida']),
      quantidade: z.number().positive('A quantidade deve ser maior que zero'),
      motivo: z.string().optional()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    const insumo = await prisma.insumo.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!insumo) return reply.status(404).send({ message: 'Insumo não encontrado' })

    const { tipo, quantidade, motivo } = result.data

    if (tipo === 'saida' && quantidade > insumo.quantidade) {
      return reply.status(400).send({
        message: `Estoque insuficiente. Disponível: ${insumo.quantidade} ${insumo.unidade}`
      })
    }

    const novaQuantidade = tipo === 'entrada' ? insumo.quantidade + quantidade : insumo.quantidade - quantidade

    // Transação: garante que a movimentação e a atualização de quantidade
    // aconteçam juntas (ou nenhuma das duas, em caso de erro)
    const [movimentacao, insumoAtualizado] = await prisma.$transaction([
      prisma.movimentacaoEstoque.create({
        data: {
          tipo,
          quantidade,
          motivo: motivo || null,
          insumo: { connect: { id: insumo.id } },
          fazenda: { connect: { id: insumo.fazendaId } }
        }
      }),
      prisma.insumo.update({
        where: { id: insumo.id },
        data: { quantidade: novaQuantidade }
      })
    ])

    // Gera alerta automático se o estoque ficou baixo após a saída
    if (tipo === 'saida' && novaQuantidade <= insumo.estoqueMinimo) {
      const tituloAlerta = `Estoque baixo: ${insumo.nome}`
      const existeAlerta = await prisma.alerta.findFirst({
        where: {
          fazendaId: insumo.fazendaId,
          titulo: tituloAlerta,
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }
        }
      })
      if (!existeAlerta) {
        await prisma.alerta.create({
          data: {
            tipo: 'warning',
            titulo: tituloAlerta,
            descricao: `Restam apenas ${novaQuantidade} ${insumo.unidade} de ${insumo.nome} (mínimo definido: ${insumo.estoqueMinimo}).`,
            fazendaId: insumo.fazendaId
          }
        })
      }
    }

    return reply.status(201).send({
      movimentacao,
      insumo: { ...insumoAtualizado, estoqueBaixo: insumoAtualizado.quantidade <= insumoAtualizado.estoqueMinimo }
    })
  })

  // --------------------------------------------------------------------
  // GET /estoque/:id/movimentacoes
  // Histórico de movimentações de um insumo específico
  // --------------------------------------------------------------------
  app.get('/:id/movimentacoes', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const insumo = await prisma.insumo.findFirst({ where: { id: Number(id), fazenda: { userId: payload.id } } })
    if (!insumo) return reply.status(404).send({ message: 'Insumo não encontrado' })

    return prisma.movimentacaoEstoque.findMany({
      where: { insumoId: Number(id) },
      orderBy: { data: 'desc' }
    })
  })

  // --------------------------------------------------------------------
  // GET /estoque/resumo
  // Resumo geral do estoque: total de itens, itens com estoque baixo,
  // valor total estimado (quantidade × precoUnitario) por categoria.
  // --------------------------------------------------------------------
  app.get('/resumo', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }
    const { fazendaId } = request.query as { fazendaId?: string }

    const insumos = await prisma.insumo.findMany({
      where: {
        fazenda: { userId: payload.id },
        ...(fazendaId && { fazendaId: Number(fazendaId) })
      }
    })

    let valorTotalEstoque = 0
    let itensEstoqueBaixo = 0
    const porCategoria: Record<string, { itens: number; valor: number }> = {}

    for (const i of insumos) {
      const valorItem = (i.precoUnitario || 0) * i.quantidade
      valorTotalEstoque += valorItem
      if (i.quantidade <= i.estoqueMinimo) itensEstoqueBaixo++

      if (!porCategoria[i.categoria]) porCategoria[i.categoria] = { itens: 0, valor: 0 }
      porCategoria[i.categoria].itens++
      porCategoria[i.categoria].valor += valorItem
    }

    return {
      totalItens: insumos.length,
      itensEstoqueBaixo,
      valorTotalEstoque,
      porCategoria
    }
  })
}
