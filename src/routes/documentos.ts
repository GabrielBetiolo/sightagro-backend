// ============================================================================
// ROTA: /documentos
// ============================================================================
// Gerencia os documentos da propriedade rural (INCRA, ITR, CCIR, Matrícula,
// GTA, etc.). O arquivo físico é enviado pelo FRONTEND diretamente ao
// Cloudinary (assim como o avatar) - aqui só recebemos a URL resultante.
//
// Também é responsável por verificar documentos vencidos/a vencer e gerar
// alertas automáticos (reaproveitando a lógica de notificação já usada
// pelo clima e pelos sensores).
// ============================================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'

const prisma = new PrismaClient()

// Tipos de documento aceitos pelo sistema.
// Mantido aqui para validação e também exportado implicitamente via Zod enum.
const TIPOS_DOCUMENTO = ['INCRA', 'ITR', 'CCIR', 'MATRICULA', 'GTA', 'OUTRO'] as const

// Quantos dias antes do vencimento o sistema já considera "atenção"
const DIAS_AVISO_VENCIMENTO = 30

/**
 * Calcula o status de um documento com base na data de vencimento.
 * - 'sem_vencimento': documento não possui data de validade (ex: matrícula)
 * - 'vencido': já passou da data de vencimento
 * - 'vencendo': vence dentro de DIAS_AVISO_VENCIMENTO dias
 * - 'valido': vencimento distante
 */
function calcularStatus(dataVencimento: Date | null): 'sem_vencimento' | 'vencido' | 'vencendo' | 'valido' {
  if (!dataVencimento) return 'sem_vencimento'

  const hoje = new Date()
  const diffMs = dataVencimento.getTime() - hoje.getTime()
  const diffDias = diffMs / (1000 * 60 * 60 * 24)

  if (diffDias < 0) return 'vencido'
  if (diffDias <= DIAS_AVISO_VENCIMENTO) return 'vencendo'
  return 'valido'
}

