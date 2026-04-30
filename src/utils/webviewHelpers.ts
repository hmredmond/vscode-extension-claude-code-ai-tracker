import * as vscode from 'vscode';

/**
 * Generate a nonce string for inline scripts (CSP policy)
 */
export function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Convert a file URI to a webview URI
 */
export function getUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  pathList: string[]
): vscode.Uri {
  const joined = vscode.Uri.joinPath(extensionUri, ...pathList);
  const asWebview = webview.asWebviewUri(joined);
  return asWebview;
}

/**
 * Format a timestamp to a human-readable date string (date only, no time)
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format currency
 */
export function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

