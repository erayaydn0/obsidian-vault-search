import { spawnSync } from 'node:child_process';

const IMAGE_NAME = 'vault-search-test';

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (typeof result.status === 'number') {
    return result.status;
  }

  if (result.error) {
    console.error(`::error::Failed to execute ${command}: ${result.error.message}`);
  }

  return 1;
}

console.log('==> [test:docker] Building Docker image...');
const buildCode = run('docker', ['build', '-f', 'Dockerfile.test', '-t', IMAGE_NAME, '.']);
if (buildCode !== 0) {
  console.error(`::error::[test:docker] FAILED during docker build (exit code ${buildCode}).`);
  process.exit(buildCode);
}

console.log('==> [test:docker] Running tests in container...');
const runCode = run('docker', ['run', '--rm', IMAGE_NAME]);
if (runCode !== 0) {
  console.error(`::error::[test:docker] FAILED during docker run (exit code ${runCode}).`);
  process.exit(runCode);
}

console.log('::notice::[test:docker] PASSED');
process.exit(0);
