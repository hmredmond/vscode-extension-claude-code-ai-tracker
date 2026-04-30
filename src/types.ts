export interface CostRecord {
  timestamp: number;
  project: string;
  branch: string;
  aiTool: 'claude' | string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface RawCostData {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface DashboardData {
  generated_at: string;
  kpi: {
    total_cost: number;
    actual_plan_cost: number;
    total_sessions: number;
    total_messages: number;
    total_output_tokens: number;
    total_input_tokens: number;
    first_session: string;
    last_session: string;
    total_projects: number;
  };
  daily_costs: Array<{ date: string; total: number } & Record<string, number>>;
  cumulative_costs: Array<{ date: string; cost: number }>;
  daily_messages: Array<{ date: string; messages: number; sessions: number }>;
  hourly_distribution: Array<{ hour: number; messages: number }>;
  weekday_distribution: Array<{ day: string; messages: number }>;
  models: string[];
  model_summary: Array<{
    model: string;
    cost: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    calls: number;
  }>;
  cost_by_token_type: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
  projects: Array<{
    name: string;
    sessions: number;
    messages: number;
    cost: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    file_size_mb: number;
  }>;
  sessions: Array<{
    session_id: string;
    project: string;
    date: string;
    start: string;
    end: string;
    duration_min: number;
    cost: number;
    messages: number;
    primary_model: string;
    tools?: { [key: string]: number };
    first_prompt?: string;
  }>;
  tool_summary: Array<{ name: string; count: number }>;
  insights?: {
    plugins?: any;
    todos?: any;
    file_history?: any;
    storage?: any;
    plans?: any;
  };
  plan?: {
    current_billing?: any;
    periods?: any[];
    total_api_cost?: number;
    total_plan_cost?: number;
    total_savings?: number;
    overall_roi?: number;
  };
}
