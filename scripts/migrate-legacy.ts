/**
 * One-time copy of the Laravel production data into the new schema.
 *   npm run db:migrate                         # create the new tables first
 *   npm run migrate:legacy -- --dry-run        # verify without writing
 *   npm run migrate:legacy -- --card-owner=2   # legacy user id that gets card-ready emails (default 2)
 * Reads LEGACY_DATABASE_URL (never written) and writes DATABASE_URL.
 */
import { migrateLegacy } from '../server/services/legacy-migration'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const cardOwner = Number(args.find(a => a.startsWith('--card-owner='))?.split('=')[1] ?? 2)
const legacyUrl = process.env.LEGACY_DATABASE_URL

if (!legacyUrl) {
  console.error('Set LEGACY_DATABASE_URL to the old Laravel database.')
  process.exit(1)
}

try {
  const report = await migrateLegacy(legacyUrl, { cardOwnerLegacyId: cardOwner, dryRun })
  console.table(report)
  console.log(dryRun ? 'Dry run passed. Nothing was written.' : 'Migration complete. Counts and cent totals match.')
  process.exit(0)
}
catch (e) {
  console.error('Migration aborted, nothing was written:', (e as Error).message)
  process.exit(1)
}
