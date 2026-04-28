"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = parse;
const parser_1 = require("./parser");
const lexer_1 = require("./lexer");
function parse(source) {
    const tokens = (0, lexer_1.tokenize)(source);
    const { symbols, currentAddress } = (0, parser_1.firstPass)(tokens);
    const { resolvedTokens, errors } = (0, parser_1.secondPass)(tokens, symbols);
    return {
        tokens: resolvedTokens,
        symbols,
        errors
    };
}
