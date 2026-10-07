import {build} from 'esbuild';
import fs from 'node:fs/promises';
await build({entryPoints:['src/engine.js'],bundle:true,format:'esm',platform:'browser',target:'chrome127',minify:true,legalComments:'linked',outfile:'extension/engine.bundle.js'});
await build({entryPoints:['src/crypto.js'],bundle:true,format:'esm',platform:'browser',target:'chrome127',minify:true,legalComments:'linked',outfile:'extension/crypto.bundle.js'});
const manifest=JSON.parse(await fs.readFile('extension/manifest.json','utf8'));
console.log(`MediaDock ${manifest.version}: browser engine bundled.`);
