/**
 * Git Service
 *
 * Executes git commands to retrieve repository information.
 * Provides current branch, project name, and git user details.
 *
 * Key functions:
 * - getCurrentBranch(cwd): Gets the current git branch name
 * - getProjectName(cwd): Extracts project name from git root or filesystem path
 * - getGitUsername(): Retrieves configured git user name
 *
 * Usage: Obtain git metadata for projects being analyzed
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";

const execAsync = promisify(exec);
const outputChannel = vscode.window.createOutputChannel("Claude AI usage costs [gitService]");

export async function getCurrentBranch(cwd: string): Promise<string> {
  outputChannel.appendLine(`[DEBUG] getCurrentBranch called with cwd: ${cwd}`);
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd,
    });
    outputChannel.appendLine(`[DEBUG] git branch stdout: ${stdout}`);
    return stdout.trim() || "unknown";
  } catch (error) {
    outputChannel.appendLine(`[DEBUG] getCurrentBranch error: ${error instanceof Error ? error.message : error}`);
    return "unknown";
  }
}

export async function getProjectName(cwd: string): Promise<string> {
  outputChannel.appendLine(`[DEBUG] getProjectName called with cwd: ${cwd}`);
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", {
      cwd,
    });
    outputChannel.appendLine(`[DEBUG] git toplevel stdout: ${stdout}`);
    const fullPath = stdout.trim();
    return fullPath.split("/").pop() || "unknown";
  } catch (error) {
    outputChannel.appendLine(`[DEBUG] getProjectName error: ${error instanceof Error ? error.message : error}`);
    // Fallback: use the last part of the cwd path
    return cwd.split("/").pop() || "unknown";
  }
}

export async function getGitUsername(): Promise<string> {
  outputChannel.appendLine(`[DEBUG] getGitUsername called`);
  try {
    // Try to get GitHub username from git config
    const { stdout } = await execAsync("git config --get user.name");
    outputChannel.appendLine(`[DEBUG] git user.name stdout: ${stdout}`);
    return stdout.trim() || "unknown";
  } catch (error) {
    outputChannel.appendLine(`[DEBUG] getGitUsername error: ${error instanceof Error ? error.message : error}`);
    return "unknown";
  }
}
