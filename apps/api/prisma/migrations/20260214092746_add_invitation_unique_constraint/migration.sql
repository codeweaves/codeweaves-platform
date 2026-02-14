/*
  Warnings:

  - A unique constraint covering the columns `[email,status,organizationId]` on the table `user_invitations` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "user_invitations_email_status_organizationId_key" ON "user_invitations"("email", "status", "organizationId");
