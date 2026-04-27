export type TokenType = 
  | 'Label' 
  | 'Instruction' 
  | 'Immediate' 
  | 'Symbol' 
  | 'Register' 
  | 'Directive' 
  | 'StringLiteral' 
  | 'Punctuation';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

export interface ParseResult {
  tokens: Token[];
  errors: { message: string, line: number }[];
  symbols: { [label: string]: number };
}
