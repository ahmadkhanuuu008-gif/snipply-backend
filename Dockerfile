FROM node:24-alpine

# Install FFmpeg (+fonts for caption rendering) and yt-dlp — critical, do not skip
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu python3 py3-pip && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]