-- CG-NFR32: Consent provenance records
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CG-NFR31: Data subject request lifecycle
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "reason" TEXT,
    "fulfilledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CG-NFR33: Versioned subprocessor inventory
CREATE TABLE "SubprocessorEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "dataTypes" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "dpaUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubprocessorEntry_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ConsentRecord_userId_idx" ON "ConsentRecord"("userId");
CREATE INDEX "ConsentRecord_purpose_idx" ON "ConsentRecord"("purpose");
CREATE INDEX "DataSubjectRequest_userId_idx" ON "DataSubjectRequest"("userId");
CREATE INDEX "DataSubjectRequest_status_idx" ON "DataSubjectRequest"("status");
CREATE INDEX "SubprocessorEntry_active_idx" ON "SubprocessorEntry"("active");

-- CG-NFR40: Prompt template hash for analysis reproducibility
ALTER TABLE "AnalysisResult" ADD COLUMN "promptTemplateHash" TEXT;
