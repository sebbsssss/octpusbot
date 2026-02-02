#!/usr/bin/env bun
/**
 * Build script for Octpus
 *
 * Creates:
 * 1. Single-file bundle (dist/octpus.js)
 * 2. Standalone executable (dist/octpus-{platform}-{arch})
 */

import { $ } from 'bun';
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = './dist';
const ENTRY = './bin/octpus.ts';

async function build(): Promise<void> {
  console.log('🐙 Building Octpus...\n');

  // Clean
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // Bundle to single file (Node.js compatible)
  console.log('📦 Bundling...');
  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: DIST_DIR,
    target: 'node',
    minify: true,
    sourcemap: 'none',
  });

  if (!result.success) {
    console.error('Build failed:', result.logs);
    process.exit(1);
  }

  // Fix shebang for Node.js compatibility
  const bundlePath = path.join(DIST_DIR, 'octpus.js');
  let bundleContent = fs.readFileSync(bundlePath, 'utf-8');
  bundleContent = bundleContent.replace(/^#!\/usr\/bin\/env bun/, '#!/usr/bin/env node');
  fs.writeFileSync(bundlePath, bundleContent);

  const stats = fs.statSync(bundlePath);
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`   → dist/octpus.js (${sizeKB} KB)\n`);

  // Create standalone executable
  console.log('🔨 Creating standalone executable...');

  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? '.exe' : '';
  const execName = `octpus-${platform}-${arch}${ext}`;
  const execPath = path.join(DIST_DIR, execName);

  await $`bun build ${ENTRY} --compile --outfile ${execPath}`.quiet();

  const execStats = fs.statSync(execPath);
  const execSizeMB = (execStats.size / 1024 / 1024).toFixed(1);
  console.log(`   → dist/${execName} (${execSizeMB} MB)\n`);

  // Create npm package files
  console.log('📝 Preparing npm package...');

  const pkg = {
    name: 'octpus',
    version: '0.1.3',
    description: '8 arms. Infinite reach. Autonomous AI agent.',
    bin: { octpus: './octpus.js' },
    main: './octpus.js',
    type: 'module',
    repository: { type: 'git', url: 'https://github.com/sebbsssss/octpusbot.git' },
    keywords: ['ai', 'agent', 'assistant', 'automation', 'llm', 'claude', 'autonomous'],
    author: 'Seb',
    license: 'MIT',
    engines: { node: '>=18.0.0' },
    dependencies: {
      '@anthropic-ai/sdk': '^0.52.0',
    },
  };

  fs.writeFileSync(
    path.join(DIST_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );

  fs.writeFileSync(
    path.join(DIST_DIR, 'README.md'),
    `# Octpus

**8 arms. Infinite reach.**

Autonomous AI agent that figures out how to achieve your goals.

## Install

\`\`\`bash
npm install -g octpus
\`\`\`

Or run directly:

\`\`\`bash
npx octpus
\`\`\`

## Usage

\`\`\`bash
octpus                          # Interactive chat
octpus "What's the price of ETH?"  # Quick query
octpus setup                    # Configure API keys
octpus daemon start             # Background agent
\`\`\`

## Documentation

See https://github.com/sebbsssss/octpusbot
`
  );

  console.log('   → dist/package.json');
  console.log('   → dist/README.md\n');

  console.log('✅ Build complete!\n');
  console.log('To publish to npm:');
  console.log('  cd dist && npm publish\n');
  console.log('To run the executable:');
  console.log(`  ./dist/${execName}\n`);
}

build().catch(console.error);
