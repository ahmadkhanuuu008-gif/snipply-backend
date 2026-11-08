FROM node:24-alpine

# Install FFmpeg — critical, do not skip
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]