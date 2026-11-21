import { setTimeout as delay } from 'node:timers/promises';
import { buildUserActor } from '../src/core/auth/actor.js';
import { businessDate, clock } from '../src/core/time/clock.js';
import { prisma } from '../src/db/client.js';
import { aiService } from '../src/modules/ai/ai.service.js';

try {
  const supervisor = await prisma.user.findFirst({
    where: { role: 'supervisor', status: 'active', isDemo: true },
    orderBy: { id: 'asc' },
  });
  if (!supervisor) throw new Error('Seed an active supervisor before running the AI smoke check');
  const { request } = await aiService.requestSuggestion(buildUserActor(supervisor), {
    capability: 'supervisor_daily_summary',
    subjectId: supervisor.id,
    locale: 'ar',
    filters: { workDate: businessDate(clock.now()) },
  });
  const deadline = Date.now() + 60_000;
  while (true) {
    const row = await prisma.aiRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { suggestion: true },
    });
    const suggestion = row.suggestion;
    if (suggestion || row.status === 'send_failed' || Date.now() >= deadline) {
      process.stdout.write(
        JSON.stringify({
          requestId: row.requestId,
          status: row.status,
          attempts: row.attempts,
          lastError: row.lastError,
          suggestionId: suggestion?.id ?? null,
          modelVersion: suggestion?.modelVersion ?? null,
          confidence: suggestion ? Number(suggestion.confidence) : null,
          output: suggestion
            ? suggestion.output.error
              ? 'error'
              : suggestion.output.fallback
                ? 'fallback'
                : 'normal'
            : null,
        }) + '\n',
      );
      if (!suggestion) process.exitCode = 1;
      break;
    }
    await delay(1000);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
