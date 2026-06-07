-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mpSubscriptionId" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'free',
ADD COLUMN     "planExpiresAt" TIMESTAMP(3);
