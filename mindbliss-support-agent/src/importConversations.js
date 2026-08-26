#!/usr/bin/env node
import { readConfig } from './config.js';
import { ConversationImporter, normalizeOptions } from './conversationImporter.js';

async function main() {
  const config = readConfig();
  const options = normalizeOptions({ ...config.import, ...parseArgs(process.argv.slice(2)) });
  const importer = new ConversationImporter(config);
  const result = await importer.run(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) process.exitCode = 2;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

main().catch(error => {
  console.error(JSON.stringify({ level: 'error', msg: 'conversation_import_failed', error: error.message }));
  process.exit(1);
});
