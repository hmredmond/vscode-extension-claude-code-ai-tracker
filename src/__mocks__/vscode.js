module.exports = {
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
    })),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createStatusBarItem: jest.fn(() => ({
      show: jest.fn(),
      hide: jest.fn(),
    })),
    createWebviewPanel: jest.fn(),
  },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
    })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  },
  commands: {
    registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  },
  Uri: {
    joinPath: jest.fn((base, ...paths) => base),
  },
  ViewColumn: {
    One: 1,
  },
  StatusBarAlignment: {
    Right: 1,
  },
  WebviewViewProvider: {},
  ExtensionContext: {},
  Memento: {},
};
