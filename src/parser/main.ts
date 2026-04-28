import { Token, TokenType, ParseResult } from './types';
import { firstPass, secondPass } from './parser';
import { tokenize } from './lexer';

export function parse(source: string): ParseResult {
  const tokens = tokenize(source);
  const { symbols, currentAddress } = firstPass(tokens);
  const { resolvedTokens, errors } = secondPass(tokens, symbols);
  
  return {
    tokens: resolvedTokens,
    symbols,
    errors
  };
}
