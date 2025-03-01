# ASM-Bots Development Guide

## Commands
- Build: `npm run build`
- Start: `npm run start`
- Development: `npm run dev`
- Tests: `npm run test:node`
- Single test: `npm run test:node -- -t "test name"` or `npm run test:node -- path/to/file.test.ts`
- Clean: `npm run clean`

## Code Style
- **Imports**: Use ES modules with .js extension in imports
- **Types**: Strict TypeScript with explicit return types
- **Naming**: 
  - PascalCase for classes/interfaces
  - camelCase for variables/functions
  - Descriptive names for all entities
- **Error Handling**: Use explicit Error objects with descriptive messages
- **Formatting**: 2-space indentation, semicolons required
- **Testing**: Jest with high coverage requirement (90% threshold)
- **Documentation**: JSDoc comments for public APIs
- **Architecture**: Clean separation between memory, CPU, and battle systems

## Best Practices
- Prefer immutable data structures
- Use TypeScript interfaces for API boundaries
- Handle edge cases explicitly
- Use meaningful error messages
- Follow existing patterns in similar files