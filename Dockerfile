# Use Node.js as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p /app/data /app/src/web/js

# Set environment variables
ENV NODE_ENV=production
ENV DB_PATH=/app/data/database.sqlite

# The port the server listens on
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -q --spider http://localhost:8000/health || exit 1

# Start the server
CMD ["node", "src/server/server.js"]

# Add labels
LABEL org.opencontainers.image.source="https://github.com/pedramamini/asm-bots"
LABEL org.opencontainers.image.description="ASM Bots - Core Wars Platform"
LABEL org.opencontainers.image.licenses="ISC"