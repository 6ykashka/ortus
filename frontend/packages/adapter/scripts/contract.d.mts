// Типы scripts/contract.mjs для тестов (W0.13).
import type { Contract } from '../src/msw/contract/types.ts';

export declare const STAGE1_TAGS: readonly string[];
export declare const OUT: string;
export declare function buildContract(root?: string): Contract;
export declare function renderContract(contract: Contract): Promise<string>;
