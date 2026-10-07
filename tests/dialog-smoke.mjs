import {spawn} from 'node:child_process';
import path from 'node:path';
async function run(extra) {
  await new Promise((resolve, reject) => {
    const proc = spawn(path.resolve('test-output/runtime/native/SaveDialogSmoke.exe'), [path.resolve('test-output/runtime/native/MediaDockHost.exe'), ...extra], {windowsHide: true});
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Save dialog timed out')); }, 20000);
    proc.stdout.on('data', data => process.stdout.write(data)); proc.stderr.on('data', data => process.stderr.write(data));
    proc.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Save dialog exit ${code}`)); });
    proc.on('error', reject);
  });
}
await run([]);
await run([path.resolve('test-output/saved/Dialog selected.mp4')]);
