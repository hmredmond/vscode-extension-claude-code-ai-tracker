import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as vscode from "vscode";
import { JsonlCostService } from "./jsonlCostService";

export interface FacetsSession {
  sessionId?: string;
  primary_success?: string;
  session_type?: string;
  session_outcome?: string;
  goal_categories?: string[];
  helpfulness_score?: number;
  friction_factors?: string[];
  created_at?: string;
  token_cost?: number;
  brief_summary?: string;
}

export interface ImpactData {
  sessionCount: number;
  successRate: number;
  timeSavedMinutes: number;
  percentTimeSaved: number;
  roi: number | null;
  totalTokenCost: number;
  devValueSaved: number;
  dateFrom: string | null;
  dateTo: string | null;
  sessions: FacetsSession[];
  outcomeDistribution: Record<string, number>;
  sessionTypeDistribution: Record<string, number>;
  goalCategoryDistribution: Record<string, number>;
  helpfulnessDistribution: Record<string, number>;
  frictionFactors: Record<string, number>;
  avgHelpfulness: number | null;
  hasData: boolean;
}

function mapHelpfulnessToScore(
  helpfulness: string,
): number | undefined {
  const map: Record<string, number> = {
    not_helpful: 1,
    slightly_helpful: 2,
    moderately_helpful: 3,
    quite_helpful: 4,
    very_helpful: 4,
    extremely_helpful: 5,
  };
  return map[helpfulness.toLowerCase()];
}

