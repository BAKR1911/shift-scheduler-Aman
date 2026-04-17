import { db } from './src/lib/db.ts';

async function checkDb() {
  const entries = await db.scheduleEntry.findAll();
  console.log('Total entries in DB:', entries.length);
  if (entries.length > 0) {
    console.log('Sample entries:');
    for (const e of entries.slice(0, 5)) {
      console.log(`  - ${e.date}: hours=${e.hours}, isHoliday=${e.isHoliday}, region=${e.region}`);
    }
  }
  process.exit(0);
}

checkDb();
