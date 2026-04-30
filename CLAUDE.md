# Claude Code AI Tracker Extension

## Extension Purpose
Tracks Claude Code AI usage and associated costs, displaying statistics and cost breakdowns in a VS Code dashboard.

## Project Structure

```
src/
├── services/           # Core business logic
│   ├── StorageService         # Persist cost/usage data
│   ├── GitService             # Extract git/repo metadata
│   ├── JsonlCostService       # Parse JSONL cost logs
│   ├── AiStatsDataService     # Aggregate statistics
│   ├── ClaudeStatsService     # Calculate Claude-specific metrics
│   ├── ClaudeProjectsService  # Manage project configurations
│   └── __tests__/             # Jest unit tests
├── views/              # Webview panels & UI
│   ├── dashboardPanel          # Main stats dashboard
│   ├── reportDashboardPanel    # Report/export view
│   ├── chartsPanel             # Visualization components
│   └── sidebarProvider         # Sidebar panel setup
├── utils/              # Utilities
│   ├── pricing.ts              # Cost calculations
│   └── webviewHelpers.ts       # Webview communication
├── types.ts            # TypeScript interfaces
└── extension.ts        # Extension activation & commands
```

## Core Patterns

### Service Architecture
Each service handles a specific domain:
- **StorageService** - Manages global state storage
- **GitService** - Provides git repository info (branch, project name)
- **JsonlCostService** - Parses `.jsonl` cost files from Claude Code logs
- **AiStatsDataService** - Aggregates raw data into statistics
- **CostRecord** type - Central data structure for all cost tracking

### Data Flow
```
Claude Code logs → JsonlCostService (parse) → StorageService (persist)
                                   ↓
                         AiStatsDataService (aggregate)
                                   ↓
                    Dashboard panels (display & visualize)
```

### Webview Communication
- Dashboard panels use VS Code webview API
- Two-way messaging between extension and webview
- Use `postMessage` for async updates

## Testing

### Required Tests
- All services must have `.test.ts` files in `__tests__/` subdirectory
- Test JSONL parsing, cost calculations, storage operations
- Mock VS Code APIs (`vscode.Memento`, `git` commands)

### Test Patterns
```typescript
// Service tests
describe('JsonlCostService', () => {
  describe('parseCostFile', () => {
    it('should parse valid JSONL format', () => { ... });
    it('should handle missing cost fields', () => { ... });
  });
});
```

### Running Tests
```bash
npm test                # Run all tests
npm test -- --watch    # Watch mode
npm test -- --coverage # Coverage report
```

## Key Conventions

### Cost Record Structure
All data flows through `CostRecord`:
```typescript
interface CostRecord {
  project: string;      // Repository/project name
  branch: string;       // Current git branch
  timestamp: number;    // When the cost was recorded
  cost: number;         // Cost in USD
  inputTokens: number;  // Tokens input to API
  outputTokens: number; // Tokens output from API
  modelName: string;    // Claude model used
}
```

### Pricing Constants
- Update `src/utils/pricing.ts` when Claude pricing changes
- Keep model pricing in a centralized location
- Format: `MODEL_NAME_PRICING` constant

### Type Safety
- All cost calculations must use `number` types
- Use `Readonly<>` for immutable data structures
- Strict null checking enabled

## Build & Debug

### Development
```bash
npm run compile        # Build TypeScript
npm test              # Run tests
npm run esbuild       # Bundle for distribution
```

### Debugging
- Open `.vscode/launch.json` for debug configurations
- Use "Run Extension" to test with debugger
- Check Output panel for extension logs

### Dashboard Panels
- Panel HTML/CSS is injected dynamically via webview
- Keep UI logic in panel files, styling inline or referenced
- Test webview communication with `postMessage` calls

## Important Files

- **src/types.ts** - Central type definitions (CostRecord, DashboardData, etc.)
- **src/extension.ts** - Extension activation, command registration
- **src/services/jsonlCostService.ts** - Critical for cost parsing accuracy
- **src/utils/pricing.ts** - Model pricing data

## Dos & Don'ts

### Do
- Use StorageService for all persistent data
- Test parsing logic thoroughly (JSONL can be error-prone)
- Keep webview panels focused and lightweight
- Validate cost data before storing

### Don't
- Don't parse JSONL manually in multiple places (use JsonlCostService)
- Don't hardcode model names or pricing
- Don't skip tests for UI/view changes
- Don't mix business logic into webview code

## Common Tasks

### Adding a New Model
1. Add pricing to `src/utils/pricing.ts`
2. Update `CostRecord` type if needed
3. Update `JsonlCostService` parser
4. Add tests for new model
5. Update dashboard to display new metric

### Fixing Cost Calculations
- Check `AiStatsDataService` for aggregation logic
- Verify `pricing.ts` values match current Claude API
- Test with sample JSONL files
