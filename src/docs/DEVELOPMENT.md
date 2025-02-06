# ASM Bots Development Guide

## Project Overview
ASM Bots is a web-based Core Wars platform built with Deno and TypeScript. This guide will help you understand the project architecture, set up your development environment, and contribute effectively.

## Getting Started

### Prerequisites
- [Deno](https://deno.land/) 1.38 or higher
- [VSCode](https://code.visualstudio.com/) with Deno extension
- [SQLite](https://www.sqlite.org/) 3.x
- Git

### Development Environment Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/pedramamini/asm-bots.git
   cd asm-bots
   ```

2. Install VSCode extensions:
   - Deno
   - SQLite
   - ESLint
   - Prettier

3. Start the development server:
   ```bash
   deno task dev
   ```

4. Run tests:
   ```bash
   deno task test
   ```

## Project Structure

```
asm-bots/
├── src/
│   ├── server/           # Backend server code
│   │   ├── api/         # API endpoints
│   │   ├── auth/        # Authentication system
│   │   ├── battle/      # Battle system
│   │   ├── db/          # Database operations
│   │   ├── leaderboard/ # Ranking system
│   │   └── performance/ # Performance monitoring
│   ├── web/             # Frontend code
│   │   ├── components/  # React components
│   │   └── styles/      # CSS styles
│   └── docs/            # Documentation
├── tests/               # Test files
└── public/             # Static assets
```

## Architecture Overview

### Core Components

#### Memory System
- 16-bit addressable memory array
- Circular addressing logic
- Memory protection system
- Real-time visualization

#### Battle System
- Process management
- Instruction execution
- Event handling
- State persistence

#### Web Interface
- Real-time memory visualization
- Battle dashboard
- Interactive controls
- Replay system

### Performance Optimization

#### Caching System
```typescript
// Example cache configuration
const CACHE_CONFIG = {
  LEADERBOARD: {
    maxSize: 1000,
    ttl: 5 * 60 * 1000, // 5 minutes
  },
  USER_PROFILE: {
    maxSize: 10000,
    ttl: 15 * 60 * 1000, // 15 minutes
  }
};
```

#### Performance Monitoring
```typescript
// Example performance measurement
async function measureDatabaseOperation() {
  return await monitor.measureAsync("db_operation", async () => {
    // Database operation here
  });
}
```

## Development Workflow

### Code Style
- Follow TypeScript best practices
- Use ESLint and Prettier
- Write comprehensive tests
- Document public APIs

### Git Workflow
1. Create feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make changes and commit:
   ```bash
   git add .
   git commit -m "feat: description of changes"
   ```

3. Push and create PR:
   ```bash
   git push origin feature/your-feature-name
   ```

### Testing
- Write unit tests for all components
- Include integration tests
- Run performance tests
- Test browser compatibility

## API Development

### RESTful Endpoints
Follow OpenAPI specification in `src/docs/openapi.yaml`:
```yaml
/api/battles:
  post:
    summary: Create new battle
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/BattleCreate'
```

### WebSocket Events
```typescript
interface WebSocketMessage {
  type: 'battleUpdate' | 'botUpdate' | 'error';
  data: Battle | Bot | { message: string };
}
```

## Database Operations

### Query Optimization
- Use appropriate indexes
- Implement caching
- Monitor query performance
- Use transactions when needed

### Schema Updates
1. Create migration file
2. Update schema.ts
3. Add migration test
4. Update documentation

## Performance Considerations

### Optimization Guidelines
1. Use caching effectively
2. Minimize database queries
3. Optimize memory usage
4. Profile performance regularly

### Monitoring
- Track response times
- Monitor memory usage
- Watch error rates
- Check cache hit rates

## Deployment

### Production Build
```bash
deno task build
```

### Environment Variables
```bash
DENO_ENV=production
DB_PATH=/path/to/database
JWT_SECRET=your-secret-key
```

### Health Checks
- Monitor server status
- Check database connectivity
- Verify cache operation
- Test WebSocket connections

## Contributing

### Pull Request Guidelines
1. Follow code style
2. Add tests
3. Update documentation
4. Include performance impact
5. Add migration scripts if needed

### Code Review Process
1. Automated checks
2. Peer review
3. Performance review
4. Documentation review
5. Final approval

## Troubleshooting

### Common Issues
1. **Database Connection**
   - Check connection string
   - Verify permissions
   - Check migrations

2. **Performance Issues**
   - Profile code
   - Check cache settings
   - Monitor memory usage

3. **Test Failures**
   - Check test environment
   - Verify dependencies
   - Review recent changes

### Debug Tools
- Deno debugger
- Performance profiler
- Database analyzer
- Memory leak detector

## Resources

### Documentation
- [Deno Manual](https://deno.land/manual)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [SQLite Documentation](https://sqlite.org/docs.html)

### Community
- GitHub Discussions
- Discord Server
- Stack Overflow Tag

## Release Process

### Version Control
- Follow semantic versioning
- Update changelog
- Tag releases
- Create release notes

### Deployment Steps
1. Run tests
2. Build production assets
3. Update documentation
4. Deploy to staging
5. Run smoke tests
6. Deploy to production

Remember to keep this guide updated as the project evolves!