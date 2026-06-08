import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')
  const hashedPassword = await bcrypt.hash('senha123', 10)
  const user = await prisma.user.upsert({
    where: { email: 'admin@sightagro.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@sightagro.com',
      password: hashedPassword,
      role: 'admin'
    }
  })
  console.log('✅ Seed concluído!')
  console.log('📧 Login: admin@sightagro.com')
  console.log('🔑 Senha: senha123')
}

main().catch(console.error).finally(() => prisma.$disconnect())
