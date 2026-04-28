
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '../main';

const BOTS_DIR = path.join(__dirname, '../../../specs/bots');

async function validateBots() {
  const files = fs.readdirSync(BOTS_DIR).filter(f => f.endsWith('.asm'));
  console.log(`Found ${files.length} bot files. Validating...\n`);

  let totalErrors = 0;
  let successful = 0;

  for (const file of files) {
    const filePath = path.join(BOTS_DIR, file);
    const source = fs.readFileSync(filePath, 'utf8');
    const result = parse(source);

    if (result.errors.length > 0) {
      console.error(`❌ ${file} has errors:`);
      result.errors.forEach(err => {
        console.error(`  Line ${err.line}: ${err.message}`);
      });
      totalErrors += result.errors.length;
    } else {
      console.log(`✅ ${file} parsed successfully`);
      successful++;
    }
  }

  console.log(`\nSummary:`);
  console.log(`- Successfully parsed: ${successful}/${files.length}`);
  console.log(`- Total errors found: ${totalErrors}`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

validateBots().catch(err => {
  console.error(err);
  process.exit(1);
});
