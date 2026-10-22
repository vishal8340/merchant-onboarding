/**
 * deduplicateMerchants.ts
 *
 * One-shot utility: scans all applications in MongoDB and removes duplicate
 * entries that share the same businessName, contactEmail, or contactPhone.
 *
 * De-duplication rules
 * ─────────────────────
 * 1. Within each duplicate group (grouped by normalised field value), the
 *    record to KEEP is chosen in this priority order:
 *      a. Status APPROVED  (prefer the approved record)
 *      b. Most recent createdAt  (latest submission wins)
 * 2. All other records in the group are deleted.
 * 3. A dry-run mode (default) prints what WOULD be deleted without touching
 *    the database. Pass --execute to actually delete.
 *
 * Run (preview):   npx ts-node src/scripts/deduplicateMerchants.ts
 * Run (delete):    npx ts-node src/scripts/deduplicateMerchants.ts --execute
 */

import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/merchant-onboarding';

const DRY_RUN = !process.argv.includes('--execute');

function normalize(s: string): string {
  return (s || '').trim().toLowerCase();
}

/** Score for "keep" priority: APPROVED = 2, others = 1 */
function statusScore(status: string): number {
  return status === 'APPROVED' ? 2 : 1;
}

interface AppDoc {
  _id: any;
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  status: string;
  createdAt: Date;
  merchantId?: string;
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB\n');

  const col = mongoose.connection.db!.collection<AppDoc>('applications');
  const all = await col.find({}).toArray();
  console.log(`📊 Total applications in DB: ${all.length}`);

  if (all.length === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // ── Build duplicate groups per field ──────────────────────────────────────
  const byBusinessName = new Map<string, AppDoc[]>();
  const byEmail        = new Map<string, AppDoc[]>();
  const byPhone        = new Map<string, AppDoc[]>();

  for (const doc of all) {
    const bn = normalize(doc.businessName);
    const em = normalize(doc.contactEmail);
    const ph = normalize(doc.contactPhone);

    if (bn) { if (!byBusinessName.has(bn)) byBusinessName.set(bn, []); byBusinessName.get(bn)!.push(doc); }
    if (em) { if (!byEmail.has(em))        byEmail.set(em, []);        byEmail.get(em)!.push(doc); }
    if (ph) { if (!byPhone.has(ph))        byPhone.set(ph, []);        byPhone.get(ph)!.push(doc); }
  }

  // ── Collect _ids to delete (union across all duplicate groups) ────────────
  const toDelete = new Set<string>(); // string representation of _id

  function processGroup(label: string, value: string, group: AppDoc[]) {
    if (group.length < 2) return;

    // Sort: APPROVED first, then newest first
    group.sort((a, b) => {
      const scoreDiff = statusScore(b.status) - statusScore(a.status);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const keep   = group[0];
    const remove = group.slice(1);

    console.log(`\n🔎 Duplicate group [${label} = "${value}"]`);
    console.log(`   KEEP   → id: ${keep.id}  status: ${keep.status}  businessName: "${keep.businessName}"  merchantId: ${keep.merchantId ?? 'N/A'}`);
    for (const r of remove) {
      console.log(`   DELETE → id: ${r.id}  status: ${r.status}  businessName: "${r.businessName}"`);
      toDelete.add(r._id.toString());
    }
  }

  for (const [val, group] of byBusinessName) processGroup('businessName', val, group);
  for (const [val, group] of byEmail)        processGroup('email',        val, group);
  for (const [val, group] of byPhone)        processGroup('phone',        val, group);

  if (toDelete.size === 0) {
    console.log('\n✅ No duplicate entries found. Database is clean.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`📋 Total records marked for deletion: ${toDelete.size}`);

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — no records were deleted.');
    console.log('   Re-run with --execute flag to apply deletions:\n');
    console.log('   npx ts-node src/scripts/deduplicateMerchants.ts --execute\n');
  } else {
    const ids = [...toDelete].map(id => new mongoose.Types.ObjectId(id));
    const result = await col.deleteMany({ _id: { $in: ids as any } });
    console.log(`\n🗑️  Deleted ${result.deletedCount} duplicate record(s) from MongoDB.`);
    console.log('✅ Deduplication complete.\n');
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