export async function documentosRoutes(app: FastifyInstance) {
  // Middleware de autenticação reutilizado em todas as rotas abaixo
  const auth = async (req: FastifyRequest, rep: FastifyReply) => {
    await app.authenticate(req, rep)
  }

  // --------------------------------------------------------------------
  // GET /documentos
  // Lista todos os documentos de todas as fazendas do usuário logado,
  // já com o "status" calculado (sem_vencimento | vencido | vencendo | valido)
  // --------------------------------------------------------------------
  app.get('/', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }

    const documentos = await prisma.documento.findMany({
      where: { fazenda: { userId: payload.id } },
      include: { fazenda: { select: { id: true, nome: true } } },
      orderBy: { dataVencimento: 'asc' }
    })

    // Adiciona o campo "status" calculado dinamicamente em cada documento
    return documentos.map((doc) => ({
      ...doc,
      status: calcularStatus(doc.dataVencimento)
    }))
  })

  // --------------------------------------------------------------------
  // GET /documentos/fazenda/:fazendaId
  // Lista documentos de UMA fazenda específica
  // --------------------------------------------------------------------
  app.get('/fazenda/:fazendaId', { preHandler: auth }, async (request, reply) => {
    const { fazendaId } = request.params as { fazendaId: string }
    const payload = request.user as { id: number }

    // Garante que a fazenda pertence ao usuário logado
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: Number(fazendaId), userId: payload.id }
    })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const documentos = await prisma.documento.findMany({
      where: { fazendaId: Number(fazendaId) },
      orderBy: { dataVencimento: 'asc' }
    })

    return documentos.map((doc) => ({
      ...doc,
      status: calcularStatus(doc.dataVencimento)
    }))
  })

  // --------------------------------------------------------------------
  // POST /documentos
  // Cria um novo documento. O arquivo já deve ter sido enviado ao
  // Cloudinary pelo frontend - aqui só recebemos a URL resultante.
  // --------------------------------------------------------------------
  app.post('/', { preHandler: auth }, async (request, reply) => {
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1, 'Nome é obrigatório'),
      tipo: z.enum(TIPOS_DOCUMENTO),
      arquivoUrl: z.string().url('URL do arquivo inválida'),
      arquivoTipo: z.string().min(1),
      numero: z.string().optional(),
      dataEmissao: z.string().datetime().optional().or(z.literal('')),
      dataVencimento: z.string().datetime().optional().or(z.literal('')),
      fazendaId: z.number()
    })

    const result = schema.safeParse(request.body)
    if (!result.success) {
      return reply.status(400).send({ message: result.error.errors[0].message })
    }

    const data = result.data

    // Confirma que a fazenda pertence ao usuário autenticado
    const fazenda = await prisma.fazenda.findFirst({
      where: { id: data.fazendaId, userId: payload.id }
    })
    if (!fazenda) return reply.status(404).send({ message: 'Fazenda não encontrada' })

    const documento = await prisma.documento.create({
      data: {
        nome: data.nome,
        tipo: data.tipo,
        arquivoUrl: data.arquivoUrl,
        arquivoTipo: data.arquivoTipo,
        numero: data.numero || null,
        dataEmissao: data.dataEmissao ? new Date(data.dataEmissao) : null,
        dataVencimento: data.dataVencimento ? new Date(data.dataVencimento) : null,
        fazenda: { connect: { id: data.fazendaId } }
      }
    })

    return reply.status(201).send({ ...documento, status: calcularStatus(documento.dataVencimento) })
  })

  // --------------------------------------------------------------------
  // PUT /documentos/:id
  // Atualiza metadados de um documento (não permite troca de arquivo aqui;
  // para troca de arquivo, o usuário deve excluir e criar um novo)
  // --------------------------------------------------------------------
  app.put('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const schema = z.object({
      nome: z.string().min(1).optional(),
      tipo: z.enum(TIPOS_DOCUMENTO).optional(),
      numero: z.string().optional(),
      dataEmissao: z.string().datetime().optional().or(z.literal('')).or(z.null()),
      dataVencimento: z.string().datetime().optional().or(z.literal('')).or(z.null())
    })

    const result = schema.safeParse(request.body)
    if (!result.success) return reply.status(400).send({ message: result.error.errors[0].message })

    // Verifica posse do documento (via fazenda -> userId)
    const existente = await prisma.documento.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Documento não encontrado' })

    const data = result.data
    const documento = await prisma.documento.update({
      where: { id: Number(id) },
      data: {
        ...(data.nome !== undefined && { nome: data.nome }),
        ...(data.tipo !== undefined && { tipo: data.tipo }),
        ...(data.numero !== undefined && { numero: data.numero || null }),
        ...(data.dataEmissao !== undefined && {
          dataEmissao: data.dataEmissao ? new Date(data.dataEmissao) : null
        }),
        ...(data.dataVencimento !== undefined && {
          dataVencimento: data.dataVencimento ? new Date(data.dataVencimento) : null
        })
      }
    })

    return { ...documento, status: calcularStatus(documento.dataVencimento) }
  })

  // --------------------------------------------------------------------
  // DELETE /documentos/:id
  // Remove o registro do documento (o arquivo no Cloudinary permanece,
  // mas deixa de ser referenciado pelo sistema)
  // --------------------------------------------------------------------
  app.delete('/:id', { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const payload = request.user as { id: number }

    const existente = await prisma.documento.findFirst({
      where: { id: Number(id), fazenda: { userId: payload.id } }
    })
    if (!existente) return reply.status(404).send({ message: 'Documento não encontrado' })

    await prisma.documento.delete({ where: { id: Number(id) } })
    return reply.status(204).send()
  })

  // --------------------------------------------------------------------
  // POST /documentos/verificar-vencimentos
  // Verifica todos os documentos do usuário e cria alertas para os que
  // estão vencidos ou vencendo em breve. Pensado para ser chamado quando
  // o usuário abre a tela de Documentos (similar ao que /clima faz).
  //
  // Evita duplicar alertas: só cria um novo alerta se não existir um
  // alerta igual criado nas últimas 24 horas para o mesmo documento.
  // --------------------------------------------------------------------
  app.post('/verificar-vencimentos', { preHandler: auth }, async (request) => {
    const payload = request.user as { id: number }

    const documentos = await prisma.documento.findMany({
      where: {
        fazenda: { userId: payload.id },
        dataVencimento: { not: null }
      },
      include: { fazenda: { select: { id: true, nome: true } } }
    })

    const alertasGerados: any[] = []

    for (const doc of documentos) {
      const status = calcularStatus(doc.dataVencimento)
      if (status !== 'vencido' && status !== 'vencendo') continue

      const titulo =
        status === 'vencido'
          ? `Documento vencido: ${doc.nome}`
          : `Documento próximo do vencimento: ${doc.nome}`

      const dataFormatada = doc.dataVencimento?.toLocaleDateString('pt-BR')
      const descricao =
        status === 'vencido'
          ? `O documento "${doc.nome}" (${doc.tipo}) da fazenda ${doc.fazenda.nome} venceu em ${dataFormatada}.`
          : `O documento "${doc.nome}" (${doc.tipo}) da fazenda ${doc.fazenda.nome} vence em ${dataFormatada}.`

      // Evita duplicar o mesmo alerta nas últimas 24h
      const existeAlerta = await prisma.alerta.findFirst({
        where: {
          fazendaId: doc.fazenda.id,
          titulo,
          createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }
        }
      })

      if (!existeAlerta) {
        const alerta = await prisma.alerta.create({
          data: {
            tipo: status === 'vencido' ? 'danger' : 'warning',
            titulo,
            descricao,
            fazendaId: doc.fazenda.id
          }
        })
        alertasGerados.push(alerta)
      }
    }

    return { alertasGerados: alertasGerados.length }
  })
}
