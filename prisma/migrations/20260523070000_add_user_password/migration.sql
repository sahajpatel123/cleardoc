-- Add password column to User. Nullable so existing OAuth-created rows survive.
ALTER TABLE "User" ADD COLUMN "password" TEXT;
