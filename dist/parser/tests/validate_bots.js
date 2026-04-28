"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const main_1 = require("../main");
const BOTS_DIR = path.join(__dirname, '../../../specs/bots');
async function validateBots() {
    const files = fs.readdirSync(BOTS_DIR).filter(f => f.endsWith('.asm'));
    console.log(`Found ${files.length} bot files. Validating...\n`);
    let totalErrors = 0;
    let successful = 0;
    for (const file of files) {
        const filePath = path.join(BOTS_DIR, file);
        const source = fs.readFileSync(filePath, 'utf8');
        const result = (0, main_1.parse)(source);
        if (result.errors.length > 0) {
            console.error(`❌ ${file} has errors:`);
            result.errors.forEach(err => {
                console.error(`  Line ${err.line}: ${err.message}`);
            });
            totalErrors += result.errors.length;
        }
        else {
            console.log(`✅ ${file} parsed successfully`);
            successful++;
        }
    }
    console.log(`\nSummary:`);
    console.log(`- Successfully parsed: ${successful}/${files.length}`);
    console.log(`- Total errors found: ${totalErrors}`);
    if (totalErrors > 0) {
        process.exit(1);
    }
}
validateBots().catch(err => {
    console.error(err);
    process.exit(1);
});
