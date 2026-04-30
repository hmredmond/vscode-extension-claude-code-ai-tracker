/**
 * Claude Capture Service
 *
 * Captures real-time cost data by spawning the Claude CLI process and executing the /cost command.
 * Parses the output to extract token usage and cost information in a single interaction.
 *
 * Key functions:
 * - captureCost(claudePath, cwd): Spawns Claude CLI and executes /cost command
 * - parseCostOutput(output): Parses text output to extract cost and token data
 *
 * Usage: Get live cost data for a specific Claude project context
 */

import { spawn } from 'node:child_process';
import { RawCostData } from '../types';

export function captureCost(claudePath: string, cwd: string): Promise<RawCostData> {
  return new Promise((resolve, reject) => {
    // Try to run claude with --dangerously-skip-permissions in stdin mode
    const process = spawn(claudePath, ['--dangerously-skip-permissions'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    process.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set a timeout for the process
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error('Claude process timeout - /cost command did not respond'));
    }, 5000);

    process.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const costData = parseCostOutput(stdout);
        resolve(costData);
      } catch (error) {
        // If parsing failed and we have stderr, include it in the error message
        if (stderr.length > 0) {
          reject(new Error(`${error instanceof Error ? error.message : String(error)} (stderr: ${stderr})`));
        } else {
          reject(error);
        }
      }
    });

    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn claude process: ${error.message}`));
    });

    // Send /cost command and exit - with small delay to ensure interactive mode is ready
    process.stdin?.write('/cost\n');
    setTimeout(() => {
      process.stdin?.write('/exit\n');
      process.stdin?.end();
    }, 100);
  });
}

function parseCostOutput(output: string): RawCostData {
  // Parse total cost: "Total cost:            $0.0029" or "Total cost: $0.0029"
  const costPattern = /Total\s+cost:\s*\$?([\d.]+)/i;
  const totalCostMatch = costPattern.exec(output);
  if (!totalCostMatch) {
    throw new Error(`Failed to parse total cost from Claude output. Output: ${output.substring(0, 500)}`);
  }

  // Find the line with token usage (contains "input" and "output")
  const tokenLine = output.split('\n').find((line) => line.includes('input') && line.includes('output'));
  if (!tokenLine) {
    throw new Error(`Failed to find token usage line in Claude output`);
  }

  // Extract individual token counts from the line
  // Pattern handles: "2.3k input", "375 output", "5.2k cache read", "0 cache write"
  const inputMatch = /(\d+(?:\.\d+)?k?)\s+input/i.exec(tokenLine);
  const outputMatch = /(\d+(?:\.\d+)?k?)\s+output/i.exec(tokenLine);
  const readMatch = /(\d+(?:\.\d+)?k?)\s+cache\s+read/i.exec(tokenLine);
  const writeMatch = /(\d+(?:\.\d+)?k?)\s+cache\s+write/i.exec(tokenLine);

  if (!inputMatch || !outputMatch) {
    throw new Error(`Failed to parse input/output tokens from: ${tokenLine}`);
  }

  // Cache read/write are optional (might be 0)
  if (!readMatch || !writeMatch) {
    throw new Error(`Failed to parse cache tokens from: ${tokenLine}`);
  }

  const parseTokens = (tokenStr: string): number => {
    const normalized = tokenStr.toLowerCase().trim();
    if (normalized.endsWith('k')) {
      const num = Number.parseFloat(normalized.slice(0, -1));
      return Number.isNaN(num) ? 0 : Math.round(num * 1000);
    }
    const num = Number.parseInt(normalized, 10);
    return Number.isNaN(num) ? 0 : num;
  };

  return {
    totalCost: Number.parseFloat(totalCostMatch[1]),
    inputTokens: parseTokens(inputMatch[1]),
    outputTokens: parseTokens(outputMatch[1]),
    cacheReadTokens: parseTokens(readMatch[1]),
    cacheCreationTokens: parseTokens(writeMatch[1]),
  };
}
