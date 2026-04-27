import { Token, TokenType, ParseResult } from './types';
import { firstPass } from './parser';

export function parse(source: string): ParseResult {
  const tokens = tokenize(source);
  const { symbols, currentAddress } = firstPass(tokens);
  
  return {
    tokens,
    symbols,
    errors: []
  };
}
