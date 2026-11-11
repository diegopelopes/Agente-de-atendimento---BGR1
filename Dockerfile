FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY prompts ./prompts
COPY workflows ./workflows
COPY supabase ./supabase
COPY src ./src
COPY tests ./tests

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "src/api/visual-server.ts"]
