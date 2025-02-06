# Use official Deno image as base
FROM denoland/deno:1.38.0

# Set working directory
WORKDIR /app

# Copy entire project for dependency caching
COPY . .

# Cache dependencies
RUN deno cache --unstable src/server/api.ts

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment variables
ENV DENO_ENV=production
ENV DB_PATH=/app/data/database.sqlite

# The port the server listens on
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the application with necessary permissions
CMD ["deno", "task", "start"]

# Add labels
LABEL org.opencontainers.image.source="https://github.com/pedramamini/asm-bots"
LABEL org.opencontainers.image.description="ASM Bots - Core Wars Platform"
LABEL org.opencontainers.image.licenses="ISC"