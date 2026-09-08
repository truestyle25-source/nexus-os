FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN if [ -d "Prisma" ]; then mv Prisma prisma; fi
RUN npx prisma generate
RUN npm run build
EXPOSE 4000
CMD ["npm", "start"]
