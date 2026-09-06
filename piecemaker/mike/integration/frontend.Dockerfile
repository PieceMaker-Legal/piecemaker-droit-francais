FROM node:22-slim
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/src /backend/src
RUN node -e "const fs=require('fs');const config=JSON.parse(fs.readFileSync('tsconfig.json'));config.exclude=[...(config.exclude||[]),'**/*.test.ts','**/*.test.tsx'];fs.writeFileSync('tsconfig.json',JSON.stringify(config))"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
