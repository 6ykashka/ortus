/** Узел дерева W3C Design Tokens. */
export interface TokenTree {
  [key: string]: unknown;
}

export interface TokenLeaf {
  path: string[];
  value: unknown;
  description?: string;
  prototype?: { ref: string; decision: string };
}

export const DESIGN_TOKENS_JSON: string;
export const DESIGN_TOKENS_CSS: string;
export const PROTOTYPE_JSON: string;
export const OUT_CSS: string;
export const OUT_TS: string;

export function collect(tree: TokenTree): TokenLeaf[];
export function cssVarName(path: readonly string[]): string;
export function cssValue(value: unknown): string;
export function generateCss(base: TokenTree, prototype: TokenTree): string;
export function generateTs(base: TokenTree, prototype: TokenTree): string;
export function generate(base: TokenTree, prototype: TokenTree): { css: string; ts: string };
export function readTokens(): { base: TokenTree; prototype: TokenTree };
