/*
  Warnings:

  - Made the column `createdBy` on table `SettlementRun` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "settlement"."SettlementRun" ALTER COLUMN "createdBy" SET NOT NULL;
