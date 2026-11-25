import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const run = spawnSync(process.execPath, ['--experimental-transform-types','--experimental-test-coverage','--test-coverage-include=src/**/*.ts','--test','tests/core.test.ts','tests/profile-store.test.ts','tests/fm.test.ts','tests/load-options.test.ts','tests/profiles.test.ts','tests/native-profile-abi.test.ts','tests/vintage-wasm.test.ts','tests/cqm.test.ts'],{encoding:'utf8'});
const text = run.stdout + run.stderr;
mkdirSync('output',{recursive:true}); writeFileSync('output/coverage.txt',text); process.stdout.write(text);
const match = text.match(/all files\s*\|\s*([\d.]+)/i);
if (run.status !== 0 || !match || Number(match[1]) < 60) process.exit(1);
console.log(`TOTAL ${match[1]}%`);
