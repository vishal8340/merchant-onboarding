/**
 * backfillNoneRisks.ts
 *
 * One-shot migration: removes "❌ Detected Risk: None" (and any variant of
 * "Detected Risk: None") from the `agentResults[].findings` array of all
 * existing Application documents in MongoDB.
 *
 * These entries were created before the None-risk filter was added to
 * mccAgent.ts. Running this script cleans up historical records so the
 * Review Console and Application Status pages no longer show the false ❌.
 *
 * Run: npx ts-node src/scripts/backfillNoneRisks.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';

async function run() {
  const MONGODB_URI =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/merchant-onboarding';
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const col = mongoose.connection.db!.collection('applications');

  // Find applications that have any finding containing "Detected Risk: None"
  const apps = await col
    .find({
      'agentResults.findings': {
        $elemMatch: { $regex: /Detected Risk:\s*None/i },
      },
    })
    .toArray();

  console.log(`Found ${apps.length} application(s) with "Detected Risk: None" findings`);

  let totalRemoved = 0;
  let updatedApps = 0;

  for (const app of apps) {
    const agentResults = app.agentResults as any[];
    if (!Array.isArray(agentResults)) continue;

    let appChanged = false;

    const cleaned = agentResults.map((agent: any) => {
      if (!Array.isArray(agent.findings)) return agent;

      const before = agent.findings.length;
      const filtered = agent.findings.filter(
        (f: string) => !/Detected Risk:\s*None/i.test(f),
      );
      const removed = before - filtered.length;

      if (removed > 0) {
        totalRemoved += removed;
        appChanged = true;
        console.log(
          `  App ${app._id} | agent ${agent.agentType}: removed ${removed} "None" finding(s)`,
        );
      }

      return { ...agent, findings: filtered };
    });

    if (!appChanged) continue;

    await col.updateOne(
      { _id: app._id },
      { $set: { agentResults: cleaned } },
    );
    updatedApps++;
  }

  console.log(`\n✅ Done — updated ${updatedApps} application(s), removed ${totalRemoved} "Detected Risk: None" finding(s)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
