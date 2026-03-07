-- CG-FR30: LLM prompt/response audit log (PII stripped before storage)
CREATE TABLE "PromptLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "pipelineRunId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptLog_sessionId_idx" ON "PromptLog"("sessionId");

-- CreateIndex
CREATE INDEX "PromptLog_pipelineRunId_idx" ON "PromptLog"("pipelineRunId");

-- AddForeignKey
ALTER TABLE "PromptLog" ADD CONSTRAINT "PromptLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