export class FacetsService {
  static load(): ImpactData {
    const config = vscode.workspace.getConfiguration("aiUsageCost");
    const hourlyRate = config.get<number>("developerHourlyRate", 50);
    const hoursPerWeek = config.get<number>("developerHoursPerWeek", 40);
    const baselines = config.get<Record<string, number>>(
      "sessionTimeBaselines",
      {
        // Keys match primary_success values from Claude Code /insights output
        single_file_fix: 15,
        multi_file_changes: 45,
        feature_implementation: 60,
        debugging: 30,
        debugging_fix: 30,       // legacy alias
        refactoring: 40,
        documentation: 20,
        testing: 35,
        test_writing: 35,        // legacy alias
        code_review: 20,
        architecture_decision: 60,
        explanation: 10,
        none: 0,
      },
    );

    const facetsDir = path.join(
      os.homedir(),
      ".claude",
      "usage-data",
      "facets",
    );
    if (!fs.existsSync(facetsDir)) {
      return FacetsService.empty();
    }

    const jsonFiles = fs
      .readdirSync(facetsDir)
      .filter((f) => f.endsWith(".json"));
    if (jsonFiles.length === 0) return FacetsService.empty();

    const allSessions: FacetsSession[] = [];
    for (const file of jsonFiles) {
      try {
        const filePath = path.join(facetsDir, file);
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        // Each file is a single session object
        if (raw && typeof raw === "object") {
          // Get file modification time as created_at
          const stats = fs.statSync(filePath);
          const createdAt = stats.mtime.toISOString();

          const sessionId = raw.session_id || file.replace(".json", "");
          const session: FacetsSession = {
            sessionId,
            primary_success: raw.primary_success,
            session_type: raw.session_type,
            session_outcome: raw.outcome,
            goal_categories: raw.goal_categories
              ? Object.keys(raw.goal_categories)
              : [],
            helpfulness_score: raw.claude_helpfulness
              ? mapHelpfulnessToScore(raw.claude_helpfulness)
              : undefined,
            friction_factors: raw.friction_counts
              ? Object.keys(raw.friction_counts)
              : [],
            created_at: createdAt,
            token_cost: JsonlCostService.getSessionCostIndex().get(sessionId),
            brief_summary: raw.brief_summary,
          };
          allSessions.push(session);
        }
      } catch {
        /* skip malformed */
      }
    }

    if (allSessions.length === 0) return FacetsService.empty();

    // Sort for date range
    const dates = allSessions
      .map((s) => s.created_at)
      .filter(Boolean)
      .sort() as string[];
    const dateFrom = dates[0] ?? null;
    const dateTo = dates[dates.length - 1] ?? null;

    // Success rate: fully or mostly achieved
    const successfulSessions = allSessions.filter(
      (s) =>
        s.session_outcome === "fully_achieved" ||
        s.session_outcome === "mostly_achieved",
    );
    const successRate =
      allSessions.length > 0
        ? (successfulSessions.length / allSessions.length) * 100
        : 0;

    // Time saved (heuristic, only for successful sessions)
    let timeSavedMinutes = 0;
    for (const s of successfulSessions) {
      const base = baselines[s.primary_success ?? ""] ?? 20;
      const goalCount = s.goal_categories?.length ?? 0;
      const complexity = Math.min(3, 1 + goalCount * 0.15);
      timeSavedMinutes += base * complexity;
    }

    // % time saved: estimated hours saved / contracted hours in date range
    let percentTimeSaved = 0;
    if (dateFrom && dateTo && hoursPerWeek > 0) {
      const fromDate = new Date(dateFrom);
      const toDate = new Date(dateTo);
      const weeks = Math.max(
        1,
        (toDate.getTime() - fromDate.getTime()) / (7 * 24 * 3600 * 1000),
      );
      const contractedHours = hoursPerWeek * weeks;
      percentTimeSaved =
        ((timeSavedMinutes / 60) / contractedHours) * 100;
    }

    // Total token cost (sum from sessions that have it)
    const totalTokenCost = allSessions.reduce(
      (sum, s) => sum + (s.token_cost ?? 0),
      0,
    );

    // Dev value saved: hours saved × hourly rate
    const devValueSaved = (timeSavedMinutes / 60) * hourlyRate;

    // ROI
    const roi = totalTokenCost > 0 ? devValueSaved / totalTokenCost : null;

    // Distributions
    const outcomeDistribution: Record<string, number> = {};
    const sessionTypeDistribution: Record<string, number> = {};
    const goalCategoryDistribution: Record<string, number> = {};
    const helpfulnessDistribution: Record<string, number> = {};
    const frictionFactors: Record<string, number> = {};
    let helpfulnessSum = 0;
    let helpfulnessCount = 0;

    for (const s of allSessions) {
      if (s.session_outcome)
        outcomeDistribution[s.session_outcome] =
          (outcomeDistribution[s.session_outcome] ?? 0) + 1;
      if (s.primary_success)
        sessionTypeDistribution[s.primary_success] =
          (sessionTypeDistribution[s.primary_success] ?? 0) + 1;
      for (const g of s.goal_categories ?? [])
        goalCategoryDistribution[g] = (goalCategoryDistribution[g] ?? 0) + 1;
      for (const f of s.friction_factors ?? [])
        frictionFactors[f] = (frictionFactors[f] ?? 0) + 1;
      if (s.helpfulness_score != null) {
        helpfulnessDistribution[String(s.helpfulness_score)] =
          (helpfulnessDistribution[String(s.helpfulness_score)] ?? 0) + 1;
        helpfulnessSum += s.helpfulness_score;
        helpfulnessCount++;
      }
    }

    return {
      sessionCount: allSessions.length,
      successRate,
      timeSavedMinutes,
      percentTimeSaved,
      roi,
      totalTokenCost,
      devValueSaved,
      dateFrom,
      dateTo,
      sessions: allSessions,
      outcomeDistribution,
      sessionTypeDistribution,
      goalCategoryDistribution,
      helpfulnessDistribution,
      frictionFactors,
      avgHelpfulness:
        helpfulnessCount > 0 ? helpfulnessSum / helpfulnessCount : null,
      hasData: true,
    };
  }

  static empty(): ImpactData {
    return {
      sessionCount: 0,
      successRate: 0,
      timeSavedMinutes: 0,
      percentTimeSaved: 0,
      roi: null,
      totalTokenCost: 0,
      devValueSaved: 0,
      dateFrom: null,
      dateTo: null,
      sessions: [],
      outcomeDistribution: {},
      sessionTypeDistribution: {},
      goalCategoryDistribution: {},
      helpfulnessDistribution: {},
      frictionFactors: {},
      avgHelpfulness: null,
      hasData: false,
    };
  }

  static hasFacetsFolder(): boolean {
    const facetsDir = path.join(os.homedir(), ".claude", "usage-data", "facets");
    return fs.existsSync(facetsDir);
  }
}
