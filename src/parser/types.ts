export enum TokenType {
  Label = 'Label',
  Instruction = 'Instruction',
  Immediate = 'Immediate',
  Address = 'Address',
  Symbol = 'Symbol',
  Register = 'Register',
  Delimiter = 'Delimiter',
  Directive = 'Directive',
  MemoryAccess = 'MemoryAccess',
  StringLiteral = 'StringLiteral',
  DataDefinition = 'DataDefinition'
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

export interface ParseError {
  message: string;
  line: number;
}

export interface SymbolTable {
  [key: string]: number;
}

export interface ParseResult {
  tokens: Token[];
  errors: ParseError[];
  symbols: SymbolTable;
}