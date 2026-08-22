-- CreateEnum
CREATE TYPE "CenterUserRole" AS ENUM ('OWNER', 'MANAGER');

-- CreateTable
CREATE TABLE "centers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_users" (
    "id" TEXT NOT NULL,
    "center_id" TEXT NOT NULL,
    "role" "CenterUserRole" NOT NULL DEFAULT 'OWNER',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "password_hash" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verification_token" TEXT,
    "email_verification_expires" TIMESTAMP(3),
    "password_reset_token" TEXT,
    "password_reset_expires" TIMESTAMP(3),

    CONSTRAINT "center_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "center_device_sessions" (
    "id" TEXT NOT NULL,
    "center_user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "device_name" TEXT,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "center_device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "center_users_email_key" ON "center_users"("email");

-- CreateIndex
CREATE INDEX "center_users_center_id_idx" ON "center_users"("center_id");

-- CreateIndex
CREATE INDEX "center_users_email_verification_token_idx" ON "center_users"("email_verification_token");

-- CreateIndex
CREATE INDEX "center_users_password_reset_token_idx" ON "center_users"("password_reset_token");

-- CreateIndex
CREATE UNIQUE INDEX "center_device_sessions_center_user_id_device_id_key" ON "center_device_sessions"("center_user_id", "device_id");

-- CreateIndex
CREATE INDEX "center_device_sessions_center_user_id_idx" ON "center_device_sessions"("center_user_id");

-- AddForeignKey
ALTER TABLE "center_users" ADD CONSTRAINT "center_users_center_id_fkey" FOREIGN KEY ("center_id") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "center_device_sessions" ADD CONSTRAINT "center_device_sessions_center_user_id_fkey" FOREIGN KEY ("center_user_id") REFERENCES "center_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
