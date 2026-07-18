import fs from 'node:fs';
import { generateC } from './codegen.js';
import type { WorkflowDefinition } from '../../src/types.js';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
    console.error('Usage: node compile.ts <input.json> <output.c>');
    process.exit(1);
}

const definition = JSON.parse(fs.readFileSync(inputPath, 'utf-8')) as WorkflowDefinition;
const cSource = generateC(definition);
fs.writeFileSync(outputPath, cSource);
console.log(`Wrote ${outputPath}`);
