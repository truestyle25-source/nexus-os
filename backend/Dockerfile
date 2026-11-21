FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json ./
# npm ci instala exatamente as versões do package-lock.json (igual ao CI).
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run prisma:generate
RUN npm run build
EXPOSE 4000
CMD ["npm", "start"]
