-- CreateTable
CREATE TABLE "Transacao" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "fazendaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Financiamento" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "instituicao" TEXT NOT NULL,
    "descricao" TEXT,
    "valor" DOUBLE PRECISION NOT NULL,
    "taxaJuros" DOUBLE PRECISION,
    "dataContratacao" TIMESTAMP(3),
    "dataVencimento" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "fazendaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Financiamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Colaborador" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT,
    "dataAdmissao" TIMESTAMP(3),
    "salario" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ativo',
    "fazendaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarefa" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "prioridade" TEXT NOT NULL DEFAULT 'media',
    "dataPrazo" TIMESTAMP(3),
    "colaboradorId" INTEGER,
    "fazendaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroPonto" (
    "id" SERIAL NOT NULL,
    "colaboradorId" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "entrada" TIMESTAMP(3),
    "saida" TIMESTAMP(3),
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistroPonto_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Transacao" ADD CONSTRAINT "Transacao_fazendaId_fkey" FOREIGN KEY ("fazendaId") REFERENCES "Fazenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Financiamento" ADD CONSTRAINT "Financiamento_fazendaId_fkey" FOREIGN KEY ("fazendaId") REFERENCES "Fazenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_fazendaId_fkey" FOREIGN KEY ("fazendaId") REFERENCES "Fazenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_fazendaId_fkey" FOREIGN KEY ("fazendaId") REFERENCES "Fazenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroPonto" ADD CONSTRAINT "RegistroPonto_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
