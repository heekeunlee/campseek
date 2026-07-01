# campseek — 무의존성 Node 앱 (상시 실행 서버)
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
