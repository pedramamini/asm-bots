# Development Environment Setup

## Project Structure

```
asm-bots/
├── src/
│   ├── core/           # Core engine components
│   ├── memory/         # Memory management
│   ├── interpreter/    # Bot language interpreter
│   ├── simulator/      # Battle simulation
│   ├── web/           # Web interface
│   ├── api/           # API server
│   ├── db/            # Database layer
│   ├── auth/          # Authentication
│   └── replay/        # Replay system
├── test/
│   ├── unit/          # Unit tests
│   ├── integration/   # Integration tests
│   └── e2e/           # End-to-end tests
├── docs/              # Documentation
├── scripts/           # Build/deployment scripts
└── config/           # Configuration files
```

## Development Requirements

### Software Dependencies
- Node.js 18.x or higher
- Docker 24.x or higher
- SQLite 3.x
- Git 2.x

### Development Tools
- VSCode with extensions:
  - ESLint
  - Prettier
  - Docker
  - SQLite Viewer
  - Jest Runner
  - Mermaid Preview

### Environment Setup

1. **Node.js Configuration**
```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node.js 18
nvm install 18
nvm use 18

# Verify installation
node --version
npm --version
```

2. **Project Configuration**
```bash
# Install global dependencies
npm install -g typescript jest eslint prettier

# Install project dependencies
npm install

# Setup git hooks
npx husky install
```

3. **Docker Setup**
```bash
# Build development container
docker build -f Dockerfile.dev -t asm-bots-dev .

# Run development container
docker run -p 3000:3000 -v $(pwd):/app asm-bots-dev
```

## Configuration Files

### 1. Package.json
```json
{
  "name": "asm-bots",
  "version": "1.0.0",
  "scripts": {
    "dev": "nodemon src/index.js",
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts"
  }
}
```

### 2. TypeScript Configuration (tsconfig.json)
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

### 3. ESLint Configuration (.eslintrc)
```json
{
  "parser": "@typescript-eslint/parser",
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

### 4. Jest Configuration (jest.config.js)
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts'
  ]
};
```

### 5. Docker Configuration (Dockerfile)
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

## Development Workflow

### 1. Code Style
- Use TypeScript for all source files
- Follow ESLint rules
- Format with Prettier
- Document with JSDoc comments

### 2. Git Workflow
```bash
# Create feature branch
git checkout -b feature/name

# Make changes and commit
git add .
git commit -m "feat: description"

# Push changes
git push origin feature/name

# Create pull request
# Wait for review and CI/CD
```

### 3. Testing Strategy
- Write unit tests for all components
- Integration tests for module interactions
- E2E tests for critical paths
- Maintain 80% coverage minimum

### 4. Continuous Integration
```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test
      - run: npm run lint
```

## Database Management

### 1. SQLite Setup
```bash
# Install SQLite
brew install sqlite3

# Create database
sqlite3 asm-bots.db

# Run migrations
npm run migrate
```

### 2. Schema Management
```sql
-- Example schema
CREATE TABLE bots (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Monitoring and Debugging

### 1. Logging Configuration
```javascript
const logger = {
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' })
  ]
};
```

### 2. Performance Monitoring
- Use Node.js profiler
- Monitor memory usage
- Track API response times
- Log battle statistics

## Security Considerations

### 1. Code Security
- Input validation
- Memory bounds checking
- SQL injection prevention
- XSS protection

### 2. API Security
- Rate limiting
- JWT authentication
- CORS configuration
- Request validation

## Deployment

### 1. Production Build
```bash
# Build production assets
npm run build

# Run production server
NODE_ENV=production npm start
```

### 2. Docker Deployment
```bash
# Build production image
docker build -t asm-bots-prod .

# Run production container
docker run -d -p 80:3000 asm-bots-prod
```

### 3. Environment Variables
```bash
# Required
NODE_ENV=production
PORT=3000
DB_PATH=/data/asm-bots.db
JWT_SECRET=your-secret-key

# Optional
LOG_LEVEL=info
RATE_LIMIT=100
```

## Troubleshooting

### Common Issues
1. Database connection errors
2. Memory management issues
3. Bot execution timeouts
4. WebSocket disconnections

### Debug Commands
```bash
# Check logs
tail -f error.log

# Monitor memory
node --inspect src/index.js

# Test database
sqlite3 asm-bots.db ".tables"