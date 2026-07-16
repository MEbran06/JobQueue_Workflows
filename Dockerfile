FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY frontend/package*.json frontend/
RUN npm install --prefix frontend
COPY . .
RUN npm run build --prefix frontend
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]