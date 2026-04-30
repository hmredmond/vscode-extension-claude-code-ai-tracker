/**
 * Storage Service
 *
 * Manages persistent storage of extension data using VS Code's workspace/global storage.
 * Provides abstraction layer for reading/writing extension configuration and state.
 *
 * Key functions:
 * - Store and retrieve extension settings and state
 * - Manage workspace-level and global storage
 * - Handle data serialization/deserialization
 *
 * Usage: Persist extension data across sessions and workspaces
 */

import * as vscode from 'vscode';
import { CostRecord } from '../types';

export class StorageService {
  private readonly registryKey = 'aiUsageCost::__keys__';

  constructor(private globalState: vscode.Memento) {}

  private getKey(project: string, branch: string): string {
    return `aiUsageCost::${project}::${branch}`;
  }

  append(record: CostRecord): void {
    const key = this.getKey(record.project, record.branch);
    const existing = this.globalState.get<CostRecord[]>(key, []);
    const updated = [...existing, record];
    this.globalState.update(key, updated);

    // Register the key in the key registry
    this.registerKey(key);
  }

  getHistory(project: string, branch: string): CostRecord[] {
    const key = this.getKey(project, branch);
    return this.globalState.get<CostRecord[]>(key, []);
  }

  getAllKeys(): string[] {
    return this.globalState.get<string[]>(this.registryKey, []);
  }

  private registerKey(key: string): void {
    const keys = this.globalState.get<string[]>(this.registryKey, []);
    if (!keys.includes(key)) {
      this.globalState.update(this.registryKey, [...keys, key]);
    }
  }

  getLatestForProject(project: string): CostRecord | undefined {
    const allKeys = this.getAllKeys();
    const projectKeys = allKeys.filter((k) => k.startsWith(`aiUsageCost::${project}::`));

    let latestRecord: CostRecord | undefined;
    let latestTime = 0;

    for (const key of projectKeys) {
      const records = this.globalState.get<CostRecord[]>(key, []);
      for (const record of records) {
        if (record.timestamp > latestTime) {
          latestTime = record.timestamp;
          latestRecord = record;
        }
      }
    }

    return latestRecord;
  }

  clearForProjectBranch(project: string, branch: string): void {
    const key = this.getKey(project, branch);
    this.globalState.update(key, undefined);

    // Remove from registry
    const keys = this.globalState.get<string[]>(this.registryKey, []);
    const updated = keys.filter(k => k !== key);
    this.globalState.update(this.registryKey, updated);
  }

  clear(): void {
    // Clear the registry and all records
    const keys = this.getAllKeys();
    for (const key of keys) {
      this.globalState.update(key, undefined);
    }
    this.globalState.update(this.registryKey, []);
  }
}
